use crate::{model::*, xml};
use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

pub const MAX_PACKAGE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 10000;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn safe_relative(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty()
            && path.len() < 240
            && !path.contains('\\')
            && !path.contains(':')
            && !path.contains('\0'),
        "unsafe path"
    );
    ensure!(
        Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_))),
        "unsafe path traversal"
    );
    for part in path.split('/') {
        ensure!(
            !part.ends_with('.')
                && !part.ends_with(' ')
                && (!part.starts_with('.') || part == ".htaccess"),
            "unsafe or hidden path"
        );
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        ensure!(
            ![
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9"
            ]
            .contains(&stem.as_str()),
            "reserved filename"
        );
    }
    Ok(())
}
pub fn role(path: &str) -> String {
    let p = path.to_ascii_lowercase();
    if p.starts_with("audio/") || p.starts_with("video/") {
        "source-media"
    } else if p.starts_with("raw/") {
        "immutable-machine-draft"
    } else if p.starts_with("xmlfiles/") && p.ends_with(".xml") {
        "transcript"
    } else if p.contains("settings.xml") {
        "project-settings"
    } else if p.starts_with("annotations/") {
        "annotation-sidecar-or-definition"
    } else if p.starts_with("cwb/") || p.starts_with("registry/") {
        "derived-index"
    } else if p.ends_with(".php")
        || p.ends_with(".pl")
        || p.ends_with(".sh")
        || p.ends_with(".js")
        || p.ends_with(".exe")
        || p.ends_with(".py")
    {
        "inert-compatibility-dependency"
    } else {
        "opaque-project-artifact"
    }
    .into()
}
// Managed exports promise complete linear native history, including restored
// states. Missing ancestors can otherwise erase retired identity claims.
pub(crate) fn validate_history_rows(receipt: &serde_json::Value) -> Result<Vec<Revision>> {
    let exported: Revision = serde_json::from_value(receipt["revision"].clone())?;
    let mut rows = BTreeMap::new();
    let mut ordered = Vec::new();
    for value in receipt["history"]
        .as_array()
        .context("managed export history missing")?
    {
        let row: Revision = serde_json::from_value(value.clone())?;
        ensure!(
            *value == serde_json::to_value(&row)? && row.id > 0,
            "unknown or invalid managed history row"
        );
        ensure!(
            row.parent.is_none_or(|p| p > 0 && p < row.id),
            "invalid managed history parent"
        );
        ensure!(
            rows.insert(row.id, row.clone()).is_none(),
            "duplicate managed history revision"
        );
        ordered.push(row);
    }
    ensure!(
        receipt["revision"] == serde_json::to_value(&exported)?
            && rows.get(&exported.id).is_some_and(
                |row| serde_json::to_value(row).ok() == Some(receipt["revision"].clone())
            ),
        "exported revision row differs from history"
    );
    let mut seen = BTreeSet::new();
    let mut next = Some(exported.id);
    while let Some(id) = next {
        ensure!(seen.insert(id), "managed history cycle");
        next = rows
            .get(&id)
            .context("missing managed history parent revision")?
            .parent;
    }
    ensure!(
        seen.len() == rows.len(),
        "detached managed history revision"
    );
    Ok(ordered)
}
pub struct Objects {
    pub root: PathBuf,
}
impl Objects {
    pub fn new(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        Ok(Self { root: root.into() })
    }
    pub fn put(&self, bytes: &[u8], role: &str) -> Result<Artifact> {
        let sha = hash(bytes);
        let target = self.root.join(&sha);
        if target.exists() {
            ensure!(self.read_hash(&sha)? == bytes, "object corruption");
        } else {
            let staged = self.root.join(format!("stage-{}", uuid::Uuid::new_v4()));
            let mut f = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&staged)?;
            f.write_all(bytes)?;
            f.sync_all()?;
            drop(f);
            ensure!(
                hash(&fs::read(&staged)?) == sha,
                "staging checksum mismatch"
            );
            fs::rename(&staged, &target)?;
            #[cfg(unix)]
            File::open(&self.root)?.sync_all()?;
        }
        Ok(Artifact {
            sha256: sha,
            bytes: bytes.len() as u64,
            role: role.into(),
        })
    }
    pub fn read_hash(&self, sha: &str) -> Result<Vec<u8>> {
        ensure!(
            sha.len() == 64 && sha.bytes().all(|c| c.is_ascii_hexdigit()),
            "invalid object hash"
        );
        let bytes = fs::read(self.root.join(sha)).context("missing immutable object")?;
        ensure!(hash(&bytes) == sha, "immutable object checksum mismatch");
        Ok(bytes)
    }
    pub fn read(&self, object: &Artifact) -> Result<Vec<u8>> {
        let bytes = self.read_hash(&object.sha256)?;
        ensure!(bytes.len() as u64 == object.bytes, "object size mismatch");
        Ok(bytes)
    }
    pub fn text(&self, snapshot: &Snapshot, path: &str) -> Result<String> {
        Ok(String::from_utf8(self.read(
            snapshot.files.get(path).context("missing artifact")?,
        )?)?)
    }
}
pub fn import(objects: &Objects, dir: &Path, project: &str) -> Result<Snapshot> {
    ensure!(dir.is_dir(), "import requires a directory package");
    ensure!(xml::valid_name(project), "invalid project ID");
    let mut files = BTreeMap::new();
    let mut folded = BTreeSet::new();
    let mut total = 0;
    for entry in WalkDir::new(dir).follow_links(false) {
        let entry = entry?;
        ensure!(!entry.file_type().is_symlink(), "symlink import disabled");
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(dir)?
            .to_str()
            .context("non-Unicode path")?
            .replace('\\', "/");
        safe_relative(&path)?;
        ensure!(
            ![
                "credentials",
                "password",
                "users.xml",
                "userlist",
                "secrets"
            ]
            .iter()
            .any(|s| path.to_ascii_lowercase().contains(s)),
            "secret/account data excluded; remove from package"
        );
        ensure!(folded.insert(path.to_lowercase()), "case-colliding path");
        let size = entry.metadata()?.len();
        total += size;
        ensure!(
            size <= MAX_FILE_BYTES && total <= MAX_PACKAGE_BYTES && files.len() < MAX_ENTRIES,
            "package limits exceeded"
        );
        let bytes = fs::read(entry.path())?;
        ensure!(bytes.len() as u64 == size, "source changed during import");
        if path.to_lowercase().ends_with(".xml") {
            xml::parse(std::str::from_utf8(&bytes)?)?;
        }
        files.insert(path.clone(), objects.put(&bytes, &role(&path))?);
    }
    ensure!(
        files.contains_key("Resources/settings.xml"),
        "full package requires Resources/settings.xml"
    );
    ensure!(
        files.values().any(|f| f.role == "transcript"),
        "no transcript documents"
    );
    let mut config = Config::default();
    if let Some(f) = files.get("Workbench/definitions.json") {
        config = serde_json::from_slice(&objects.read(f)?)?;
    }
    // Preserve supplied definitions/receipts verbatim. Our effective configuration
    // lives in an additional, collision-free export namespace. Only a receipt
    // describing every file outside its own namespace can supply that overlay.
    let mut overlays = Vec::new();
    let mut managed_receipts = 0;
    let namespaces: BTreeSet<String> = files
        .keys()
        .filter_map(|path| {
            let rest = path.strip_prefix("Workbench/exports/")?;
            let id = rest.split('/').next()?;
            uuid::Uuid::parse_str(id).ok()?;
            Some(format!("Workbench/exports/{id}/"))
        })
        .collect();
    for prefix in &namespaces {
        ensure!(
            files.contains_key(&format!("{prefix}export-receipt.json"))
                && files.contains_key(&format!("{prefix}definitions.json")),
            "incomplete managed export namespace"
        );
    }
    for (path, artifact) in &files {
        if !path.starts_with("Workbench/exports/") || !path.ends_with("/export-receipt.json") {
            continue;
        }
        let value: serde_json::Value = serde_json::from_slice(&objects.read(artifact)?)?;
        validate_history_rows(&value)?;
        managed_receipts += 1;
        let exported: Snapshot = serde_json::from_value(value["snapshot"].clone())
            .context("malformed managed export snapshot")?;
        ensure!(
            value["revision"]["snapshot_hash"].as_str()
                == Some(hash(&serde_json::to_vec(&exported)?).as_str()),
            "export receipt snapshot hash mismatch"
        );
        let prefix = path.strip_suffix("export-receipt.json").unwrap();
        let history_prefix = format!("{prefix}history-objects/");
        for (history_path, object) in files.iter().filter(|(p, _)| p.starts_with(&history_prefix)) {
            let name = history_path.strip_prefix(&history_prefix).unwrap();
            ensure!(
                name == object.sha256,
                "export history object filename/checksum mismatch"
            );
        }
        for revision in value["history"]
            .as_array()
            .context("managed export history missing")?
        {
            let hash = revision["snapshot_hash"]
                .as_str()
                .context("history snapshot hash")?;
            let artifact = files
                .get(&format!("{history_prefix}{hash}"))
                .context("declared historical snapshot object missing")?;
            let historical: Snapshot = serde_json::from_slice(&objects.read(artifact)?)?;
            for source in historical.files.values() {
                let object = files
                    .get(&format!("{history_prefix}{}", source.sha256))
                    .context("declared historical artifact missing")?;
                ensure!(
                    object.sha256 == source.sha256 && object.bytes == source.bytes,
                    "historical artifact mismatch"
                );
            }
        }
        let included: Files = files
            // Every declared revision and artifact must exist, not merely each
            // history object that happened to be supplied.
            .iter()
            .filter(|(p, _)| !p.starts_with(prefix))
            .map(|(p, a)| (p.clone(), a.clone()))
            .collect();
        let generations = match value.get("derived_generations") {
            Some(value) => value
                .as_array()
                .context("malformed managed generation manifest")?
                .as_slice(),
            None => &[], // Earlier version-1 exports predate compiler generations.
        };
        for generation in generations {
            for field in ["receipt_hash", "graph_hash"] {
                let hash = generation[field]
                    .as_str()
                    .context("generation object hash")?;
                ensure!(
                    files.contains_key(&format!("{history_prefix}{hash}")),
                    "declared derived generation object missing"
                );
            }
            let hash = generation["receipt_hash"].as_str().unwrap();
            let artifact = &files[&format!("{history_prefix}{hash}")];
            let completion: crate::handoff::Completion =
                serde_json::from_slice(&objects.read(artifact)?)?;
            ensure!(
                files.contains_key(&format!(
                    "{history_prefix}{}",
                    completion.binding.contract_hash
                )),
                "declared compiler contract missing"
            );
        }
        if included == exported.files && exported.schema == SCHEMA {
            let definitions = files
                .get(&format!("{prefix}definitions.json"))
                .context("export definitions missing")?;
            let effective: Config = serde_json::from_slice(&objects.read(definitions)?)?;
            ensure!(
                effective == exported.config,
                "export definitions/receipt mismatch"
            );
            overlays.push(exported.config);
        }
    }
    ensure!(
        overlays.len() <= 1,
        "ambiguous authoring export configuration"
    );
    ensure!(managed_receipts == 0 || overlays.len() == 1, "export manifest mismatch; external changes need explicit lineage reconciliation before reimport");
    if let Some(overlay) = overlays.pop() {
        config = overlay;
    }
    let snapshot = Snapshot {
        schema: SCHEMA,
        project: project.into(),
        files,
        config,
        index_status: "preserved-unverified; no index queries enabled".into(),
    };
    validate(objects, &snapshot)?;
    Ok(snapshot)
}
pub fn documents(objects: &Objects, snapshot: &Snapshot) -> Result<Vec<Document>> {
    let mut docs = Vec::new();
    for (path, f) in &snapshot.files {
        if f.role != "transcript" {
            continue;
        }
        let mut doc = xml::project_document(
            &snapshot.project,
            path,
            &objects.text(snapshot, path)?,
            &snapshot.config,
        )?;
        let basename = Path::new(path)
            .file_name()
            .context("document basename")?
            .to_str()
            .context("basename")?;
        for (sidecar, file) in &snapshot.files {
            if !sidecar.starts_with("Annotations/")
                || sidecar.ends_with("_def.xml")
                || !sidecar.ends_with(&format!("_{basename}"))
            {
                continue;
            }
            let text = String::from_utf8(objects.read(file)?)?;
            let tree = xml::parse(&text)?;
            let mut seen = BTreeSet::new();
            for span in tree.descendants().filter(|n| n.has_tag_name("span")) {
                let id = span.attribute("id").context("span without id")?;
                ensure!(seen.insert(id), "duplicate sidecar ID");
                let tokens: Vec<String> = span
                    .attribute("corresp")
                    .unwrap_or("")
                    .split_whitespace()
                    .map(|v| v.trim_start_matches('#').into())
                    .collect();
                if tokens.is_empty() {
                    doc.opaque_elements
                        .push(format!("unprojected-annotation:{sidecar}:{id}"));
                    continue;
                }
                for id in &tokens {
                    ensure!(
                        doc.tokens.iter().any(|t| &t.id == id),
                        "dangling sidecar target {id}"
                    );
                }
                doc.spans.push(Span {
                    id: id.into(),
                    token_ids: tokens,
                    fields: span
                        .attributes()
                        .map(|a| (a.name().into(), a.value().into()))
                        .collect(),
                    sidecar: sidecar.into(),
                });
            }
        }
        docs.push(doc);
    }
    Ok(docs)
}
pub fn resolve_media(snapshot: &Snapshot, reference: &str) -> Option<String> {
    [
        reference.to_string(),
        format!("Audio/{reference}"),
        format!("Video/{reference}"),
    ]
    .into_iter()
    .find(|p| snapshot.files.contains_key(p))
}
pub fn validate(objects: &Objects, snapshot: &Snapshot) -> Result<Vec<Issue>> {
    ensure!(snapshot.schema == SCHEMA, "unsupported snapshot schema");
    xml::validate_layers(&snapshot.config)?;
    for (path, artifact) in &snapshot.files {
        safe_relative(path)?;
        let bytes = objects.read(artifact)?;
        if path.to_lowercase().ends_with(".xml") {
            xml::parse(std::str::from_utf8(&bytes)?)?;
        }
    }
    let mut issues = Vec::new();
    let projected = documents(objects, snapshot)?;
    for path in snapshot.files.keys().filter(|p| {
        snapshot.files[*p].role == "annotation-sidecar-or-definition"
            && p.to_ascii_lowercase().ends_with(".xml")
    }) {
        let text = objects.text(snapshot, path)?;
        let tree = xml::parse(&text)?;
        if !tree
            .descendants()
            .any(|n| n.is_element() && n.tag_name().name() == "span")
        {
            continue;
        }
        let owners: Vec<_> = projected
            .iter()
            .filter(|d| {
                d.spans.iter().any(|s| &s.sidecar == path)
                    || d.opaque_elements
                        .iter()
                        .any(|s| s.starts_with(&format!("unprojected-annotation:{path}:")))
            })
            .collect();
        if path.to_ascii_lowercase().ends_with("_def.xml") {
            issues.push(Issue{code:"ambiguous-annotation-definition".into(),target:path.clone(),message:"Span-bearing definition filename requires an explicit transcript/definition association; bytes preserved read-only".into(),blocking:true});
        } else if owners.len() != 1 {
            issues.push(Issue{code:"ambiguous-annotation-association".into(),target:path.clone(),message:format!("Span-bearing sidecar has {} projected transcript owners; explicit association required; bytes preserved read-only",owners.len()),blocking:true});
        }
    }
    for doc in projected {
        for media in &doc.media {
            if resolve_media(snapshot, media).is_none() {
                issues.push(Issue {
                    code: "missing-media".into(),
                    target: doc.path.clone(),
                    message: format!("Missing or external media reference: {media}"),
                    blocking: true,
                });
            }
        }
        if !doc.opaque_elements.is_empty() {
            issues.push(Issue {
                code: "opaque-preserved".into(),
                target: doc.path.clone(),
                message: format!(
                    "Preserved structures with read-only editing: {}",
                    doc.opaque_elements.join(", ")
                ),
                blocking: doc
                    .opaque_elements
                    .iter()
                    .any(|s| s.starts_with("unprojected-annotation:")),
            });
        }
        for span in &doc.spans {
            let keys = [
                "wb_start",
                "wb_end",
                "wb_coordinate",
                "wb_layer",
                "wb_quote",
                "wb_status",
            ];
            if keys.iter().any(|k| span.fields.contains_key(*k)) {
                let valid = (|| -> Option<bool> {
                    let start: usize = span.fields.get("wb_start")?.parse().ok()?;
                    let end: usize = span.fields.get("wb_end")?.parse().ok()?;
                    let status = span.fields.get("wb_status")?;
                    if span.token_ids.len() != 1
                        || span.fields.get("wb_coordinate")? != "unicode-codepoint"
                        || span.fields.get("wb_layer")? != "corrected"
                        || !["resolved", "unresolved"].contains(&status.as_str())
                    {
                        return Some(false);
                    }
                    let token = doc.tokens.iter().find(|t| t.id == span.token_ids[0])?;
                    let chars: Vec<_> = token
                        .corrected
                        .as_ref()
                        .unwrap_or(&token.original)
                        .chars()
                        .collect();
                    Some(
                        start < end
                            && end <= chars.len()
                            && chars[start..end].iter().collect::<String>()
                                == *span.fields.get("wb_quote")?,
                    )
                })()
                .unwrap_or(false);
                if !valid {
                    issues.push(Issue { code: "invalid-character-anchor".into(), target: span.id.clone(), message: "Supported character anchor has incomplete coordinates or a quote/range mismatch; supplied bytes are preserved for review.".into(), blocking: true });
                }
            }
            if span
                .fields
                .get("wb_status")
                .is_some_and(|v| v == "unresolved")
            {
                issues.push(Issue { code: "unresolved-character-anchor".into(), target: span.id.clone(), message: "Correction changed the character layer. Historical quote retained; resolve judgment before approval.".into(), blocking: true });
            }
        }
        for token in &doc.tokens {
            if token
                .attrs
                .get("wb_normalized_status")
                .is_some_and(|v| v == "unresolved")
            {
                issues.push(Issue{code:"unresolved-normalized-reading".into(),target:token.id.clone(),message:"The authentic correction changed; the retained normalized reading needs confirmation or correction.".into(),blocking:true});
            }
        }
        if doc.tokens.iter().any(|t| t.start_us.is_none()) {
            issues.push(Issue { code: "missing-word-times".into(), target: doc.path.clone(), message: "Word alignment is absent. Playback uses the containing utterance; no word timing has been inferred.".into(), blocking: false });
        }
    }
    Ok(issues)
}
pub fn replace(objects: &Objects, snapshot: &mut Snapshot, path: &str, text: &str) -> Result<()> {
    safe_relative(path)?;
    xml::parse(text)?;
    let r = role(path);
    snapshot
        .files
        .insert(path.into(), objects.put(text.as_bytes(), &r)?);
    snapshot.index_status = "stale; byte-offset indexes cannot be queried".into();
    Ok(())
}
pub fn token_fields(
    objects: &Objects,
    snapshot: &mut Snapshot,
    document: &str,
    token: &str,
    fields: &BTreeMap<String, String>,
) -> Result<()> {
    let docs = documents(objects, snapshot)?;
    let doc = docs
        .iter()
        .find(|d| d.path == document)
        .context("document not found")?;
    let t = doc
        .tokens
        .iter()
        .find(|t| t.id == token)
        .context("token not found")?;
    ensure!(
        t.editable,
        "nested token is preserved read-only; editing gate not proven"
    );
    ensure!(!fields.is_empty(), "empty token command");
    for (key, value) in fields {
        ensure!(
            [
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
                "relation_type"
            ]
            .contains(&key.as_str()),
            "immutable/unsupported token field"
        );
        if key == "variety" && !value.is_empty() {
            ensure!(
                snapshot.config.language_values.contains_key(value)
                    || t.attrs.get(key) == Some(value),
                "define custom language value first"
            );
        }
        if key == "relation_target" && !value.is_empty() {
            ensure!(
                doc.tokens
                    .iter()
                    .any(|t| t.id == value.trim_start_matches('#')),
                "dangling relation"
            );
        }
    }
    let old = objects.text(snapshot, document)?;
    let mut effective_fields = fields.clone();
    if fields.contains_key("wb_normalized") {
        effective_fields.insert("wb_normalized_status".into(), "resolved".into());
    } else if fields
        .get("nform")
        .is_some_and(|v| Some(v) != t.corrected.as_ref())
        && t.normalized.is_some()
    {
        effective_fields.insert("wb_normalized_status".into(), "unresolved".into());
    }
    let patched = xml::patch_attrs(&old, "tok", token, &effective_fields)?;
    replace(objects, snapshot, document, &patched)?;
    if fields
        .get("nform")
        .is_some_and(|v| Some(v) != t.corrected.as_ref())
    {
        for span in &doc.spans {
            if span.token_ids.iter().any(|id| id == token) && span.fields.contains_key("wb_start") {
                ensure!(docs.iter().filter(|d| d.spans.iter().any(|s| s.sidecar == span.sidecar)).count() == 1,
                    "sidecar matches multiple transcripts; explicit association required before editing");
                let old = objects.text(snapshot, &span.sidecar)?;
                let new = xml::patch_attrs(
                    &old,
                    "span",
                    &span.id,
                    &BTreeMap::from([("wb_status".into(), "unresolved".into())]),
                )?;
                replace(objects, snapshot, &span.sidecar, &new)?;
            }
        }
    }
    Ok(())
}
pub fn add_span(
    objects: &Objects,
    snapshot: &mut Snapshot,
    document: &str,
    id: &str,
    token_ids: &[String],
    fields: &BTreeMap<String, String>,
    character: &Option<CharacterAnchor>,
) -> Result<()> {
    ensure!(
        xml::valid_name(id) && !token_ids.is_empty() && token_ids.len() <= 10000,
        "invalid span selection/id"
    );
    let docs = documents(objects, snapshot)?;
    let doc = docs
        .iter()
        .find(|d| d.path == document)
        .context("document not found")?;
    ensure!(!doc.spans.iter().any(|s| s.id == id), "span id exists");
    let mut seen = BTreeSet::new();
    for id in token_ids {
        ensure!(
            seen.insert(id) && doc.tokens.iter().any(|t| &t.id == id),
            "duplicate/missing span endpoint"
        );
    }
    let mut values = fields.clone();
    for key in values.keys() {
        ensure!(
            ["label", "variety", "note"].contains(&key.as_str()),
            "unsupported span field"
        );
    }
    if let Some(value) = values.get("variety").filter(|s| !s.is_empty()) {
        ensure!(
            snapshot.config.language_values.contains_key(value),
            "define span language first"
        );
    }
    if let Some(a) = character {
        ensure!(
            a.coordinate == "unicode-codepoint"
                && a.layer == "corrected"
                && token_ids.len() == 1
                && token_ids[0] == a.token,
            "unsupported character anchor coordinates"
        );
        let token = doc
            .tokens
            .iter()
            .find(|t| t.id == a.token)
            .context("anchor token")?;
        let text = token.corrected.as_ref().unwrap_or(&token.original);
        let chars: Vec<_> = text.chars().collect();
        ensure!(
            a.start < a.end
                && a.end <= chars.len()
                && chars[a.start..a.end].iter().collect::<String>() == a.quote,
            "character quote/range mismatch"
        );
        values.extend(BTreeMap::from([
            ("wb_start".into(), a.start.to_string()),
            ("wb_end".into(), a.end.to_string()),
            ("wb_coordinate".into(), a.coordinate.clone()),
            ("wb_layer".into(), a.layer.clone()),
            ("wb_quote".into(), a.quote.clone()),
            ("wb_status".into(), "resolved".into()),
        ]));
    }
    values.insert("id".into(), id.into());
    values.insert(
        "corresp".into(),
        token_ids
            .iter()
            .map(|s| format!("#{s}"))
            .collect::<Vec<_>>()
            .join(" "),
    );
    let attributes = values
        .iter()
        .map(|(k, v)| Ok(format!(" {k}=\"{}\"", xml::escape(v)?)))
        .collect::<Result<Vec<_>>>()?
        .join("");
    let words = token_ids
        .iter()
        .map(|id| doc.tokens.iter().find(|t| &t.id == id).unwrap())
        .map(|t| t.corrected.as_ref().unwrap_or(&t.original).clone())
        .collect::<Vec<_>>()
        .join(" ");
    let basename = Path::new(document)
        .file_name()
        .context("basename")?
        .to_str()
        .context("basename")?;
    let path = format!("Annotations/review_{basename}");
    ensure!(!path.to_ascii_lowercase().ends_with("_def.xml"),"reserved annotation definition filename; explicit association required before creating a span");
    ensure!(docs.iter().filter(|d| Path::new(&d.path).file_name().and_then(|n| n.to_str()) == Some(basename)).count() == 1,
        "sidecar matches multiple transcripts; explicit association required before creating a span");
    let old = if snapshot.files.contains_key(&path) {
        objects.text(snapshot, &path)?
    } else {
        "<spanGrp></spanGrp>".into()
    };
    let tree = xml::parse(&old)?;
    ensure!(
        tree.root_element().has_tag_name("spanGrp"),
        "unsupported sidecar dialect read-only"
    );
    let new = xml::append_element(
        &old,
        &format!("<span{attributes}>{}</span>", xml::escape(&words)?),
    )?;
    replace(objects, snapshot, &path, &new)?;
    if !snapshot.files.contains_key("Annotations/review_def.xml") {
        replace(objects, snapshot, "Annotations/review_def.xml", "<annotation name=\"Research annotations\"><interp key=\"label\" display=\"Label\" type=\"long\"/><interp key=\"variety\" display=\"Language / variety\" type=\"long\"/><interp key=\"note\" display=\"Note\" type=\"long\"/></annotation>")?;
    }
    Ok(())
}
const CHARACTER_FIELDS: [&str; 6] = [
    "wb_start",
    "wb_end",
    "wb_coordinate",
    "wb_layer",
    "wb_quote",
    "wb_status",
];

