//! Derived compiler generations share the evidence authority's transaction domain.
use crate::{
    package,
    store::{Fault, Store},
};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recipe {
    pub mapping_version: String,
    pub adapter_hash: String,
    pub compiler_commit: String,
    pub compiler_source_hash: String,
    pub compiler_version: String,
    pub runtime_hash: String,
    pub ontology_hash: String,
    pub model_hash: String,
    pub options: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub schema: u32,
    pub authority: String,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub config_hash: String,
    pub contract_hash: String,
    pub recipe: Recipe,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct Anchor {
    pub document: String,
    pub kind: String,
    pub external_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Completion {
    pub schema: u32,
    pub binding: Binding,
    pub graph_hash: String,
    pub node_count: usize,
    pub edge_count: usize,
    pub anchors: BTreeMap<String, Anchor>,
}
pub fn digest(value: &impl Serialize) -> Result<String> {
    Ok(package::hash(&serde_json::to_vec(&serde_json::to_value(
        value,
    )?)?))
}
fn hash_value(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

impl Store {
    pub fn accept_generation(
        &mut self,
        completion: &Completion,
        bytes: &[u8],
        fault: Fault,
    ) -> Result<Value> {
        let binding = &completion.binding;
        ensure!(
            completion.schema == 1
                && binding.schema == 1
                && binding.authority == "research-intelligence",
            "unsupported generation contract"
        );
        for value in [
            &binding.snapshot_hash,
            &binding.config_hash,
            &binding.contract_hash,
            &binding.recipe.adapter_hash,
            &binding.recipe.compiler_source_hash,
            &binding.recipe.runtime_hash,
            &binding.recipe.ontology_hash,
            &binding.recipe.model_hash,
            &completion.graph_hash,
        ] {
            ensure!(hash_value(value), "invalid generation hash");
        }
        ensure!(
            binding.recipe.mapping_version == "corpus-evidence/1"
                && binding.recipe.compiler_version == "semantica/0.6.8"
                && binding.recipe.compiler_commit.len() == 40
                && binding
                    .recipe
                    .compiler_commit
                    .bytes()
                    .all(|c| c.is_ascii_hexdigit())
                && binding.recipe.options.get("extraction").map(String::as_str)
                    == Some("none; authored evidence mapping")
                && binding.recipe.options.get("access").map(String::as_str) == Some("local-only"),
            "unsupported effective recipe"
        );
        let contract = self.approved_contract(&binding.project, binding.revision)?;
        ensure!(
            binding.snapshot_hash == contract["bundle_hash"]
                && binding.config_hash == contract["config_hash"]
                && binding.contract_hash == digest(&contract)?,
            "generation evidence binding mismatch"
        );
        ensure!(
            bytes.len() <= package::MAX_FILE_BYTES as usize
                && package::hash(bytes) == completion.graph_hash,
            "generation graph checksum/size mismatch"
        );
        let graph: Value = serde_json::from_slice(bytes)?;
        self.validate_generation_graph(completion, &graph)?;
        let id = digest(binding)?;
        let receipt_bytes = serde_json::to_vec(completion)?;
        let receipt_hash = package::hash(&receipt_bytes);
        self.objects.put(
            &serde_json::to_vec(&contract)?,
            "approved-compiler-contract",
        )?;
        let graph_artifact = self.objects.put(bytes, "derived-semantic-graph")?;
        self.objects.put(&receipt_bytes, "compiler-completion")?;
        if fault == Fault::AfterStage {
            crate::store::injected_failure("injected generation staging failure")?;
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let head: i64 = tx.query_row(
            "SELECT head FROM projects WHERE id=?",
            [&binding.project],
            |r| r.get(0),
        )?;
        let decision: Option<String> = tx.query_row("SELECT decision FROM reviews WHERE project=? AND revision=? AND snapshot_hash=? AND scope='full' ORDER BY id DESC LIMIT 1", params![binding.project,binding.revision,binding.snapshot_hash], |r| r.get(0)).optional()?;
        ensure!(
            head == binding.revision && decision.as_deref() == Some("approved"),
            "stale or unapproved compiler completion"
        );
        let previous: Option<(String, String)> = tx
            .query_row(
                "SELECT receipt_hash,graph_hash FROM derived_generations WHERE id=?",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((receipt, graph)) = previous {
            ensure!(
                receipt == receipt_hash && graph == completion.graph_hash,
                "ingestion key bound to different completion"
            );
        } else {
            tx.execute("INSERT INTO derived_generations(id,project,revision,snapshot_hash,recipe_hash,receipt_hash,graph_hash) VALUES(?,?,?,?,?,?,?)", params![id,binding.project,binding.revision,binding.snapshot_hash,digest(&binding.recipe)?,receipt_hash,graph_artifact.sha256])?;
        }
        if fault == Fault::BeforeCommit {
            crate::store::injected_failure("injected generation transaction failure")?;
        }
        tx.commit()?;
        if fault == Fault::AfterCommit {
            crate::store::injected_failure("injected generation response loss")?;
        }
        Ok(
            json!({"generation_id":id,"project":binding.project,"revision":binding.revision,"graph_hash":completion.graph_hash,"current":true,"node_count":completion.node_count,"edge_count":completion.edge_count}),
        )
    }
    fn validate_generation_graph(&self, completion: &Completion, graph: &Value) -> Result<()> {
        let binding = &completion.binding;
        let view = self.view(&binding.project, Some(binding.revision))?;
        let nodes = graph["nodes"].as_array().context("native graph nodes")?;
        let edges = graph["edges"].as_array().context("native graph edges")?;
        ensure!(
            nodes.len() == completion.node_count
                && edges.len() == completion.edge_count
                && completion.anchors.len() == nodes.len(),
            "generation counts mismatch"
        );
        let mut expected = BTreeMap::new();
        for doc in &view.documents {
            let document = &doc.path;
            expected.insert(Anchor{document:document.clone(),kind:"document".into(),external_id:document.clone()}, json!({"path":doc.path,"title":doc.title,"media":doc.media,"metadata":doc.metadata,"opaque_elements":doc.opaque_elements}));
            for token in &doc.tokens {
                expected.insert(
                    Anchor {
                        document: document.clone(),
                        kind: "token".into(),
                        external_id: token.id.clone(),
                    },
                    serde_json::to_value(token)?,
                );
            }
            for segment in &doc.segments {
                expected.insert(
                    Anchor {
                        document: document.clone(),
                        kind: "utterance".into(),
                        external_id: segment.id.clone(),
                    },
                    serde_json::to_value(segment)?,
                );
            }
            for span in &doc.spans {
                expected.insert(
                    Anchor {
                        document: document.clone(),
                        kind: "span".into(),
                        external_id: span.id.clone(),
                    },
                    serde_json::to_value(span)?,
                );
            }
        }
        let mut seen = BTreeSet::new();
        let mut ids = BTreeSet::new();
        for node in nodes {
            let id = node["id"].as_str().context("native node id")?;
            ensure!(ids.insert(id), "duplicate graph node id");
            let anchor = completion
                .anchors
                .get(id)
                .context("missing node evidence anchor")?;
            ensure!(seen.insert(anchor.clone()), "duplicate evidence anchor");
            let source = expected.get(anchor).context("unknown evidence anchor")?;
            let properties = &node["properties"];
            let expected_type = match anchor.kind.as_str() {
                "document" => "CorpusDocument",
                "token" => "CorpusToken",
                "utterance" => "CorpusUtterance",
                "span" => "CorpusSpan",
                _ => unreachable!(),
            };
            ensure!(
                node["type"] == expected_type
                    && properties["artifact_hash"] == view.snapshot.files[&anchor.document].sha256
                    && properties["rights"] == view.snapshot.config.rights
                    && properties["definition_version"] == view.snapshot.config.version,
                "graph evidence type/artifact/rights mismatch"
            );
            ensure!(
                &properties["source"] == source
                    && properties["anchor"] == serde_json::to_value(anchor)?,
                "graph source projection mismatch"
            );
            self.validate_lineage(properties, binding)?;
            if anchor.kind == "token" {
                let text = source["corrected"]
                    .as_str()
                    .or(source["original"].as_str())
                    .context("token text")?;
                ensure!(
                    properties["content"].as_str() == Some(text),
                    "graph corrected token content mismatch"
                );
            }
        }
        ensure!(
            seen.len() == expected.len(),
            "incomplete source evidence generation"
        );
        let by_anchor: BTreeMap<_, _> = completion
            .anchors
            .iter()
            .map(|(id, anchor)| (anchor.clone(), id.clone()))
            .collect();
        let mut expected_edges = BTreeSet::new();
        for doc in &view.documents {
            let identity = |kind: &str, external_id: &str| {
                by_anchor[&Anchor {
                    document: doc.path.clone(),
                    kind: kind.into(),
                    external_id: external_id.into(),
                }]
                    .clone()
            };
            let document = identity("document", &doc.path);
            for segment in &doc.segments {
                expected_edges.insert((
                    identity("utterance", &segment.id),
                    document.clone(),
                    "partOfDocument".into(),
                ));
            }
            for token in &doc.tokens {
                let id = identity("token", &token.id);
                expected_edges.insert((id.clone(), document.clone(), "partOfDocument".into()));
                if let Some(utterance) = &token.utterance {
                    expected_edges.insert((
                        id.clone(),
                        identity("utterance", utterance),
                        "partOfUtterance".into(),
                    ));
                }
                if let Some(target) = token.attrs.get("relation_target").filter(|v| !v.is_empty()) {
                    expected_edges.insert((
                        id,
                        identity("token", target.trim_start_matches('#')),
                        format!(
                            "authored:{}",
                            token
                                .attrs
                                .get("relation_type")
                                .filter(|v| !v.is_empty())
                                .context("authored relation type missing")?
                        ),
                    ));
                }
            }
            for span in &doc.spans {
                let id = identity("span", &span.id);
                expected_edges.insert((id.clone(), document.clone(), "partOfDocument".into()));
                for token in &span.token_ids {
                    expected_edges.insert((
                        id.clone(),
                        identity("token", token),
                        "anchorsToken".into(),
                    ));
                }
            }
        }
        let mut edge_keys = BTreeSet::new();
        for edge in edges {
            let source = edge["source_id"].as_str().context("edge source")?;
            let target = edge["target_id"].as_str().context("edge target")?;
            let kind = edge["type"].as_str().context("edge type")?;
            ensure!(
                ids.contains(source)
                    && ids.contains(target)
                    && edge_keys.insert((source.to_string(), target.to_string(), kind.to_string())),
                "dangling or duplicate graph edge"
            );
            self.validate_lineage(&edge["properties"], binding)?;
        }
        ensure!(
            edge_keys == expected_edges,
            "graph authored relationships incomplete or fabricated"
        );
        Ok(())
    }
    fn validate_lineage(&self, properties: &Value, binding: &Binding) -> Result<()> {
        ensure!(
            properties["project_id"] == binding.project
                && properties["revision"] == binding.revision
                && properties["bundle_hash"] == binding.snapshot_hash
                && properties["config_hash"] == binding.config_hash
                && properties["contract_hash"] == binding.contract_hash
                && properties["recipe_hash"] == digest(&binding.recipe)?
                && properties["access_policy"] == "local-only",
            "graph lineage mismatch"
        );
        Ok(())
    }
    pub fn generations(&self, project: &str, include_stale: bool) -> Result<Vec<Value>> {
        ensure!(self.project_exists(project)?, "project not found");
        // Eligibility and records are read in one SQLite statement/snapshot.
        // A concurrent head/review change cannot be mixed with older eligibility.
        type Row = (String, i64, String, String, String, String, bool);
        let entries: Vec<Row> = self.conn.prepare("SELECT g.id,g.revision,g.snapshot_hash,g.recipe_hash,g.receipt_hash,g.graph_hash, CASE WHEN g.revision=p.head AND g.snapshot_hash=r.snapshot_hash AND (SELECT decision FROM reviews WHERE project=p.id AND revision=p.head AND snapshot_hash=r.snapshot_hash AND scope='full' ORDER BY id DESC LIMIT 1)='approved' THEN 1 ELSE 0 END FROM derived_generations g JOIN projects p ON p.id=g.project JOIN revisions r ON r.id=p.head WHERE g.project=? ORDER BY g.rowid DESC")?.query_map([project], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)))?.collect::<rusqlite::Result<_>>()?;
        let mut eligibility = BTreeMap::new();
        for entry in &entries {
            if entry.6 && !eligibility.contains_key(&entry.1) {
                let view = self.view(project, Some(entry.1))?;
                eligibility.insert(entry.1, package::compiler_scope(&view.documents).is_ok());
            }
        }
        Ok(entries.into_iter().filter_map(|(id,revision,snapshot,recipe,receipt,graph,current)| {
            let current = current && eligibility.get(&revision).copied().unwrap_or(false);
            (include_stale || current).then(|| json!({"generation_id":id,"revision":revision,"snapshot_hash":snapshot,"recipe_hash":recipe,"receipt_hash":receipt,"graph_hash":graph,"current":current}))
        }).collect())
    }
    pub fn generation(&self, project: &str, id: &str, historical: bool) -> Result<Value> {
        let entry = self
            .generations(project, historical)?
            .into_iter()
            .find(|g| g["generation_id"] == id)
            .context(
                "generation unavailable in current scope; historical access must be explicit",
            )?;
        let graph: Value = serde_json::from_slice(
            &self
                .objects
                .read_hash(entry["graph_hash"].as_str().unwrap())?,
        )?;
        let receipt: Value = serde_json::from_slice(
            &self
                .objects
                .read_hash(entry["receipt_hash"].as_str().unwrap())?,
        )?;
        let contract: Value = serde_json::from_slice(
            &self.objects.read_hash(
                receipt["binding"]["contract_hash"]
                    .as_str()
                    .context("completion contract hash")?,
            )?,
        )?;
        Ok(json!({"generation":entry,"receipt":receipt,"contract":contract,"graph":graph}))
    }
}
