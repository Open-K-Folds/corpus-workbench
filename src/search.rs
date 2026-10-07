//! Literal-token concordances over one immutable revision. Imported CWB indexes
//! are never read or marked rebuilt by this disposable derived projection.
use crate::{handoff::digest, model::*, store::Store};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub const ENGINE: &str = "literal-token-concordance/2";
pub const MAX_TOKENS: usize = 100_000;
pub const MAX_XML_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_SPAN_ANCHORS: usize = 100_000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Current,
    Historical,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reading {
    Original,
    Corrected,
    Normalized,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Term {
    pub text: String,
    pub language: Option<String>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanField {
    Label,
    Variety,
}
impl SpanField {
    fn key(self) -> &'static str {
        match self {
            Self::Label => "label",
            Self::Variety => "variety",
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpanConstraint {
    pub field: SpanField,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Query {
    pub schema: u32,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub mode: Mode,
    pub reading: Reading,
    pub terms: Vec<Term>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span: Option<SpanConstraint>,
    pub documents: Vec<String>,
    pub context: usize,
    pub offset: usize,
    pub limit: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resolve {
    pub query: Query,
    pub result_hash: String,
    pub hit_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Binding {
    pub engine: String,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub projection_hash: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Word {
    pub id: String,
    pub internal_id: String,
    pub original: String,
    pub corrected: Option<String>,
    pub normalized: Option<String>,
    pub normalized_status: Option<String>,
    pub language: Option<String>,
    pub language_source: String,
}
impl From<&Token> for Word {
    fn from(t: &Token) -> Self {
        Self {
            id: t.id.clone(),
            internal_id: t.internal_id.clone(),
            original: t.original.clone(),
            corrected: t.corrected.clone(),
            normalized: t.normalized.clone(),
            normalized_status: t.attrs.get("wb_normalized_status").cloned(),
            language: t.language_effective.clone(),
            language_source: t.language_source.clone(),
        }
    }
}
pub fn text(t: &Token, reading: Reading) -> &str {
    match reading {
        Reading::Original => &t.original,
        Reading::Corrected => t.corrected.as_deref().unwrap_or(&t.original),
        Reading::Normalized => {
            if t.attrs
                .get("wb_normalized_status")
                .is_some_and(|s| s == "unresolved")
            {
                t.corrected.as_deref().unwrap_or(&t.original)
            } else {
                t.normalized
                    .as_deref()
                    .or(t.corrected.as_deref())
                    .unwrap_or(&t.original)
            }
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Audio {
    pub path: String,
    pub artifact_hash: String,
    pub start_us: i64,
    pub end_us: i64,
    pub basis: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hit {
    pub id: String,
    pub document: String,
    pub title: String,
    pub utterance: Option<String>,
    pub speaker: Option<String>,
    pub token_ids: Vec<String>,
    pub corpus_start: usize,
    pub corpus_end: usize,
    pub left: Vec<Word>,
    pub matched: Vec<Word>,
    pub right: Vec<Word>,
    pub readings: Vec<String>,
    pub audio: Option<Audio>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub spans: Vec<SpanEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpanEvidence {
    #[serde(flatten)]
    pub span: Span,
    pub artifact_hash: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Matches {
    pub schema: u32,
    pub binding: Binding,
    pub query: Query,
    pub total: usize,
    pub hits: Vec<Hit>,
    pub next_offset: Option<usize>,
    pub rights: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub result_hash: String,
    pub result: Matches,
}

fn validate(q: &Query) -> Result<()> {
    ensure!(
        q.schema == 1 && q.revision > 0,
        "unsupported search contract"
    );
    ensure!(
        (1..=8).contains(&q.terms.len()),
        "search requires 1 to 8 literal tokens"
    );
    for t in &q.terms {
        ensure!(
            !t.text.is_empty() && t.text.len() <= 512 && !t.text.contains('\0'),
            "literal token length limit"
        );
        ensure!(
            t.language
                .as_ref()
                .is_none_or(|s| !s.is_empty() && s.len() <= 256 && !s.contains('\0')),
            "language filter length limit"
        );
    }
    if let Some(span) = &q.span {
        ensure!(
            span.value.len() <= 512 && !span.value.contains('\0'),
            "span filter length limit"
        );
    }
    ensure!(
        q.context <= 12 && (1..=200).contains(&q.limit) && q.offset <= MAX_TOKENS,
        "search context/page limit"
    );
    ensure!(
        q.documents.len() <= 1000
            && q.documents.iter().collect::<BTreeSet<_>>().len() == q.documents.len(),
        "invalid document filter"
    );
    Ok(())
}
fn audio(view: &View, doc: &Document, tokens: &[Token]) -> Option<Audio> {
    let paths: BTreeSet<String> = doc
        .media
        .iter()
        .flat_map(|reference| {
            [
                reference.clone(),
                format!("Audio/{reference}"),
                format!("Video/{reference}"),
            ]
            .into_iter()
            .filter(|p| {
                view.snapshot
                    .files
                    .get(p)
                    .is_some_and(|a| a.role == "source-media")
            })
        })
        .collect();
    if paths.len() != 1 {
        return None;
    }
    let path = paths.into_iter().next()?;
    let observed: Option<Vec<_>> = tokens
        .iter()
        .map(|t| t.start_us.zip(t.end_us).filter(|(a, b)| *a >= 0 && a < b))
        .collect();
    let (start_us, end_us, basis) = if let Some(intervals) = observed {
        (
            intervals.iter().map(|(a, _)| *a).min()?,
            intervals.iter().map(|(_, b)| *b).max()?,
            "word_intervals",
        )
    } else {
        let segment = doc
            .segments
            .iter()
            .find(|u| Some(&u.id) == tokens[0].utterance.as_ref())?;
        let (a, b) = segment
            .start_us
            .zip(segment.end_us)
            .filter(|(a, b)| *a >= 0 && a < b)?;
        (a, b, "utterance_interval")
    };
    Some(Audio {
        artifact_hash: view.snapshot.files[&path].sha256.clone(),
        path,
        start_us,
        end_us,
        basis: basis.into(),
    })
}
impl Store {
    fn search_view(&self, q: &Query) -> Result<View> {
        validate(q)?;
        let revision = self.revision(&q.project, q.revision)?;
        ensure!(
            revision.snapshot_hash == q.snapshot_hash,
            "search snapshot mismatch"
        );
        if q.mode == Mode::Current {
            ensure!(
                self.head(&q.project)?.id == q.revision,
                "stale search revision; query the saved head again"
            );
        }
        // Inspect declared source sizes before parsing transcript/sidecar XML.
        let snapshot: Snapshot =
            serde_json::from_slice(&self.objects.read_hash(&revision.snapshot_hash)?)?;
        let bytes = snapshot
            .files
            .iter()
            .filter(|(_, a)| a.role == "transcript" || a.role == "annotation-sidecar-or-definition")
            .try_fold(0u64, |sum, (_, a)| {
                sum.checked_add(a.bytes)
                    .context("search source size overflow")
            })?;
        ensure!(
            bytes <= MAX_XML_BYTES,
            "search transcript XML size limit (16 MiB)"
        );
        let view = self.view(&q.project, Some(q.revision))?;
        ensure!(
            view.documents.len() <= 1000
                && view.documents.iter().map(|d| d.tokens.len()).sum::<usize>() <= MAX_TOKENS,
            "search corpus size limit (1000 documents, 100000 tokens)"
        );
        ensure!(
            q.documents
                .iter()
                .all(|p| view.documents.iter().any(|d| &d.path == p)),
            "document filter not in project revision"
        );
        if q.span.is_some() {
            let anchors: usize = view
                .documents
                .iter()
                .flat_map(|d| &d.spans)
                .map(|s| s.token_ids.len())
                .sum();
            ensure!(
                anchors <= MAX_SPAN_ANCHORS,
                "search span anchor limit (100000)"
            );
        }
        Ok(view)
    }
    pub fn search_projection(&self, q: &Query) -> Result<serde_json::Value> {
        let view = self.search_view(q)?;
        for doc in &view.documents {
            self.search_document(&view, doc)?;
        }
        if q.mode == Mode::Current {
            ensure!(
                self.head(&q.project)?.id == q.revision,
                "stale search projection"
            );
        }
        Ok(
            serde_json::json!({"schema":1,"binding":binding(&view)?,"documents":view.documents,"rights":view.snapshot.config.rights}),
        )
    }
    pub fn search(&self, q: &Query) -> Result<Envelope> {
        let view = self.search_view(q)?;
        let binding = binding(&view)?;
        let mut hits = Vec::new();
        let mut total = 0usize;
        let mut corpus = 0usize;
        let mut span_evidence_bytes = 0usize;
        for doc in &view.documents {
            if !q.documents.is_empty() && !q.documents.contains(&doc.path) {
                corpus += doc.tokens.len();
                continue;
            }
            let audio_allowed = self.search_document(&view, doc)?;
            let coverage = if let Some(constraint) = &q.span {
                self.search_spans(&view, doc, constraint)?
            } else {
                BTreeMap::new()
            };
            let span_sizes = if q.span.is_some() {
                doc.spans
                    .iter()
                    .map(|span| Ok(serde_json::to_vec(span)?.len() + 128))
                    .collect::<Result<Vec<_>>>()?
            } else {
                vec![]
            };
            // Contiguous runs never cross document or utterance boundaries.
            let mut start = 0;
            while start < doc.tokens.len() {
                let mut end = start + 1;
                while end < doc.tokens.len()
                    && doc.tokens[end].utterance == doc.tokens[start].utterance
                {
                    end += 1;
                }
                for position in start..end {
                    if position + q.terms.len() > end {
                        break;
                    }
                    let matched = &doc.tokens[position..position + q.terms.len()];
                    if !matched.iter().zip(&q.terms).all(|(t, term)| {
                        text(t, q.reading) == term.text
                            && term.language.as_ref().is_none_or(|language| {
                                t.language_effective.as_ref() == Some(language)
                            })
                    }) {
                        continue;
                    }
                    // One witness span must explicitly anchor every matched token.
                    // Never fill the gaps of a discontinuous span or join two spans.
                    let witnesses: Vec<_> = coverage
                        .get(matched[0].id.as_str())
                        .into_iter()
                        .flatten()
                        .copied()
                        .filter(|index| {
                            matched.iter().skip(1).all(|t| {
                                coverage
                                    .get(t.id.as_str())
                                    .is_some_and(|spans| spans.contains(index))
                            })
                        })
                        .collect();
                    if q.span.is_some() && witnesses.is_empty() {
                        continue;
                    }
                    if total >= q.offset && hits.len() < q.limit {
                        // Bound repeated witness evidence before cloning it into hits.
                        // 128 bytes covers the added artifact hash and JSON separators.
                        for &index in &witnesses {
                            span_evidence_bytes += span_sizes[index];
                            ensure!(
                                span_evidence_bytes <= 4 * 1024 * 1024,
                                "search result size limit; reduce page/context"
                            );
                        }
                        let token_ids: Vec<_> = matched.iter().map(|t| t.id.clone()).collect();
                        let id = digest(&(&q.project, &doc.path, &token_ids))?;
                        let left = position.saturating_sub(q.context).max(start);
                        let right = (position + q.terms.len() + q.context).min(end);
                        let all = &doc.tokens[left..right];
                        hits.push(Hit {
                            id,
                            document: doc.path.clone(),
                            title: doc.title.clone(),
                            utterance: matched[0].utterance.clone(),
                            speaker: doc
                                .segments
                                .iter()
                                .find(|s| Some(&s.id) == matched[0].utterance.as_ref())
                                .and_then(|s| s.attrs.get("who"))
                                .cloned(),
                            token_ids,
                            corpus_start: corpus + position,
                            corpus_end: corpus + position + matched.len() - 1,
                            left: doc.tokens[left..position].iter().map(Word::from).collect(),
                            matched: matched.iter().map(Word::from).collect(),
                            right: doc.tokens[position + matched.len()..right]
                                .iter()
                                .map(Word::from)
                                .collect(),
                            readings: all.iter().map(|t| text(t, q.reading).into()).collect(),
                            audio: if audio_allowed {
                                audio(&view, doc, matched)
                            } else {
                                None
                            },
                            spans: witnesses
                                .iter()
                                .map(|&index| {
                                    let span = doc.spans[index].clone();
                                    SpanEvidence {
                                        artifact_hash: view.snapshot.files[&span.sidecar]
                                            .sha256
                                            .clone(),
                                        span,
                                    }
                                })
                                .collect(),
                        });
                    }
                    total += 1;
                }
                start = end;
            }
            corpus += doc.tokens.len();
        }
        if q.mode == Mode::Current {
            ensure!(
                self.head(&q.project)?.id == q.revision,
                "stale search revision after query"
            );
        }
        let next_offset = (q.offset + hits.len() < total).then_some(q.offset + hits.len());
        let result = Matches {
            schema: 1,
            binding,
            query: q.clone(),
            total,
            hits,
            next_offset,
            rights: view.snapshot.config.rights,
        };
        ensure!(
            serde_json::to_vec(&result)?.len() <= 4 * 1024 * 1024,
            "search result size limit; reduce page/context"
        );
        Ok(Envelope {
            result_hash: digest(&result)?,
            result,
        })
    }
    pub fn resolve_search_hit(&self, request: &Resolve) -> Result<serde_json::Value> {
        let envelope = self.search(&request.query)?;
        ensure!(
            envelope.result_hash == request.result_hash,
            "search result proof mismatch"
        );
        let hit = envelope
            .result
            .hits
            .iter()
            .find(|h| h.id == request.hit_id)
            .context("hit not in exact result page")?;
        if request.query.mode == Mode::Current {
            ensure!(
                self.head(&request.query.project)?.id == request.query.revision,
                "stale search hit; query the saved head again"
            );
        }
        let result = serde_json::json!({"binding":envelope.result.binding,"hit":hit,"historical":request.query.mode==Mode::Historical});
        ensure!(
            serde_json::to_vec(&result)?.len() <= 4 * 1024 * 1024,
            "search result size limit"
        );
        Ok(result)
    }
    fn search_document(&self, view: &View, doc: &Document) -> Result<bool> {
        let source = self.objects.text(&view.snapshot, &doc.path)?;
        let tree = crate::xml::parse(&source)?;
        ensure!(
            !tree
                .descendants()
                .filter(|n| n.has_tag_name("tok"))
                .any(|n| n.ancestors().skip(1).any(|p| p.has_tag_name("tok"))),
            "nested token search mapping is unsupported; source preserved"
        );
        Ok(!tree.descendants().any(|n| {
            n.attribute(("http://www.w3.org/XML/1998/namespace", "base"))
                .is_some()
        }))
    }
    fn search_spans<'a>(
        &self,
        view: &View,
        doc: &'a Document,
        constraint: &SpanConstraint,
    ) -> Result<BTreeMap<&'a str, BTreeSet<usize>>> {
        // Projection fields retain imported attributes. Qualify the actual supported
        // sidecar grammar before relying on those fields for a linguistic join.
        let sidecars: BTreeSet<_> = doc.spans.iter().map(|s| &s.sidecar).collect();
        for sidecar in sidecars {
            let basename = std::path::Path::new(&doc.path)
                .file_name()
                .context("document basename")?
                .to_str()
                .context("document basename")?;
            ensure!(
                view.documents
                    .iter()
                    .filter(|d| std::path::Path::new(&d.path)
                        .file_name()
                        .and_then(|p| p.to_str())
                        == Some(basename))
                    .count()
                    == 1,
                "span search sidecar matches multiple transcripts; explicit association required"
            );
            let source = self.objects.text(&view.snapshot, sidecar)?;
            let tree = crate::xml::parse(&source)?;
            let root = tree.root_element();
            ensure!(
                !tree.descendants().any(|n| n
                    .attribute(("http://www.w3.org/XML/1998/namespace", "base"))
                    .is_some()),
                "span search xml:base has unknown reference scope; source preserved"
            );
            ensure!(
                root.has_tag_name("spanGrp") && root.tag_name().namespace().is_none(),
                "unsupported span search sidecar dialect; source preserved"
            );
            for node in tree.descendants().filter(|n| n.has_tag_name("span")) {
                ensure!(
                    node.parent() == Some(root)
                        && node.tag_name().namespace().is_none()
                        && node.attributes().all(|a| a.namespace().is_none()
                            || !["id", "corresp", "label", "variety"].contains(&a.name())),
                    "unsupported or ambiguous span search fields; source preserved"
                );
            }
        }
        let character_fields = [
            "wb_start",
            "wb_end",
            "wb_coordinate",
            "wb_layer",
            "wb_quote",
            "wb_status",
        ];
        let mut coverage: BTreeMap<&str, BTreeSet<usize>> = BTreeMap::new();
        for (index, span) in doc.spans.iter().enumerate() {
            if span.fields.get(constraint.field.key()) == Some(&constraint.value)
                && !character_fields
                    .iter()
                    .any(|key| span.fields.contains_key(*key))
            {
                for token in &span.token_ids {
                    coverage.entry(token).or_default().insert(index);
                }
            }
        }
        Ok(coverage)
    }
}
fn binding(view: &View) -> Result<Binding> {
    Ok(Binding {
        engine: ENGINE.into(),
        project: view.snapshot.project.clone(),
        revision: view.revision.id,
        snapshot_hash: view.revision.snapshot_hash.clone(),
        projection_hash: digest(&(&view.documents, &view.snapshot.config, ENGINE))?,
    })
}