pub fn set_span(
    objects: &Objects,
    snapshot: &mut Snapshot,
    document: &str,
    sidecar: &str,
    id: &str,
    fields: &BTreeMap<String, String>,
    anchor: &Option<SpanAnchorUpdate>,
) -> Result<()> {
    safe_relative(sidecar)?;
    let docs = documents(objects, snapshot)?;
    ensure!(
        docs.iter()
            .filter(|d| d.spans.iter().any(|s| s.sidecar == sidecar))
            .count()
            == 1,
        "sidecar matches multiple transcripts; explicit association required before editing"
    );
    let doc = docs
        .iter()
        .find(|d| d.path == document)
        .context("document not found")?;
    let span = doc
        .spans
        .iter()
        .find(|s| s.id == id && s.sidecar == sidecar)
        .context("span not in document/sidecar scope")?;
    let old = objects.text(snapshot, sidecar)?;
    let tree = xml::parse(&old)?;
    let root = tree.root_element();
    ensure!(
        root.has_tag_name("spanGrp") && root.tag_name().namespace().is_none(),
        "unsupported sidecar dialect read-only"
    );
    let nodes: Vec<_> = tree
        .descendants()
        .filter(|n| n.has_tag_name("span") && n.attribute("id") == Some(id))
        .collect();
    ensure!(
        nodes.len() == 1
            && nodes[0].parent() == Some(root)
            && nodes[0].tag_name().namespace().is_none(),
        "unsupported or ambiguous span structure read-only"
    );
    for attr in nodes[0].attributes() {
        ensure!(
            attr.namespace().is_none()
                || !["id", "corresp", "label", "variety", "note"].contains(&attr.name())
                    && !CHARACTER_FIELDS.contains(&attr.name()),
            "ambiguous namespaced span field read-only"
        );
    }
    let mut values = fields.clone();
    for key in values.keys() {
        ensure!(
            ["label", "variety", "note"].contains(&key.as_str()),
            "immutable/unsupported span field"
        );
    }
    if let Some(variety) = values.get("variety").filter(|v| !v.is_empty()) {
        ensure!(
            snapshot.config.language_values.contains_key(variety),
            "define span language first"
        );
    }
    let mut remove_character = false;
    if let Some(update) = anchor {
        let token_ids = match update {
            SpanAnchorUpdate::Tokens { token_ids } => {
                remove_character = true;
                token_ids.clone()
            }
            SpanAnchorUpdate::Character { anchor: a } => {
                ensure!(
                    a.coordinate == "unicode-codepoint" && a.layer == "corrected",
                    "unsupported character anchor coordinates"
                );
                let token = doc
                    .tokens
                    .iter()
                    .find(|t| t.id == a.token)
                    .context("anchor token")?;
                let chars: Vec<_> = token
                    .corrected
                    .as_ref()
                    .unwrap_or(&token.original)
                    .chars()
                    .collect();
                ensure!(
                    a.start < a.end
                        && a.end <= chars.len()
                        && chars[a.start..a.end].iter().collect::<String>() == a.quote,
                    "character quote/range mismatch"
                );
                values.extend(BTreeMap::from([
                    ("wb_start".into(), a.start.to_string()),
                    ("wb_end".into(), a.end.to_string()),
                    ("wb_coordinate".into(), a.coordinate.clone()),
                    ("wb_layer".into(), a.layer.clone()),
                    ("wb_quote".into(), a.quote.clone()),
                    ("wb_status".into(), "resolved".into()),
                ]));
                vec![a.token.clone()]
            }
        };
        let mut seen = BTreeSet::new();
        ensure!(
            !token_ids.is_empty() && token_ids.len() <= 10000,
            "invalid span selection"
        );
        for token in &token_ids {
            ensure!(
                seen.insert(token) && doc.tokens.iter().any(|t| &t.id == token),
                "duplicate/missing span endpoint"
            );
        }
        // Semantically unchanged references retain original whitespace/entities.
        if token_ids != span.token_ids {
            values.insert(
                "corresp".into(),
                token_ids
                    .iter()
                    .map(|id| format!("#{id}"))
                    .collect::<Vec<_>>()
                    .join(" "),
            );
        }
    }
    values.retain(|key, value| span.fields.get(key) != Some(value));
    let mut new = old.clone();
    if remove_character {
        new = xml::remove_attrs(&new, "span", id, &CHARACTER_FIELDS)?;
    }
    if !values.is_empty() {
        new = xml::patch_attrs(&new, "span", id, &values)?;
    }
    ensure!(new != old, "span edit has no changes");
    // Span body may be an authored label rather than a generated excerpt.
    // Reanchoring never guesses its meaning or rewrites that mixed content.
    replace(objects, snapshot, sidecar, &new)
}

