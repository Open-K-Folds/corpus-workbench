//! Closed-dialect structural proof. Unknown carriers never receive a default rule.
use crate::{
    handoff::digest,
    inventory::{Inventory, Target},
    model::*,
    package,
    store::Store,
    xml,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    ops::Range,
};

pub const GRAMMAR: &str = "teitok-plain-untimed/1";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reading {
    pub id: String,
    pub original: String,
    pub corrected: Option<String>,
    pub normalized: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetokenizeRequest {
    pub schema: u32,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub config_hash: String,
    pub inventory_hash: String,
    pub document: String,
    pub targets: Vec<Target>,
    pub replacement: Vec<Reading>,
    pub relation_endpoint: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub artifact: String,
    pub before_hash: String,
    pub after_hash: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lineage {
    schema: u32,
    grammar: String,
    request: RetokenizeRequest,
    mapping: BTreeMap<String, Vec<String>>,
    changes: Vec<Change>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preview {
    pub schema: u32,
    pub grammar: String,
    pub request: RetokenizeRequest,
    pub execution_enabled: bool,
    pub blockers: Vec<String>,
    pub mapping: BTreeMap<String, Vec<String>>,
    pub changes: Vec<Change>,
    pub candidate_snapshot_hash: Option<String>,
    pub candidate_xml: BTreeMap<String, String>,
    pub lineage_path: Option<String>,
    pub lineage_json: Option<String>,
    pub proof: String,
    pub artifact_rules: BTreeMap<String, String>,
}
struct HistoricalScope {
    paths: BTreeSet<String>,
    claimed_ids: BTreeSet<String>,
}
fn exact_value(value: &Value, typed: &impl Serialize) -> Result<()> {
    ensure!(
        *value == serde_json::to_value(typed)?,
        "unknown or incomplete managed metadata fields"
    );
    Ok(())
}
fn reserve_ids(text: &str, ids: &mut BTreeSet<String>) -> Result<()> {
    let tree = xml::parse(text)?;
    for n in tree.descendants().filter(|n| n.is_element()) {
        if let Some(id) = n
            .attribute("id")
            .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
        {
            ids.insert(id.to_string());
        }
    }
    Ok(())
}
fn historical_scope(store: &Store, snapshot: &Snapshot, document: &str) -> Result<HistoricalScope> {
    let mut scope = HistoricalScope {
        paths: BTreeSet::new(),
        claimed_ids: BTreeSet::new(),
    };
    for (path, artifact) in snapshot
        .files
        .iter()
        .filter(|(p, _)| p.starts_with("Resources/retokenization/"))
    {
        let bytes = store.objects.read(artifact)?;
        known_lineage(path, &bytes)?;
        let lineage: Lineage = serde_json::from_slice(&bytes)?;
        if lineage.request.document == document {
            scope
                .claimed_ids
                .extend(lineage.request.targets.into_iter().map(|t| t.id));
            scope
                .claimed_ids
                .extend(lineage.request.replacement.into_iter().map(|t| t.id));
        }
    }
    let prefixes: BTreeSet<_> = snapshot
        .files
        .keys()
        .filter_map(|p| {
            p.strip_prefix("Workbench/exports/")
                .and_then(|p| p.split('/').next())
                .map(|id| format!("Workbench/exports/{id}/"))
        })
        .collect();
    for prefix in prefixes {
        let id = prefix.trim_end_matches('/').rsplit('/').next().unwrap();
        uuid::Uuid::parse_str(id).context("unrecognized export namespace")?;
        let receipt_path = format!("{prefix}export-receipt.json");
        let receipt: Value = serde_json::from_str(&store.objects.text(snapshot, &receipt_path)?)?;
        package::validate_history_rows(&receipt)?;
        let keys = [
            "package_manifest_version",
            "exporter",
            "authority",
            "revision",
            "snapshot",
            "approved",
            "completeness",
            "external_id_map",
            "issues",
            "history",
            "reviews",
            "derived_generations",
        ];
        ensure!(
            receipt
                .as_object()
                .context("managed receipt object")?
                .keys()
                .all(|k| keys.contains(&k.as_str()))
                && receipt["package_manifest_version"] == 1
                && receipt["authority"] == "research-intelligence",
            "unknown managed receipt semantics"
        );
        let exported: Snapshot = serde_json::from_value(receipt["snapshot"].clone())?;
        exact_value(&receipt["snapshot"], &exported)?;
        ensure!(exported.schema == 1, "unsupported historical snapshot");
        let revision: Revision = serde_json::from_value(receipt["revision"].clone())?;
        exact_value(&receipt["revision"], &revision)?;
        ensure!(
            revision.snapshot_hash == package::hash(&serde_json::to_vec(&exported)?),
            "managed snapshot binding mismatch"
        );
        let definitions_path = format!("{prefix}definitions.json");
        let definitions: Value =
            serde_json::from_str(&store.objects.text(snapshot, &definitions_path)?)?;
        exact_value(&definitions, &exported.config)?;
        let mut expected = BTreeSet::from([receipt_path, definitions_path]);
        let history_prefix = format!("{prefix}history-objects/");
        let mut revisions = BTreeSet::new();
        let mut exported_seen = false;
        let read = |hash: &str| -> Result<Vec<u8>> {
            ensure!(hash_ok(hash), "invalid managed history hash");
            let path = format!("{history_prefix}{hash}");
            let bytes = store.objects.read(
                snapshot
                    .files
                    .get(&path)
                    .context("missing declared managed history object")?,
            )?;
            ensure!(
                package::hash(&bytes) == hash,
                "managed history name/hash mismatch"
            );
            Ok(bytes)
        };
        for item in receipt["history"]
            .as_array()
            .context("missing declared managed history")?
        {
            let rev: Revision = serde_json::from_value(item.clone())?;
            exact_value(item, &rev)?;
            ensure!(
                revisions.insert(rev.id),
                "duplicate managed history revision"
            );
            let bytes = read(&rev.snapshot_hash)?;
            expected.insert(format!("{history_prefix}{}", rev.snapshot_hash));
            let raw: Value = serde_json::from_slice(&bytes)?;
            let historic: Snapshot = serde_json::from_value(raw.clone())?;
            exact_value(&raw, &historic)?;
            ensure!(
                historic.schema == 1 && historic.project == exported.project,
                "historical snapshot scope mismatch"
            );
            if rev.id == revision.id {
                ensure!(
                    rev.snapshot_hash == revision.snapshot_hash,
                    "declared export revision mismatch"
                );
                exported_seen = true;
            }
            for (path, artifact) in &historic.files {
                package::safe_relative(path)?;
                let bytes = read(&artifact.sha256)?;
                ensure!(
                    bytes.len() as u64 == artifact.bytes,
                    "historical artifact size mismatch"
                );
                expected.insert(format!("{history_prefix}{}", artifact.sha256));
                if path == document {
                    reserve_ids(std::str::from_utf8(&bytes)?, &mut scope.claimed_ids)?;
                }
                if path.starts_with("Resources/retokenization/") {
                    known_lineage(path, &bytes)?;
                    let lineage: Lineage = serde_json::from_slice(&bytes)?;
                    if lineage.request.document == document {
                        scope
                            .claimed_ids
                            .extend(lineage.request.targets.into_iter().map(|t| t.id));
                        scope
                            .claimed_ids
                            .extend(lineage.request.replacement.into_iter().map(|t| t.id));
                    }
                }
            }
        }
        ensure!(
            exported_seen,
            "export revision absent from declared history"
        );
        for generation in receipt["derived_generations"]
            .as_array()
            .context("missing historical generation list")?
        {
            let receipt_hash = generation["receipt_hash"]
                .as_str()
                .context("historical completion hash")?;
            let completion_bytes = read(receipt_hash)?;
            let completion: crate::handoff::Completion = serde_json::from_slice(&completion_bytes)?;
            let raw: Value = serde_json::from_slice(&completion_bytes)?;
            exact_value(&raw, &completion)?;
            ensure!(
                generation["graph_hash"].as_str() == Some(&completion.graph_hash)
                    && completion.binding.project == exported.project
                    && revisions.contains(&completion.binding.revision),
                "historical compiler binding mismatch"
            );
            for hash in [
                receipt_hash,
                &completion.graph_hash,
                &completion.binding.contract_hash,
            ] {
                read(hash)?;
                expected.insert(format!("{history_prefix}{hash}"));
            }
        }
        let actual: BTreeSet<_> = snapshot
            .files
            .keys()
            .filter(|p| p.starts_with(&prefix))
            .cloned()
            .collect();
        ensure!(
            actual == expected,
            "undeclared managed namespace artifact or missing dependency"
        );
        scope.paths.extend(expected);
    }
    Ok(scope)
}
type Patch = (Range<usize>, String);
fn hash_ok(v: &str) -> bool {
    v.len() == 64 && v.bytes().all(|b| b.is_ascii_hexdigit())
}
fn basic(r: &RetokenizeRequest) -> Result<()> {
    ensure!(
        r.schema == 1 && xml::valid_name(&r.project) && r.revision > 0,
        "unsupported retokenization request"
    );
    ensure!(
        [&r.snapshot_hash, &r.config_hash, &r.inventory_hash]
            .iter()
            .all(|h| hash_ok(h)),
        "invalid structural binding hash"
    );
    package::safe_relative(&r.document)?;
    ensure!(
        matches!((r.targets.len(), r.replacement.len()), (1, 2) | (2, 1)),
        "only one-to-two split or adjacent two-to-one merge is supported"
    );
    let mut ids = BTreeSet::new();
    for t in &r.targets {
        ensure!(
            t.artifact == r.document && xml::valid_name(&t.id) && ids.insert(&t.id),
            "invalid qualified token targets"
        );
    }
    ids.clear();
    for p in &r.replacement {
        ensure!(
            xml::valid_name(&p.id) && ids.insert(&p.id) && !p.original.is_empty(),
            "replacement IDs/readings must be nonempty and unique"
        );
        for v in [
            Some(&p.original),
            p.corrected.as_ref(),
            p.normalized.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            xml::escape(v)?;
        }
    }
    ensure!(
        r.relation_endpoint
            .as_ref()
            .is_none_or(|v| r.replacement.iter().any(|p| &p.id == v)),
        "relation endpoint must be an explicit replacement ID"
    );
    Ok(())
}
fn known_lineage(path: &str, bytes: &[u8]) -> Result<()> {
    ensure!(bytes.len() <= 1_048_576, "lineage size limit");
    let record: Lineage = serde_json::from_slice(bytes)?;
    ensure!(
        record.schema == 1 && record.grammar == GRAMMAR,
        "unsupported historical structural lineage"
    );
    basic(&record.request)?;
    ensure!(
        path == format!("Resources/retokenization/{}.json", package::hash(bytes)),
        "lineage path/hash mismatch"
    );
    let expected: BTreeMap<_, _> = record
        .request
        .targets
        .iter()
        .map(|t| {
            (
                t.id.clone(),
                record
                    .request
                    .replacement
                    .iter()
                    .map(|p| p.id.clone())
                    .collect(),
            )
        })
        .collect();
    ensure!(
        record.mapping == expected
            && !record.changes.is_empty()
            && record.changes.len() <= package::MAX_ENTRIES,
        "incomplete historical remapping"
    );
    for c in &record.changes {
        package::safe_relative(&c.artifact)?;
        ensure!(
            hash_ok(&c.before_hash) && hash_ok(&c.after_hash),
            "invalid historical artifact binding"
        );
    }
    // Every ID/path in this strictly typed format is explicitly historical;
    // this record does not assert approval or supply a current XML reference.
    Ok(())
}
pub(crate) fn lineage_summary(path: &str, bytes: &[u8]) -> Result<Value> {
    known_lineage(path, bytes)?;
    let record: Lineage = serde_json::from_slice(bytes)?;
    Ok(
        serde_json::json!({"grammar":record.grammar,"document":record.request.document,"base_revision":record.request.revision,"mapping":record.mapping,"historical_only":true}),
    )
}
fn grammar(path: &str, text: &str, kind: &str, inventory: &Inventory) -> Result<()> {
    let tree = xml::parse(text)?;
    let root = tree.root_element();
    ensure!(
        root.tag_name().namespace().is_none(),
        "namespaced structural dialect requires a decoder"
    );
    let expected = match kind {
        "transcript" => "TEI",
        "settings" => "ttsettings",
        "sidecar" => "spanGrp",
        _ => unreachable!(),
    };
    ensure!(root.has_tag_name(expected), "unsupported {kind} root");
    for n in tree.descendants().filter(|n| n.is_element()) {
        let name = n.tag_name().name();
        ensure!(
            n.tag_name().namespace().is_none(),
            "unknown element namespace"
        );
        let parent = n.parent_element().map(|p| p.tag_name().name());
        let attrs: &[&str] = match (kind, name, parent) {
            ("transcript", "TEI", None) => &["variety"],
            ("transcript", "text", Some("TEI")) | ("transcript", "body", Some("text")) => {
                &["variety"]
            }
            ("transcript", "u", Some("text" | "body")) => &["id", "start", "end", "variety"],
            ("transcript", "tok", Some("text" | "body" | "u")) => &[
                "id",
                "form",
                "nform",
                "wb_normalized",
                "wb_normalized_status",
                "variety",
                "start",
                "end",
                "relation_target",
                "relation_type",
                "note",
            ],
            ("settings", "ttsettings", None) => &[],
            ("sidecar", "spanGrp", None) => &[],
            ("sidecar", "span", Some("spanGrp")) => &[
                "id",
                "corresp",
                "label",
                "variety",
                "note",
                "wb_start",
                "wb_end",
                "wb_quote",
                "wb_coordinate",
                "wb_layer",
                "wb_status",
            ],
            _ => anyhow::bail!("unknown structural element/parent {name}"),
        };
        let (lexical, _) = xml::lexical_attrs(text, n.range().start)?;
        for a in n.attributes() {
            ensure!(
                a.namespace().is_none() && attrs.contains(&a.name()),
                "unknown attribute carrier {} on {name}",
                a.name()
            );
        }
        ensure!(
            lexical.keys().all(|a| attrs.contains(&a.as_str())),
            "namespace or unknown lexical attribute carrier"
        );
        if matches!(name, "tok" | "u" | "span") {
            ensure!(
                n.attribute("id").is_some_and(xml::valid_name),
                "unsupported or missing stable ID"
            );
        }
        if name == "tok" {
            ensure!(
                !n.children().any(|c| !c.is_text()),
                "mixed token XML requires a converter"
            );
            let body = n.children().filter_map(|c| c.text()).collect::<String>();
            ensure!(
                n.attribute("form").is_none_or(|v| v == body),
                "original form/body divergence needs an explicit text rule"
            );
            ensure!(
                n.attribute("wb_normalized_status")
                    .is_none_or(|v| v == "resolved" && n.attribute("wb_normalized").is_some()),
                "unresolved normalized provenance"
            );
            if let Some(target) = n.attribute("relation_target") {
                ensure!(
                    xml::valid_name(target.strip_prefix('#').unwrap_or(target))
                        && n.attribute("relation_type")
                            .is_some_and(|v| !v.trim().is_empty()),
                    "unsupported relation endpoint/type"
                );
                ensure!(
                    text[lexical["relation_target"].clone()] == *target,
                    "entity-encoded relation requires a lexical decoder"
                );
            } else {
                ensure!(
                    n.attribute("relation_type").is_none(),
                    "relation type without endpoint"
                );
            }
        } else {
            ensure!(
                n.children().filter(|c| c.is_text()).all(|c| c
                    .text()
                    .unwrap_or("")
                    .trim()
                    .is_empty()),
                "non-token mixed text requires a converter"
            );
        }
        if name == "span" {
            let refs = n
                .attribute("corresp")
                .context("span without token-list scope")?;
            let ids: Vec<_> = refs
                .split_whitespace()
                .map(|v| v.strip_prefix('#').unwrap_or(v))
                .collect();
            ensure!(
                !ids.is_empty()
                    && ids.iter().all(|v| xml::valid_name(v))
                    && ids.iter().collect::<BTreeSet<_>>().len() == ids.len(),
                "unsupported or duplicate span token list"
            );
            ensure!(
                !text[lexical["corresp"].clone()].contains('&'),
                "entity-encoded reference list requires a lexical decoder"
            );
        }
    }
    for c in inventory.carriers.iter().filter(|c| c.artifact == path) {
        match c.kind.as_str() {
            "attribute" => {}
            "text" => ensure!(
                c.element == "tok" || c.value.trim().is_empty(),
                "unknown text carrier at byte {}",
                c.byte_start
            ),
            "xml-declaration" => ensure!(
                ["<?xml version='1.0'?>", "<?xml version=\"1.0\"?>"]
                    .contains(&&text[c.byte_start..c.byte_end]),
                "unsupported XML declaration carrier"
            ),
            _ => anyhow::bail!("unknown {} carrier at byte {}", c.kind, c.byte_start),
        }
    }
    Ok(())
}
fn patch_all(text: &str, mut patches: Vec<Patch>) -> Result<String> {
    patches.sort_by_key(|(r, _)| r.start);
    for pair in patches.windows(2) {
        ensure!(
            pair[0].0.end <= pair[1].0.start,
            "overlapping structural patches"
        );
    }
    let mut result = text.to_string();
    for (r, v) in patches.into_iter().rev() {
        ensure!(
            r.start <= r.end
                && r.end <= result.len()
                && result.is_char_boundary(r.start)
                && result.is_char_boundary(r.end),
            "invalid structural byte range"
        );
        result.replace_range(r, &v);
    }
    xml::parse(&result)?;
    Ok(result)
}
fn ref_words(raw: &str) -> Vec<(Range<usize>, &str)> {
    let mut words = Vec::new();
    let mut pos = 0;
    for word in raw.split_whitespace() {
        let start = raw[pos..].find(word).unwrap() + pos;
        words.push((start..start + word.len(), word));
        pos = start + word.len();
    }
    words
}
fn ref_list(raw: &str, mapping: &BTreeMap<String, Vec<String>>) -> String {
    let mut result = raw.to_string();
    let mut patches = Vec::new();
    let mut prior: Option<String> = None;
    for (range, word) in ref_words(raw) {
        let (prefix, id) = if let Some(id) = word.strip_prefix('#') {
            ("#", id)
        } else {
            ("", word)
        };
        if let Some(ids) = mapping.get(id) {
            let value = if ids.len() == 1 && prior.as_ref() == ids.first() {
                String::new()
            } else {
                ids.iter()
                    .map(|id| format!("{prefix}{id}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            };
            patches.push((range, value));
            prior = ids.last().cloned();
        } else {
            prior = Some(id.to_string());
        }
    }
    for (r, v) in patches.into_iter().rev() {
        result.replace_range(r, &v)
    }
    result
}
fn char_text(p: &Reading) -> &str {
    p.corrected.as_deref().unwrap_or(&p.original)
}
fn preserve_layer(old: &[Option<&str>], new: &[Option<&str>], separator: &str) -> Result<()> {
    ensure!(
        old.iter().all(Option::is_some) || old.iter().all(Option::is_none),
        "merge requires consistent presence of each text layer"
    );
    ensure!(
        new.iter().all(|v| v.is_some() == old[0].is_some()),
        "replacement must preserve text-layer presence"
    );
    if old[0].is_some() {
        ensure!(
            old.iter()
                .map(|v| v.unwrap())
                .collect::<Vec<_>>()
                .join(separator)
                == new.iter().map(|v| v.unwrap()).collect::<String>(),
            "replacement would lose or alter a text layer"
        );
    }
    Ok(())
}
impl Store {
    pub fn retokenization_preview(&self, r: &RetokenizeRequest) -> Result<Preview> {
        ensure!(
            self.head(&r.project)?.id == r.revision,
            "stale retokenization revision"
        );
        let inv = self.reference_inventory(&r.project, r.revision)?;
        ensure!(
            inv.snapshot_hash == r.snapshot_hash
                && inv.config_hash == r.config_hash
                && digest(&inv)? == r.inventory_hash,
            "stale structural inventory binding"
        );
        ensure!(
            r.targets.iter().all(|t| inv.ids.contains(t)),
            "unknown qualified retokenization target"
        );
        let mut p=Preview{schema:1,grammar:GRAMMAR.into(),request:r.clone(),execution_enabled:false,blockers:vec![],mapping:BTreeMap::new(),changes:vec![],candidate_snapshot_hash:None,candidate_xml:BTreeMap::new(),lineage_path:None,lineage_json:None,artifact_rules:BTreeMap::new(),proof:"Closed whole-package grammar; original/corrected/normalized text conservation; exact character quotes and ordered span coverage; explicit incoming relation choice; fresh historical IDs; immutable mapping; no inferred times; atomic native revision and fresh review required.".into()};
        if let Err(e) = basic(r) {
            p.blockers.push(e.to_string());
            return Ok(p);
        }
        let view = self.view(&r.project, Some(r.revision))?;
        let history = match historical_scope(self, &view.snapshot, &r.document) {
            Ok(h) => h,
            Err(e) => {
                p.blockers
                    .push(format!("managed historical namespace: {e}"));
                return Ok(p);
            }
        };
        for issue in view.issues.iter().filter(|i| i.blocking) {
            p.blockers
                .push(format!("{}: {}", issue.target, issue.message));
        }
        let packaged_reader = view
            .snapshot
            .files
            .get(crate::teitok_reader::SETTINGS_PATH)
            .is_some_and(|artifact| {
                artifact.sha256 == package::hash(crate::teitok_reader::SETTINGS.as_bytes())
            });
        if packaged_reader
            && !view
                .snapshot
                .files
                .contains_key(crate::teitok_reader::DEFINITION_PATH)
        {
            p.blockers
                .push("Packaged reader profile requires its annotation definition".into());
        }
        if packaged_reader {
            p.blockers
                .extend(crate::teitok_reader::scope_blockers(&view.snapshot));
        }
        for a in &inv.artifacts {
            let bytes = self.objects.read(&a.artifact)?;
            let checked = if history.paths.contains(&a.path)
                || crate::teitok_reader::known(&a.path, &bytes)
            {
                Ok(())
            } else if a.path.starts_with("Resources/retokenization/") {
                known_lineage(&a.path, &bytes)
            } else {
                let kind = if a.artifact.role == "transcript" {
                    Some("transcript")
                } else if a.path == "Resources/settings.xml" {
                    Some("settings")
                } else if a.path.starts_with("Annotations/")
                    && !a.path.ends_with("_def.xml")
                    && view
                        .documents
                        .iter()
                        .filter(|d| {
                            a.path
                                .ends_with(&format!("_{}", d.path.rsplit('/').next().unwrap()))
                        })
                        .count()
                        == 1
                {
                    Some("sidecar")
                } else {
                    None
                };
                if let Some(kind) = kind {
                    std::str::from_utf8(&bytes)
                        .map_err(anyhow::Error::from)
                        .and_then(|text| grammar(&a.path, text, kind, &inv))
                } else {
                    Err(anyhow::anyhow!(
                        "no verified artifact/reference decoder; immutable bytes preserved"
                    ))
                }
            };
            if let Err(e) = checked {
                p.blockers.push(format!("{}: {e}", a.path));
            } else {
                p.artifact_rules.insert(a.path.clone(), if crate::teitok_reader::known(&a.path, &bytes) {"byte-exact immutable reader profile; fixed schema keys/labels and installation asset paths are literal, never document token endpoints"} else if history.paths.contains(&a.path) {"hash/schema-verified immutable export history; references remain historical"} else if a.path.starts_with("Resources/retokenization/") {"strictly typed hash-bound immutable successor lineage"} else {"closed XML carrier grammar; literal fields remain literal; declared current endpoints remapped"}.into());
            }
        }
        if !p.blockers.is_empty() {
            return Ok(p);
        }
        if let Err(e) = self.prove_retokenization(&view, &inv, &history, r, &mut p) {
            p.blockers.push(e.to_string());
            p.mapping.clear();
            p.changes.clear();
            p.candidate_xml.clear();
            p.lineage_json = None;
            p.lineage_path = None;
            p.candidate_snapshot_hash = None;
            return Ok(p);
        }
        p.execution_enabled = true;
        Ok(p)
    }
    fn prove_retokenization(
        &self,
        view: &View,
        inv: &Inventory,
        history: &HistoricalScope,
        r: &RetokenizeRequest,
        p: &mut Preview,
    ) -> Result<()> {
        let doc = view
            .documents
            .iter()
            .find(|d| d.path == r.document)
            .context("document scope not found")?;
        let selected: Vec<_> = r
            .targets
            .iter()
            .map(|t| {
                doc.tokens
                    .iter()
                    .find(|token| token.id == t.id)
                    .context("target must be a token")
            })
            .collect::<Result<_>>()?;
        let text = self.objects.text(&view.snapshot, &r.document)?;
        let tree = xml::parse(&text)?;
        let nodes: Vec<_> = r
            .targets
            .iter()
            .map(|t| {
                tree.descendants()
                    .find(|n| {
                        n.is_element()
                            && n.range().start == t.element_start
                            && n.has_tag_name("tok")
                            && n.attribute("id") == Some(&t.id)
                    })
                    .context("qualified target is not the exact token")
            })
            .collect::<Result<_>>()?;
        for token in &selected {
            ensure!(
                token.start_us.is_none() && token.end_us.is_none(),
                "selected word timing cannot be divided or inferred"
            );
            ensure!(token.attrs.keys().all(|a|["id","form","nform","wb_normalized","wb_normalized_status","variety"].contains(&a.as_str())),"selected outgoing relation/note requires explicit judgment redistribution; operation blocked");
        }
        let split = selected.len() == 1;
        let separator = if split {
            ""
        } else {
            ensure!(
                nodes[0].parent() == nodes[1].parent()
                    && nodes[0].next_sibling_element() == Some(nodes[1]),
                "merge requires ordered adjacent siblings with the same immediate parent"
            );
            ensure!(
                nodes[0].range().end <= nodes[1].range().start,
                "reversed token merge"
            );
            let gap = &text[nodes[0].range().end..nodes[1].range().start];
            ensure!(gap.len()<=64&&gap.bytes().all(|b|b==b' '),"merge separator must be empty or literal ASCII spaces; other markup/whitespace requires a text rule");
            gap
        };
        preserve_layer(
            &selected
                .iter()
                .map(|t| Some(t.original.as_str()))
                .collect::<Vec<_>>(),
            &r.replacement
                .iter()
                .map(|t| Some(t.original.as_str()))
                .collect::<Vec<_>>(),
            separator,
        )?;
        preserve_layer(
            &selected
                .iter()
                .map(|t| t.corrected.as_deref())
                .collect::<Vec<_>>(),
            &r.replacement
                .iter()
                .map(|t| t.corrected.as_deref())
                .collect::<Vec<_>>(),
            separator,
        )?;
        preserve_layer(
            &selected
                .iter()
                .map(|t| t.normalized.as_deref())
                .collect::<Vec<_>>(),
            &r.replacement
                .iter()
                .map(|t| t.normalized.as_deref())
                .collect::<Vec<_>>(),
            separator,
        )?;
        ensure!(
            selected.iter().all(|t| t.attrs.get("wb_normalized_status")
                == selected[0].attrs.get("wb_normalized_status")),
            "merge requires identical normalized review provenance"
        );
        let variety = selected[0].attrs.get("variety");
        ensure!(
            selected.iter().all(|t| t.attrs.get("variety") == variety),
            "merge cannot flatten distinct explicit language judgments"
        );
        let mut used = history.claimed_ids.clone();
        for rev in self
            .history(&r.project)?
            .into_iter()
            .filter(|v| v.id <= r.revision)
        {
            let historic = self.snapshot(&rev)?;
            if let Some(a) = historic.files.get(&r.document) {
                let source = self.objects.read(a)?;
                let text = std::str::from_utf8(&source)?;
                let parsed = xml::parse(text)?;
                for n in parsed.descendants().filter(|n| n.is_element()) {
                    if let Some(id) = n
                        .attribute("id")
                        .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
                    {
                        used.insert(id.to_string());
                    }
                }
            }
        }
        ensure!(r.replacement.iter().all(|t|!used.contains(&t.id)),"replacement ID already occurs in current or historical evidence; old compiler identity cannot be reused");
        for t in &r.targets {
            p.mapping.insert(
                t.id.clone(),
                r.replacement.iter().map(|t| t.id.clone()).collect(),
            );
        }
        let incoming = doc
            .tokens
            .iter()
            .filter(|t| {
                t.attrs
                    .get("relation_target")
                    .is_some_and(|id| p.mapping.contains_key(id.strip_prefix('#').unwrap_or(id)))
            })
            .count();
        ensure!(
            !split || incoming == 0 || r.relation_endpoint.is_some(),
            "split requires an explicit incoming relation endpoint choice"
        );
        ensure!(
            split || r.relation_endpoint.is_none(),
            "merge endpoint is uniquely determined; no extra endpoint choice"
        );
        let mut new_tokens = String::new();
        for token in &r.replacement {
            new_tokens.push_str(&format!(
                "<tok id=\"{}\" form=\"{}\"",
                xml::escape(&token.id)?,
                xml::escape(&token.original)?
            ));
            for (key, value) in [
                ("nform", token.corrected.as_ref()),
                ("wb_normalized", token.normalized.as_ref()),
                ("variety", variety),
            ] {
                if let Some(value) = value {
                    new_tokens.push_str(&format!(" {key}=\"{}\"", xml::escape(value)?));
                }
            }
            if selected[0].attrs.contains_key("wb_normalized_status") {
                new_tokens.push_str(" wb_normalized_status=\"resolved\"");
            }
            new_tokens.push_str(&format!(">{}</tok>", xml::escape(&token.original)?));
        }
        let mut patches = vec![(
            nodes[0].range().start..nodes.last().unwrap().range().end,
            new_tokens,
        )];
        for token in &doc.tokens {
            let Some(target) = token.attrs.get("relation_target") else {
                continue;
            };
            let id = target.strip_prefix('#').unwrap_or(target);
            if !p.mapping.contains_key(id) {
                continue;
            }
            let node = tree
                .descendants()
                .find(|n| n.has_tag_name("tok") && n.attribute("id") == Some(&token.id))
                .context("relation source")?;
            let range = xml::lexical_attrs(&text, node.range().start)?.0["relation_target"].clone();
            let new_id = if split {
                r.relation_endpoint.as_ref().unwrap()
            } else {
                &r.replacement[0].id
            };
            patches.push((
                range,
                format!(
                    "{}{}",
                    if target.starts_with('#') { "#" } else { "" },
                    new_id
                ),
            ));
        }
        p.candidate_xml
            .insert(r.document.clone(), patch_all(&text, patches)?);
        let sidecars: BTreeSet<_> = doc.spans.iter().map(|s| s.sidecar.clone()).collect();
        for sidecar in sidecars {
            ensure!(
                view.documents
                    .iter()
                    .filter(|d| d.spans.iter().any(|s| s.sidecar == sidecar))
                    .count()
                    == 1,
                "shared annotation sidecar needs explicit owner resolution"
            );
            let source = self.objects.text(&view.snapshot, &sidecar)?;
            let tree = xml::parse(&source)?;
            let mut patches = Vec::new();
            for span in doc.spans.iter().filter(|s| {
                s.sidecar == sidecar && s.token_ids.iter().any(|id| p.mapping.contains_key(id))
            }) {
                let node = tree
                    .descendants()
                    .find(|n| n.has_tag_name("span") && n.attribute("id") == Some(&span.id))
                    .context("qualified span")?;
                let attrs = xml::lexical_attrs(&source, node.range().start)?.0;
                if span.fields.contains_key("wb_start") {
                    ensure!(
                        span.token_ids.len() == 1
                            && span.fields.get("wb_status").map(String::as_str) == Some("resolved"),
                        "character judgment must be an exact resolved single-token anchor"
                    );
                    let start: usize = span.fields["wb_start"].parse()?;
                    let end: usize = span.fields["wb_end"].parse()?;
                    let old_index = selected
                        .iter()
                        .position(|t| t.id == span.token_ids[0])
                        .context("character target")?;
                    let (part, offset) = if split {
                        let boundary = char_text(&r.replacement[0]).chars().count();
                        if end <= boundary {
                            (0, 0)
                        } else if start >= boundary {
                            (1, boundary)
                        } else {
                            anyhow::bail!(
                                "character span {} crosses the split; explicit converter required",
                                span.id
                            )
                        }
                    } else {
                        (0, 0)
                    };
                    let (new_start, new_end) = if split {
                        (start - offset, end - offset)
                    } else {
                        let add = if old_index == 0 {
                            0
                        } else {
                            selected[0]
                                .corrected
                                .as_ref()
                                .unwrap_or(&selected[0].original)
                                .chars()
                                .count()
                                + separator.chars().count()
                        };
                        (start + add, end + add)
                    };
                    let chars: Vec<_> = char_text(&r.replacement[part]).chars().collect();
                    ensure!(
                        new_start < new_end
                            && new_end <= chars.len()
                            && chars[new_start..new_end].iter().collect::<String>()
                                == span.fields["wb_quote"],
                        "character quote must survive exactly"
                    );
                    for (key, value) in [
                        ("wb_start", new_start.to_string()),
                        ("wb_end", new_end.to_string()),
                    ] {
                        patches.push((attrs[key].clone(), value));
                    }
                    let raw = &source[attrs["corresp"].clone()];
                    let prefix = if raw.starts_with('#') { "#" } else { "" };
                    patches.push((
                        attrs["corresp"].clone(),
                        format!("{prefix}{}", r.replacement[part].id),
                    ));
                } else {
                    if !split {
                        let positions: Vec<_> = span
                            .token_ids
                            .iter()
                            .enumerate()
                            .filter(|(_, id)| p.mapping.contains_key(*id))
                            .collect();
                        ensure!(positions.len()==2&&positions[0].0+1==positions[1].0&&positions[0].1==&selected[0].id&&positions[1].1==&selected[1].id,"merge span {} would expand/reorder token coverage; explicit converter required",span.id);
                    }
                    let range = attrs["corresp"].clone();
                    patches.push((range.clone(), ref_list(&source[range], &p.mapping)));
                }
            }
            if !patches.is_empty() {
                p.candidate_xml
                    .insert(sidecar, patch_all(&source, patches)?);
            }
        }
        // Reproject every changed transcript and verify every supported current
        // reference against the candidate; no temporary authority writes.
        let candidate_doc = xml::project_document(
            &r.project,
            &r.document,
            &p.candidate_xml[&r.document],
            &view.snapshot.config,
        )?;
        let ids: BTreeSet<_> = candidate_doc.tokens.iter().map(|t| t.id.as_str()).collect();
        for span in &doc.spans {
            let text = p
                .candidate_xml
                .get(&span.sidecar)
                .map(String::as_str)
                .unwrap_or("");
            let owned = if text.is_empty() {
                self.objects.text(&view.snapshot, &span.sidecar)?
            } else {
                text.to_string()
            };
            let tree = xml::parse(&owned)?;
            let n = tree
                .descendants()
                .find(|n| n.has_tag_name("span") && n.attribute("id") == Some(&span.id))
                .context("candidate span")?;
            ensure!(
                n.attribute("corresp")
                    .context("candidate corresp")?
                    .split_whitespace()
                    .all(|v| ids.contains(v.strip_prefix('#').unwrap_or(v))),
                "candidate has dangling span"
            );
        }
        let mut candidate = view.snapshot.clone();
        for (path, text) in &p.candidate_xml {
            let before = &candidate.files[path];
            let after = Artifact {
                sha256: package::hash(text.as_bytes()),
                bytes: text.len() as u64,
                role: before.role.clone(),
            };
            p.changes.push(Change {
                artifact: path.clone(),
                before_hash: before.sha256.clone(),
                after_hash: after.sha256.clone(),
            });
            candidate.files.insert(path.clone(), after);
        }
        let lineage = Lineage {
            schema: 1,
            grammar: GRAMMAR.into(),
            request: r.clone(),
            mapping: p.mapping.clone(),
            changes: p.changes.clone(),
        };
        let bytes = serde_json::to_vec(&lineage)?;
        let sha = package::hash(&bytes);
        let path = format!("Resources/retokenization/{sha}.json");
        ensure!(!candidate.files.contains_key(&path), "lineage collision");
        known_lineage(&path, &bytes)?;
        candidate.files.insert(
            path.clone(),
            Artifact {
                sha256: sha,
                bytes: bytes.len() as u64,
                role: package::role(&path),
            },
        );
        candidate.index_status = "stale; byte-offset indexes cannot be queried".into();
        p.candidate_snapshot_hash = Some(package::hash(&serde_json::to_vec(&candidate)?));
        p.lineage_path = Some(path);
        p.lineage_json = Some(String::from_utf8(bytes)?);
        ensure!(
            inv.artifacts.len() == view.snapshot.files.len(),
            "incomplete package inventory"
        );
        Ok(())
    }
    pub(crate) fn apply_retokenization(
        &self,
        snapshot: &mut Snapshot,
        r: &RetokenizeRequest,
        preview_hash: &str,
    ) -> Result<()> {
        let p = self.retokenization_preview(r)?;
        ensure!(
            digest(&p)? == preview_hash,
            "stale or forged structural preview"
        );
        ensure!(
            p.execution_enabled,
            "retokenization blocked: {}",
            p.blockers.join("; ")
        );
        for (path, text) in &p.candidate_xml {
            package::replace(&self.objects, snapshot, path, text)?;
        }
        let path = p.lineage_path.as_ref().context("proved lineage path")?;
        let bytes = p
            .lineage_json
            .as_ref()
            .context("proved lineage bytes")?
            .as_bytes();
        snapshot
            .files
            .insert(path.clone(), self.objects.put(bytes, &package::role(path))?);
        ensure!(
            Some(package::hash(&serde_json::to_vec(snapshot)?)) == p.candidate_snapshot_hash,
            "structural candidate changed after proof"
        );
        Ok(())
    }
}
