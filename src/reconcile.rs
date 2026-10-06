//! Frozen external returns are proposals, never replacement authorities.
use crate::{
    model::*,
    package::{self, Objects},
    store::Store,
    xml,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

const GRAMMAR: &str = "token-package-return/1";
const FIELDS: &[&str] = &[
    "nform",
    "wb_normalized",
    "variety",
    "annotation",
    "review",
    "note",
    "lemma",
    "pos",
    "msd",
    "relation_target",
    "relation_type",
];
const MAX_CHANGES: usize = 100;
const LINEAGE_PREFIX: &str = "Resources/reconciliation/";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub schema: u32,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub stage: String,
    pub resolutions: BTreeMap<String, Choice>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    Current,
    External,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Stage {
    schema: u32,
    project: String,
    files: Files,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Change {
    pub key: String,
    pub document: String,
    pub token: String,
    pub field: String,
    pub base: Option<String>,
    pub current: Option<String>,
    pub external: Option<String>,
    pub state: String,
    pub choice: Option<Choice>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preview {
    pub schema: u32,
    pub grammar: String,
    pub request: Request,
    pub exported_base: Revision,
    pub package_files: usize,
    pub changed_xml: Vec<String>,
    pub retained_backups: Vec<String>,
    pub changes: Vec<Change>,
    pub blockers: Vec<String>,
    pub issues: Vec<Issue>,
    pub candidate_snapshot_hash: Option<String>,
    pub lineage_path: Option<String>,
    pub ready: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lineage {
    schema: u32,
    grammar: String,
    request: Request,
    exported_base: Revision,
    files: Files,
    export_receipt: String,
    changes: Vec<Change>,
    frozen_xml: BTreeMap<String, String>,
}
struct Scratch(PathBuf);
impl Scratch {
    fn new(parent: &Path) -> Result<Self> {
        fs::create_dir_all(parent)?;
        let path = parent.join(format!("scratch-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
struct Prepared {
    preview: Preview,
    candidate: Snapshot,
    artifacts: Vec<(String, Vec<u8>)>,
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}
fn immutable_generation(value: &Value) -> Result<Value> {
    ensure!(
        value["current"].is_boolean(),
        "invalid historical generation current flag"
    );
    let mut result = value.clone();
    result
        .as_object_mut()
        .context("generation object")?
        .remove("current");
    Ok(result)
}

fn unqualified_fields(
    tree: &roxmltree::Document<'_>,
    id: &str,
) -> Result<BTreeMap<String, String>> {
    let nodes: Vec<_> = tree
        .descendants()
        .filter(|n| {
            n.has_tag_name("tok")
                && n.attribute("id")
                    .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
                    == Some(id)
        })
        .collect();
    ensure!(nodes.len() == 1, "ambiguous unqualified token identity");
    Ok(nodes[0]
        .attributes()
        .filter(|a| a.namespace().is_none() && FIELDS.contains(&a.name()))
        .map(|a| (a.name().into(), a.value().into()))
        .collect())
}

/// Full ordered XML semantics outside the deliberately editable token attrs.
/// Quote/entity spelling, attribute order and XML declarations are serializer
/// trivia; source XML is retained and native output patches the original bytes.
fn signature(node: roxmltree::Node<'_, '_>, source: &str) -> Result<Value> {
    if node.is_element() {
        let simple_token = node.has_tag_name("tok") && !node.children().any(|n| n.is_element());
        let mut attrs = BTreeMap::new();
        for (qname, _) in xml::lexical_attrs(source, node.range().start)?.0 {
            if simple_token && FIELDS.contains(&qname.as_str()) {
                continue;
            }
            let value = if qname == "xmlns" || qname.starts_with("xmlns:") {
                node.lookup_namespace_uri(qname.strip_prefix("xmlns:"))
                    .unwrap_or("")
            } else {
                let (prefix, local) = qname
                    .split_once(':')
                    .map_or((None, qname.as_str()), |(p, l)| (Some(p), l));
                let namespace = prefix.and_then(|p| {
                    if p == "xml" {
                        Some("http://www.w3.org/XML/1998/namespace")
                    } else {
                        node.lookup_namespace_uri(Some(p))
                    }
                });
                node.attributes()
                    .find(|a| a.name() == local && a.namespace() == namespace)
                    .context("lexical XML attribute")?
                    .value()
            };
            attrs.insert(qname, value.to_owned());
        }
        let namespaces: BTreeMap<_, _> = node
            .namespaces()
            .map(|n| (n.name().unwrap_or(""), n.uri()))
            .collect();
        let lexical_name = source[node.range().start + 1..]
            .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .next()
            .context("element name")?;
        Ok(
            json!({"element":lexical_name,"namespace":node.tag_name().namespace(),"namespaces":namespaces,"attrs":attrs,"children":node.children().map(|n|signature(n,source)).collect::<Result<Vec<_>>>()?}),
        )
    } else if node.is_text() {
        Ok(json!({"text":node.text()}))
    } else if node.is_comment() {
        Ok(json!({"comment":node.text()}))
    } else if let Some(pi) = node.pi() {
        Ok(json!({"pi":pi.target,"value":pi.value}))
    } else {
        Ok(json!({"root":node.children().map(|n|signature(n,source)).collect::<Result<Vec<_>>>()?}))
    }
}

pub(crate) fn known_lineage(path: &str, bytes: &[u8]) -> Result<()> {
    ensure!(
        bytes.len() <= xml::MAX_XML_BYTES,
        "return lineage size limit"
    );
    let value: Lineage = serde_json::from_slice(bytes)?;
    ensure!(
        serde_json::from_slice::<Value>(bytes)? == serde_json::to_value(&value)?,
        "return lineage has unrecognized nested fields"
    );
    ensure!(
        value.schema == 1
            && value.grammar == GRAMMAR
            && value.request.schema == 1
            && xml::valid_name(&value.request.project)
            && is_hash(&value.request.stage)
            && is_hash(&value.request.snapshot_hash)
            && !value.files.is_empty()
            && value.changes.len() <= MAX_CHANGES,
        "unsupported return lineage"
    );
    ensure!(
        path == format!("{LINEAGE_PREFIX}{}.json", package::hash(bytes)),
        "return lineage path/hash mismatch"
    );
    ensure!(
        value.files.len() <= package::MAX_ENTRIES
            && package::hash(&serde_json::to_vec(&Stage {
                schema: 1,
                project: value.request.project.clone(),
                files: value.files.clone()
            })?) == value.request.stage,
        "return manifest/stage binding mismatch"
    );
    let mut total = 0u64;
    let mut folded = std::collections::BTreeSet::new();
    for (path, artifact) in &value.files {
        package::safe_package_path(path)?;
        total = total
            .checked_add(artifact.bytes)
            .context("return manifest overflow")?;
        ensure!(
            folded.insert(path.to_lowercase())
                && is_hash(&artifact.sha256)
                && artifact.bytes <= package::MAX_FILE_BYTES
                && total <= package::MAX_PACKAGE_BYTES
                && artifact.role == package::role(path),
            "invalid return manifest artifact"
        );
    }
    for change in &value.changes {
        package::safe_relative(&change.document)?;
        ensure!(
            !change.token.is_empty()
                && change.token.len() <= 65536
                && FIELDS.contains(&change.field.as_str())
                && ["external_change", "already_current", "conflict"]
                    .contains(&change.state.as_str())
                && change.key
                    == package::hash(
                        format!("{}\0{}\0{}", change.document, change.token, change.field)
                            .as_bytes()
                    ),
            "invalid return field lineage"
        );
    }
    ensure!(
        value
            .files
            .iter()
            .any(|(path, a)| path.starts_with("Workbench/exports/")
                && path.ends_with("/export-receipt.json")
                && a.sha256 == package::hash(value.export_receipt.as_bytes())
                && a.bytes == value.export_receipt.len() as u64),
        "return receipt source missing"
    );
    for (name, text) in &value.frozen_xml {
        package::safe_relative(name)?;
        let artifact = value
            .files
            .get(name)
            .context("return source manifest missing")?;
        ensure!(
            artifact.sha256 == package::hash(text.as_bytes())
                && artifact.bytes == text.len() as u64,
            "return source bytes/hash mismatch"
        );
        xml::parse(text)?;
    }
    let receipt: Value = serde_json::from_str(&value.export_receipt)?;
    package::validate_history_rows(&receipt)?;
    ensure!(
        receipt["revision"] == serde_json::to_value(&value.exported_base)?,
        "return base receipt mismatch"
    );
    let baseline: Snapshot = serde_json::from_value(receipt["snapshot"].clone())?;
    ensure!(
        baseline.project == value.request.project
            && package::hash(&serde_json::to_vec(&baseline)?) == value.exported_base.snapshot_hash,
        "return baseline hash mismatch"
    );
    Ok(())
}

impl Store {
    fn verify_return_receipt(&self, project: &str, row: &Revision, receipt: &Value) -> Result<()> {
        let mut expected = self.receipt(project, row.id)?;
        let supplied_reviews = receipt["reviews"].as_array().context("return reviews")?;
        let canonical_reviews = expected["reviews"]
            .as_array()
            .context("canonical reviews")?;
        ensure!(
            supplied_reviews.len() <= canonical_reviews.len()
                && supplied_reviews == &canonical_reviews[..supplied_reviews.len()],
            "returned review metadata changed"
        );
        let approved = supplied_reviews
            .iter()
            .rev()
            .find(|review| {
                review["revision"] == row.id
                    && review["snapshot_hash"] == row.snapshot_hash
                    && review["scope"] == "full"
            })
            .is_some_and(|review| review["decision"] == "approved");
        ensure!(
            receipt["approved"] == approved,
            "returned approval metadata changed"
        );
        let version = receipt["exporter"]
            .as_str()
            .and_then(|s| s.strip_prefix("corpus-workbench/"))
            .context("return exporter")?;
        ensure!(
            !version.is_empty()
                && version.len() <= 64
                && version
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-')),
            "unsupported return exporter"
        );
        let mut supplied = receipt.clone();
        if supplied.get("derived_generations").is_none() {
            supplied["derived_generations"] = json!([]);
        }
        for value in [&mut supplied, &mut expected] {
            for generation in value["derived_generations"]
                .as_array_mut()
                .context("generation manifest")?
            {
                *generation = immutable_generation(generation)?;
            }
        }
        for key in ["exporter", "approved", "reviews"] {
            supplied
                .as_object_mut()
                .context("return receipt object")?
                .remove(key);
            expected
                .as_object_mut()
                .context("canonical receipt object")?
                .remove(key);
        }
        ensure!(
            supplied == expected,
            "returned export metadata changed or unrecognized"
        );
        Ok(())
    }
    /// Copies source into isolated immutable staging; never writes authority objects.
    pub fn stage_return(&self, directory: &Path, project: &str) -> Result<String> {
        ensure!(self.project_exists(project)?, "project not found");
        let source = fs::canonicalize(directory)?;
        let authority = fs::canonicalize(&self.root)?;
        ensure!(
            !source.starts_with(&authority) && !authority.starts_with(&source),
            "return source must be separate from the authority"
        );
        let parent = self.root.join("returns");
        let scratch = Scratch::new(&parent)?;
        let objects = Objects::new(&scratch.0.join("objects"))?;
        let stage = Stage {
            schema: 1,
            project: project.into(),
            files: package::collect_files(&objects, directory, project)?,
        };
        let bytes = serde_json::to_vec(&stage)?;
        let id = package::hash(&bytes);
        let mut file = File::create(scratch.0.join("stage.json"))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        let destination = parent.join(&id);
        if destination.exists() {
            ensure!(
                fs::read(destination.join("stage.json"))? == bytes,
                "stage collision"
            );
        } else {
            fs::rename(&scratch.0, &destination)?;
            #[cfg(unix)]
            File::open(parent)?.sync_all()?;
        }
        Ok(id)
    }
    fn return_stage(&self, project: &str, id: &str) -> Result<(Stage, Objects)> {
        ensure!(is_hash(id), "invalid return stage");
        let dir = self.root.join("returns").join(id);
        ensure!(
            !fs::symlink_metadata(&dir)?.file_type().is_symlink(),
            "return stage symlink denied"
        );
        let bytes = fs::read(dir.join("stage.json"))?;
        ensure!(
            bytes.len() <= 4 * 1024 * 1024 && package::hash(&bytes) == id,
            "return stage manifest corrupted"
        );
        let stage: Stage = serde_json::from_slice(&bytes)?;
        ensure!(
            stage.schema == 1 && stage.project == project,
            "return stage project mismatch"
        );
        let objects = Objects {
            root: dir.join("objects"),
        };
        for (path, artifact) in &stage.files {
            package::safe_relative(path)?;
            objects.read(artifact)?;
        }
        Ok((stage, objects))
    }
    pub fn reconciliation_preview(&self, r: &Request) -> Result<Value> {
        let prepared = self.prepare_reconciliation(r)?;
        Ok(
            json!({"preview_hash":package::hash(&serde_json::to_vec(&prepared.preview)?),"preview":prepared.preview}),
        )
    }
    fn prepare_reconciliation(&self, r: &Request) -> Result<Prepared> {
        ensure!(
            r.schema == 1 && r.resolutions.len() <= MAX_CHANGES,
            "invalid return contract"
        );
        let head = self.head(&r.project)?;
        ensure!(
            head.id == r.revision && head.snapshot_hash == r.snapshot_hash,
            "stale return preview; reload saved state"
        );
        let current = self.snapshot(&head)?;
        let (stage, incoming) = self.return_stage(&r.project, &r.stage)?;
        let mut receipts = vec![];
        for (path, artifact) in stage.files.iter().filter(|(p, _)| {
            p.starts_with("Workbench/exports/") && p.ends_with("/export-receipt.json")
        }) {
            let value: Value = serde_json::from_slice(&incoming.read(artifact)?)?;
            let row: Revision = serde_json::from_value(value["revision"].clone())?;
            let base: Snapshot = serde_json::from_value(value["snapshot"].clone())?;
            if let Ok(known) = self.revision(&r.project, row.id) {
                if serde_json::to_value(&known)? == serde_json::to_value(&row)?
                    && known.snapshot_hash == package::hash(&serde_json::to_vec(&base)?)
                    && base == self.snapshot(&known)?
                {
                    receipts.push((row, base, path.clone(), value));
                }
            }
        }
        receipts.sort_by_key(|(row, _, _, _)| row.id);
        let (base_revision, base, receipt_path, receipt) = receipts.pop().context(
            "returned export has no exact baseline in this authority; use the original project",
        )?;
        ensure!(
            !receipts
                .iter()
                .any(|(rev, _, _, _)| rev.id == base_revision.id),
            "ambiguous returned export baseline"
        );
        let prefix = receipt_path.strip_suffix("export-receipt.json").unwrap();
        self.verify_return_receipt(&r.project, &base_revision, &receipt)?;
        let id = prefix.trim_end_matches('/').rsplit('/').next().unwrap();
        uuid::Uuid::parse_str(id)?;
        // Verify the entire original export namespace through the strict importer.
        // Restore its known base bytes only in a disposable quarantine; changed
        // source XML is never edited and the normal importer remains strict.
        let scratch = Scratch::new(&self.root.join("returns"))?;
        let clean = scratch.0.join("baseline");
        fs::create_dir(&clean)?;
        for (path, artifact) in &base.files {
            let target = clean.join(path);
            fs::create_dir_all(target.parent().unwrap())?;
            fs::write(target, self.objects.read(artifact)?)?;
        }
        for (path, artifact) in stage.files.iter().filter(|(p, _)| p.starts_with(prefix)) {
            let target = clean.join(path);
            fs::create_dir_all(target.parent().unwrap())?;
            fs::write(target, incoming.read(artifact)?)?;
        }
        let temporary = Objects::new(&scratch.0.join("candidate-objects"))?;
        package::import(&temporary, &clean, &r.project)
            .context("returned export integrity failed")?;
        // History is canonical locally; foreign approvals/generations are never adopted.
        for row in package::validate_history_rows(&receipt)? {
            ensure!(
                serde_json::to_value(&self.revision(&r.project, row.id)?)?
                    == serde_json::to_value(row)?,
                "returned history diverges from this authority"
            );
        }
        // Every byte in the new export namespace must have a declared role.
        let mut expected_namespace = std::collections::BTreeSet::from([
            receipt_path.clone(),
            format!("{prefix}definitions.json"),
        ]);
        let history_prefix = format!("{prefix}history-objects/");
        for row in package::validate_history_rows(&receipt)? {
            expected_namespace.insert(format!("{history_prefix}{}", row.snapshot_hash));
            for artifact in self.snapshot(&row)?.files.values() {
                expected_namespace.insert(format!("{history_prefix}{}", artifact.sha256));
            }
        }
        let known_generations = self.generations(&r.project, true)?;
        for generation in receipt["derived_generations"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let immutable = immutable_generation(generation)?;
            ensure!(
                known_generations
                    .iter()
                    .any(|known| immutable_generation(known).is_ok_and(|known| known == immutable)),
                "returned generation is not local canonical history"
            );
            for field in ["receipt_hash", "graph_hash"] {
                expected_namespace.insert(format!(
                    "{history_prefix}{}",
                    generation[field].as_str().context("generation hash")?
                ));
            }
            let completion: crate::handoff::Completion = serde_json::from_slice(
                &self.objects.read_hash(
                    generation["receipt_hash"]
                        .as_str()
                        .context("completion hash")?,
                )?,
            )?;
            expected_namespace.insert(format!(
                "{history_prefix}{}",
                completion.binding.contract_hash
            ));
        }
        let supplied_namespace: std::collections::BTreeSet<_> = stage
            .files
            .keys()
            .filter(|path| path.starts_with(prefix))
            .cloned()
            .collect();
        ensure!(
            supplied_namespace == expected_namespace,
            "returned export namespace has undeclared or missing artifacts"
        );
        for name in expected_namespace
            .iter()
            .filter_map(|path| path.strip_prefix(&history_prefix))
        {
            ensure!(
                incoming.read(&stage.files[&format!("{history_prefix}{name}")])?
                    == self.objects.read_hash(name)?,
                "returned history object diverges from canonical bytes"
            );
        }
        ensure!(
            incoming.read(&stage.files[&format!("{prefix}definitions.json")])?
                == serde_json::to_vec_pretty(&base.config)?,
            "returned definitions bytes changed"
        );
        let mut p = Preview {
            schema: 1,
            grammar: GRAMMAR.into(),
            request: r.clone(),
            exported_base: base_revision.clone(),
            package_files: stage.files.len(),
            changed_xml: vec![],
            retained_backups: vec![],
            changes: vec![],
            blockers: vec![],
            issues: vec![],
            candidate_snapshot_hash: None,
            lineage_path: None,
            ready: false,
        };
        let mut frozen = BTreeMap::new();
        for (path, artifact) in &base.files {
            match stage.files.get(path) {
                None => p
                    .blockers
                    .push(format!("Missing original artifact: {path}")),
                Some(returned) if returned != artifact => {
                    if artifact.role != "transcript" {
                        p.blockers.push(format!(
                            "Unsupported artifact change (bytes retained in staging): {path}"
                        ));
                        continue;
                    }
                    let old = self.objects.text(&base, path)?;
                    let external = incoming.text(
                        &Snapshot {
                            files: stage.files.clone(),
                            ..base.clone()
                        },
                        path,
                    )?;
                    let old_tree = xml::parse(&old)?;
                    let new_tree = xml::parse(&external)?;
                    if signature(old_tree.root(), &old)? != signature(new_tree.root(), &external)? {
                        p.blockers.push(format!("Original content, structure, timing or unsupported XML changed: {path}"));
                        continue;
                    }
                    p.changed_xml.push(path.clone());
                    frozen.insert(path.clone(), external.clone());
                    let old_doc = xml::project_document(&r.project, path, &old, &base.config)?;
                    let new_doc = xml::project_document(&r.project, path, &external, &base.config)?;
                    let now = package::documents(&self.objects, &current)?
                        .into_iter()
                        .find(|d| d.path == *path);
                    let current_xml = self.objects.text(&current, path)?;
                    let current_tree = xml::parse(&current_xml)?;
                    for (before, after) in old_doc.tokens.iter().zip(&new_doc.tokens) {
                        ensure!(
                            before.id == after.id,
                            "returned projected token identity changed"
                        );
                        let before_fields = unqualified_fields(&old_tree, &before.id)?;
                        let after_fields = unqualified_fields(&new_tree, &before.id)?;
                        let current_fields = unqualified_fields(&current_tree, &before.id)?;
                        for field in FIELDS {
                            let a = before_fields.get(*field).cloned();
                            let b = after_fields.get(*field).cloned();
                            if a == b {
                                continue;
                            }
                            let token = now
                                .as_ref()
                                .and_then(|d| d.tokens.iter().find(|t| t.id == before.id));
                            if token.is_none_or(|t| {
                                t.original != before.original
                                    || !t.editable
                                    || t.utterance != before.utterance
                                    || t.start_us != before.start_us
                                    || t.end_us != before.end_us
                            }) {
                                p.blockers.push(format!(
                                    "Current token identity/original/time changed: {path}#{}",
                                    before.id
                                ));
                                continue;
                            }
                            let c = current_fields.get(*field).cloned();
                            let key =
                                package::hash(format!("{path}\0{}\0{field}", before.id).as_bytes());
                            let state = if c == b {
                                "already_current"
                            } else if c == a {
                                "external_change"
                            } else {
                                "conflict"
                            };
                            p.changes.push(Change {
                                key: key.clone(),
                                document: path.clone(),
                                token: before.id.clone(),
                                field: (*field).into(),
                                base: a,
                                current: c,
                                external: b,
                                state: state.into(),
                                choice: r.resolutions.get(&key).copied(),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        for (path, artifact) in stage
            .files
            .iter()
            .filter(|(p, _)| !base.files.contains_key(*p) && !p.starts_with(prefix))
        {
            if path.starts_with("backups/") && path.to_ascii_lowercase().ends_with(".xml") {
                let bytes = incoming.read(artifact)?;
                frozen.insert(path.clone(), String::from_utf8(bytes)?);
                p.retained_backups.push(path.clone());
            } else {
                p.blockers.push(format!(
                    "New artifact needs an adapter (retained in staging): {path}"
                ));
            }
        }
        ensure!(
            r.resolutions.keys().all(|key| p
                .changes
                .iter()
                .any(|c| &c.key == key && c.state == "conflict")),
            "resolution does not name a current conflict"
        );
        if p.changes.len() > MAX_CHANGES {
            p.blockers.push(format!(
                "Return exceeds {MAX_CHANGES} changed token fields; split the editing batch"
            ));
        }
        for change in &p.changes {
            if change.state == "conflict" && change.choice.is_none() {
                p.blockers.push(format!(
                    "Choose current or external: {}#{} / {}",
                    change.document, change.token, change.field
                ));
            }
        }
        let mut candidate = current.clone();
        if !p.blockers.is_empty() {
            return Ok(Prepared {
                preview: p,
                candidate,
                artifacts: vec![],
            });
        }
        for artifact in current.files.values() {
            temporary.put(&self.objects.read(artifact)?, &artifact.role)?;
        }
        let mut edits: BTreeMap<(String, String), BTreeMap<String, Option<String>>> =
            BTreeMap::new();
        for change in &p.changes {
            if change.state == "external_change"
                || (change.state == "conflict" && change.choice == Some(Choice::External))
            {
                edits
                    .entry((change.document.clone(), change.token.clone()))
                    .or_default()
                    .insert(change.field.clone(), change.external.clone());
            }
        }
        if edits.is_empty() {
            p.blockers
                .push("No external changes selected; current work is already preserved".into());
            return Ok(Prepared {
                preview: p,
                candidate,
                artifacts: vec![],
            });
        }
        for ((document, token), fields) in edits {
            let now_xml = temporary.text(&candidate, &document)?;
            let now_tree = xml::parse(&now_xml)?;
            let now_fields = unqualified_fields(&now_tree, &token)?;
            if fields
                .get("wb_normalized")
                .is_some_and(|value| value.as_ref().is_some_and(|s| !s.is_empty()))
            {
                let external = frozen.get(&document).context("changed return XML")?;
                let external_tree = xml::parse(external)?;
                let external_fields = unqualified_fields(&external_tree, &token)?;
                let selected = fields
                    .get("nform")
                    .cloned()
                    .unwrap_or_else(|| now_fields.get("nform").cloned());
                if selected != external_fields.get("nform").cloned() {
                    p.blockers.push(format!("Normalization uses a different corrected reading: {document}#{token}. Reconcile the correction first, then judge normalization in the current revision."));
                    continue;
                }
            }
            let values = fields
                .iter()
                .map(|(k, v)| (k.clone(), v.clone().unwrap_or_default()))
                .collect();
            if let Err(error) =
                package::token_fields(&temporary, &mut candidate, &document, &token, &values)
            {
                p.blockers.push(error.to_string());
                continue;
            }
            let mut remove: Vec<_> = fields
                .iter()
                .filter(|(_, v)| v.is_none())
                .map(|(k, _)| k.as_str())
                .collect();
            if remove.contains(&"wb_normalized") {
                remove.push("wb_normalized_status");
            }
            if !remove.is_empty() {
                let text = temporary.text(&candidate, &document)?;
                let changed = xml::remove_attrs(&text, "tok", &token, &remove)?;
                package::replace(&temporary, &mut candidate, &document, &changed)?;
                if remove.contains(&"nform") {
                    // Attribute absence has a different corrected-layer meaning
                    // from an explicitly empty nform, even when the intermediate
                    // token_fields patch was byte-identical.
                    if !fields.contains_key("wb_normalized") {
                        let text = temporary.text(&candidate, &document)?;
                        let tree = xml::parse(&text)?;
                        if unqualified_fields(&tree, &token)?.contains_key("wb_normalized") {
                            let changed = xml::patch_attrs(
                                &text,
                                "tok",
                                &token,
                                &BTreeMap::from([(
                                    "wb_normalized_status".into(),
                                    "unresolved".into(),
                                )]),
                            )?;
                            package::replace(&temporary, &mut candidate, &document, &changed)?;
                        }
                    }
                    package::invalidate_character_anchors(
                        &temporary,
                        &mut candidate,
                        &document,
                        &token,
                    )?;
                }
            }
        }
        if !p.blockers.is_empty() {
            return Ok(Prepared {
                preview: p,
                candidate,
                artifacts: vec![],
            });
        }
        let export_receipt = String::from_utf8(incoming.read(&stage.files[&receipt_path])?)?;
        let lineage = Lineage {
            schema: 1,
            grammar: GRAMMAR.into(),
            request: r.clone(),
            exported_base: base_revision,
            files: stage.files,
            export_receipt,
            changes: p.changes.clone(),
            frozen_xml: frozen,
        };
        let bytes = serde_json::to_vec(&lineage)?;
        if bytes.len() > xml::MAX_XML_BYTES {
            p.blockers
                .push("Retained source evidence exceeds 16 MiB; split the editing batch".into());
            return Ok(Prepared {
                preview: p,
                candidate,
                artifacts: vec![],
            });
        }
        let path = format!("{LINEAGE_PREFIX}{}.json", package::hash(&bytes));
        known_lineage(&path, &bytes)?;
        ensure!(
            !candidate.files.contains_key(&path),
            "return lineage collision"
        );
        candidate
            .files
            .insert(path.clone(), temporary.put(&bytes, &package::role(&path))?);
        p.issues = package::validate(&temporary, &candidate)?;
        p.lineage_path = Some(path);
        p.candidate_snapshot_hash = Some(package::hash(&serde_json::to_vec(&candidate)?));
        p.ready = true;
        let mut artifacts = vec![];
        for (name, artifact) in candidate
            .files
            .iter()
            .filter(|(name, a)| current.files.get(*name) != Some(*a))
        {
            artifacts.push((name.clone(), temporary.read(artifact)?));
        }
        Ok(Prepared {
            preview: p,
            candidate,
            artifacts,
        })
    }
    pub(crate) fn apply_reconciliation(
        &self,
        snapshot: &mut Snapshot,
        r: &Request,
        proof: &str,
    ) -> Result<()> {
        let prepared = self.prepare_reconciliation(r)?;
        ensure!(
            package::hash(&serde_json::to_vec(&prepared.preview)?) == proof,
            "return preview proof changed"
        );
        ensure!(
            prepared.preview.ready,
            "returned package is blocked: {}",
            prepared.preview.blockers.join("; ")
        );
        for (path, bytes) in prepared.artifacts {
            let expected = &prepared.candidate.files[&path];
            ensure!(
                self.objects.put(&bytes, &expected.role)? == *expected,
                "return staging hash mismatch"
            );
        }
        *snapshot = prepared.candidate;
        Ok(())
    }
}