pub fn relation_source(
    objects: &Objects,
    snapshot: &Snapshot,
    document: &str,
    from: &str,
) -> Result<Token> {
    let docs = documents(objects, snapshot)?;
    let token = docs
        .iter()
        .find(|d| d.path == document)
        .and_then(|d| d.tokens.iter().find(|t| t.id == from))
        .context("relation source not found")?;
    ensure!(
        token.editable,
        "nested token is preserved read-only; editing gate not proven"
    );
    ensure!(
        token
            .attrs
            .get("relation_target")
            .is_some_and(|v| !v.is_empty()),
        "relation does not exist"
    );
    let text = objects.text(snapshot, document)?;
    let tree = xml::parse(&text)?;
    let nodes: Vec<_> = tree
        .descendants()
        .filter(|n| {
            n.has_tag_name("tok")
                && n.attribute("id")
                    .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
                    == Some(from)
        })
        .collect();
    ensure!(
        nodes.len() == 1 && nodes[0].tag_name().namespace().is_none(),
        "ambiguous/unsupported relation source"
    );
    ensure!(
        !nodes[0].attributes().any(|a| a.namespace().is_some()
            && ["relation_target", "relation_type", "note"].contains(&a.name())),
        "ambiguous namespaced relation fields read-only"
    );
    Ok(token.clone())
}

