use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SCHEMA: u32 = 1;
pub type Files = BTreeMap<String, Artifact>;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Artifact {
    pub sha256: String,
    pub bytes: u64,
    pub role: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Layer {
    pub id: String,
    pub parent: Option<String>,
    pub alignment: String,
    pub overlap: bool,
    pub containment: bool,
    pub coverage: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Config {
    pub version: u32,
    pub language_values: BTreeMap<String, String>,
    pub language_default: Option<String>,
    pub layers: Vec<Layer>,
    pub rights: String,
    pub machine_draft_provenance: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            language_values: BTreeMap::new(),
            language_default: None,
            layers: vec![
                Layer {
                    id: "utterance".into(),
                    parent: None,
                    alignment: "interval".into(),
                    overlap: true,
                    containment: false,
                    coverage: false,
                },
                Layer {
                    id: "token".into(),
                    parent: Some("utterance".into()),
                    alignment: "optional_interval".into(),
                    overlap: true,
                    containment: true,
                    coverage: false,
                },
                Layer {
                    id: "language".into(),
                    parent: Some("token".into()),
                    alignment: "unaligned".into(),
                    overlap: true,
                    containment: false,
                    coverage: false,
                },
            ],
            rights: "restricted-local-research; redistribution and training not granted".into(),
            machine_draft_provenance:
                "preserved supplied raw artifacts; missing run metadata remains unknown".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub schema: u32,
    pub project: String,
    pub files: Files,
    pub config: Config,
    pub index_status: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Token {
    pub id: String,
    pub internal_id: String,
    pub original: String,
    pub corrected: Option<String>,
    pub normalized: Option<String>,
    pub attrs: BTreeMap<String, String>,
    pub utterance: Option<String>,
    pub start_us: Option<i64>,
    pub end_us: Option<i64>,
    pub language_effective: Option<String>,
    pub language_source: String,
    pub editable: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Segment {
    pub id: String,
    pub start_us: Option<i64>,
    pub end_us: Option<i64>,
    pub attrs: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Span {
    pub id: String,
    pub token_ids: Vec<String>,
    pub fields: BTreeMap<String, String>,
    pub sidecar: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    pub path: String,
    pub title: String,
    pub tokens: Vec<Token>,
    pub segments: Vec<Segment>,
    pub spans: Vec<Span>,
    pub media: Vec<String>,
    pub metadata: BTreeMap<String, String>,
    pub opaque_elements: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Issue {
    pub code: String,
    pub target: String,
    pub message: String,
    pub blocking: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CharacterAnchor {
    pub token: String,
    pub start: usize,
    pub end: usize,
    pub quote: String,
    pub coordinate: String,
    pub layer: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SpanAnchorUpdate {
    Tokens { token_ids: Vec<String> },
    Character { anchor: CharacterAnchor },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    Retokenize {
        request: crate::retokenize::RetokenizeRequest,
        preview_hash: String,
    },
    SetToken {
        document: String,
        token: String,
        fields: BTreeMap<String, String>,
    },
    DefineLanguage {
        value: String,
        description: String,
    },
    SetLanguageDefault {
        value: Option<String>,
    },
    AddSpan {
        document: String,
        id: String,
        token_ids: Vec<String>,
        fields: BTreeMap<String, String>,
        character: Option<CharacterAnchor>,
    },
    AddRelation {
        document: String,
        from: String,
        to: String,
        relation_type: String,
        note: String,
    },
    SetSpan {
        document: String,
        sidecar: String,
        id: String,
        fields: BTreeMap<String, String>,
        anchor: Option<SpanAnchorUpdate>,
    },
    SetRelation {
        document: String,
        from: String,
        to: String,
        relation_type: String,
        note: Option<String>,
    },
    ClearRelation {
        document: String,
        from: String,
    },
    Restore {
        revision: i64,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub schema: u32,
    pub project: String,
    pub command_id: String,
    pub base_revision: i64,
    pub preimage_hash: String,
    pub config_version: u32,
    pub label: String,
    pub operations: Vec<Operation>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Revision {
    pub id: i64,
    pub parent: Option<i64>,
    pub snapshot_hash: String,
    pub actor: String,
    pub label: String,
    pub created_at: String,
    pub command_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct View {
    pub api_version: u32,
    pub revision: Revision,
    pub snapshot: Snapshot,
    pub documents: Vec<Document>,
    pub issues: Vec<Issue>,
    pub approved: bool,
}