// Mapping v1 uses document + bare span ID. Keep ambiguous packages lossless,
// but never silently collapse their source evidence into a current graph.
pub fn compiler_scope(documents: &[Document]) -> Result<()> {
    compiler_scope_for_mapping(documents, "corpus-evidence/1")
}
pub fn compiler_scope_for_mapping(documents: &[Document], mapping: &str) -> Result<()> {
    ensure!(
        ["corpus-evidence/1", "corpus-evidence/2"].contains(&mapping),
        "unsupported compiler mapping"
    );
    let mut owners = BTreeMap::new();
    for doc in documents {
        let mut ids = BTreeSet::new();
        for span in &doc.spans {
            ensure!(
                mapping == "corpus-evidence/2" || ids.insert(&span.id),
                "ambiguous span IDs across sidecars; qualified compiler mapping required"
            );
            if let Some(owner) = owners.insert(&span.sidecar, &doc.path) {
                ensure!(
                    owner == &doc.path,
                    "sidecar matches multiple transcripts; explicit compiler association required"
                );
            }
        }
    }
    Ok(())
}

pub fn clear_relation(
    objects: &Objects,
    snapshot: &mut Snapshot,
    document: &str,
    from: &str,
) -> Result<()> {
    relation_source(objects, snapshot, document, from)?;
    let old = objects.text(snapshot, document)?;
    let new = xml::remove_attrs(&old, "tok", from, &["relation_target", "relation_type"])?;
    ensure!(new != old, "relation edit has no changes");
    // Token notes may have other research meanings: clearing a link keeps them.
    replace(objects, snapshot, document, &new)
}

pub fn export_directory(
    objects: &Objects,
    snapshot: &Snapshot,
    destination: &Path,
    receipt: &serde_json::Value,
) -> Result<()> {
    export_directory_with_history(objects, snapshot, destination, receipt, &BTreeMap::new())
}
pub fn export_directory_with_history(
    objects: &Objects,
    snapshot: &Snapshot,
    destination: &Path,
    receipt: &serde_json::Value,
    history: &BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    ensure!(
        !destination.exists(),
        "export destination exists; use a new path"
    );
    let issues = validate(objects, snapshot)?;
    ensure!(
        !(snapshot.index_status.starts_with("stale")
            && snapshot.files.values().any(|f| f.role == "derived-index")),
        "stale CWB indexes require an adapter rebuild before compatibility export"
    );
    ensure!(
        !issues.iter().any(|i| i.code == "missing-media"),
        "incomplete package: missing media"
    );
    let parent = destination.parent().context("export parent")?;
    fs::create_dir_all(parent)?;
    let staged = parent.join(format!("export-stage-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staged)?;
    let result = (|| -> Result<()> {
        for (path, artifact) in &snapshot.files {
            // Old derived indexes remain preserved as artifacts, with explicit
            // stale status. They must not be used as current query indexes.
            let target = staged.join(path);
            fs::create_dir_all(target.parent().unwrap())?;
            let bytes = objects.read(artifact)?;
            let mut file = File::create(&target)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            ensure!(
                hash(&fs::read(&target)?) == artifact.sha256,
                "export checksum mismatch"
            );
        }
        let namespace = format!("Workbench/exports/{}/", uuid::Uuid::new_v4());
        ensure!(
            !snapshot.files.keys().any(|p| p.starts_with(&namespace)),
            "export namespace collision"
        );
        let metadata = staged.join(&namespace);
        fs::create_dir_all(metadata.join("history-objects"))?;
        let mut additions = BTreeMap::from([
            (
                metadata.join("definitions.json"),
                serde_json::to_vec_pretty(&snapshot.config)?,
            ),
            (
                metadata.join("export-receipt.json"),
                serde_json::to_vec_pretty(receipt)?,
            ),
        ]);
        for (name, bytes) in history {
            ensure!(name == &hash(bytes), "invalid history object hash");
            additions.insert(metadata.join("history-objects").join(name), bytes.clone());
        }
        for (path, bytes) in additions {
            let mut file = File::create(path)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }
        fs::rename(&staged, destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staged);
    }
    result
}
pub fn zip_directory(dir: &Path, destination: &Path) -> Result<()> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o600);
    for entry in WalkDir::new(dir).follow_links(false) {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry
            .path()
            .strip_prefix(dir)?
            .to_str()
            .context("export filename")?
            .replace('\\', "/");
        safe_relative(&name)?;
        zip.start_file(name, options)?;
        let mut f = File::open(entry.path())?;
        let mut buffer = vec![0; 65536];
        loop {
            let n = f.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            zip.write_all(&buffer[..n])?;
        }
    }
    zip.finish()?.sync_all()?;
    Ok(())
}
