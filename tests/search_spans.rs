use corpus_workbench::{
    model::*,
    search::{Mode, Query, Reading, Resolve, SpanConstraint, SpanField, Term},
    store::{Fault, Store},
};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;

const DOC: &str = "xmlfiles/demo.xml";
const SIDE: &str = "Annotations/review_demo.xml";
const XML: &str = "<TEI><text variety='custom'><tok id='w1' form='alpha'/><tok id='w2' form='beta'/><tok id='w3' form='alpha'/><tok id='w4' form='beta'/></text></TEI>";
const SPANS: &str = "<spanGrp><span id='s1' corresp='#w1 #w2' label='focus' variety='custom' note='authored'/><span id='s2' corresp='#w3 #w4' label='focus'/><span id='gap' corresp='#w1 #w3' label='gap'/><span id='empty' corresp='#w1' label=''/><span id='subtoken' corresp='#w1' label='subtoken' wb_start='0' wb_end='2' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_quote='al' wb_status='resolved'/></spanGrp>";

fn fixture(sidecar: &str, extra: &[(&str, &str)]) -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("package");
    for dir in ["xmlfiles", "Annotations", "Resources"] {
        fs::create_dir_all(input.join(dir)).unwrap();
    }
    for (path, text) in [
        (DOC, XML),
        (SIDE, sidecar),
        ("Resources/settings.xml", "<ttsettings/>"),
    ]
    .into_iter()
    .chain(extra.iter().copied())
    {
        let path = input.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    s.import(&input, "p").unwrap();
    (tmp, s)
}
fn query(s: &Store, words: &[&str], field: SpanField, value: &str) -> Query {
    let r = s.head("p").unwrap();
    Query {
        schema: 1,
        project: "p".into(),
        revision: r.id,
        snapshot_hash: r.snapshot_hash,
        mode: Mode::Current,
        reading: Reading::Original,
        terms: words
            .iter()
            .map(|t| Term {
                text: (*t).into(),
                language: None,
            })
            .collect(),
        span: Some(SpanConstraint {
            field,
            value: value.into(),
        }),
        documents: vec![],
        context: 2,
        offset: 0,
        limit: 1,
    }
}

#[test]
fn one_span_covers_the_phrase_before_counts_and_pages_and_exports_real_evidence() {
    let (_tmp, s) = fixture(
        SPANS,
        &[(
            "Annotations/other_demo.xml",
            "<spanGrp><span id='s1' corresp='#w1 #w2' label='focus'/></spanGrp>",
        )],
    );
    let before = s.view("p", None).unwrap();
    let mut q = query(&s, &["alpha", "beta"], SpanField::Label, "focus");
    let first = s.search(&q).unwrap();
    assert_eq!(first.result.total, 2);
    assert_eq!(first.result.next_offset, Some(1));
    let hit = &first.result.hits[0];
    assert_eq!(hit.token_ids, ["w1", "w2"]);
    assert_eq!(hit.spans.len(), 2); // Same ID in two sidecars, one token hit.
    for witness in &hit.spans {
        assert_eq!(witness.span.id, "s1");
        assert_eq!(
            witness.artifact_hash,
            before.snapshot.files[&witness.span.sidecar].sha256
        );
        assert_eq!(witness.span.token_ids, hit.token_ids);
    }
    assert_eq!(hit.spans[1].span.fields["note"], "authored");
    assert!(hit.audio.is_none()); // No timing or media is invented from spans.
    q.offset = 1;
    let second = s.search(&q).unwrap();
    assert_eq!(second.result.total, 2);
    assert_eq!(second.result.hits[0].token_ids, ["w3", "w4"]);
    assert_eq!(second.result.hits[0].spans.len(), 1);
    assert!(second.result.next_offset.is_none());
    assert_eq!(
        s.view("p", None).unwrap().snapshot.files,
        before.snapshot.files
    );
    q.offset = 0;
    q.terms
        .iter_mut()
        .for_each(|t| t.language = Some("custom".into()));
    q.span = Some(SpanConstraint {
        field: SpanField::Variety,
        value: "custom".into(),
    });
    assert_eq!(s.search(&q).unwrap().result.total, 1);
    q.terms[0].language = Some("other".into());
    assert_eq!(s.search(&q).unwrap().result.total, 0);
}

#[test]
fn discontinuous_anchors_missing_fields_and_subtoken_spans_do_not_overclaim() {
    let (_tmp, s) = fixture(SPANS, &[]);
    let mut q = query(&s, &["alpha", "beta"], SpanField::Label, "gap");
    assert_eq!(s.search(&q).unwrap().result.total, 0);
    q.terms.pop();
    assert_eq!(s.search(&q).unwrap().result.total, 2);
    q.span.as_mut().unwrap().value = "empty".into();
    assert_eq!(s.search(&q).unwrap().result.total, 0);
    q.span.as_mut().unwrap().value = String::new();
    assert_eq!(s.search(&q).unwrap().result.total, 1); // Present empty label, not absent.
    q.span.as_mut().unwrap().value = "subtoken".into();
    assert_eq!(s.search(&q).unwrap().result.total, 0);
    q.span.as_mut().unwrap().value = "Focus".into();
    assert_eq!(s.search(&q).unwrap().result.total, 0);
    let (_tmp, s) = fixture("<spanGrp><span id='one' corresp='#w1' label='focus'/><span id='two' corresp='#w2' label='focus'/></spanGrp>", &[]);
    assert_eq!(
        s.search(&query(&s, &["alpha", "beta"], SpanField::Label, "focus"))
            .unwrap()
            .result
            .total,
        0
    );
}

#[test]
fn span_changes_stale_current_proofs_and_history_retains_exact_sidecar_hashes() {
    let (_tmp, mut s) = fixture(SPANS, &[]);
    let q = query(&s, &["alpha", "beta"], SpanField::Label, "focus");
    let old = s.search(&q).unwrap();
    let v = s.view("p", None).unwrap();
    s.apply(
        "local-owner",
        &Command {
            schema: 1,
            project: "p".into(),
            command_id: "span-change".into(),
            base_revision: v.revision.id,
            preimage_hash: v.revision.snapshot_hash,
            config_version: v.snapshot.config.version,
            label: "Synthetic label change".into(),
            operations: vec![Operation::SetSpan {
                document: DOC.into(),
                sidecar: SIDE.into(),
                id: "s1".into(),
                fields: BTreeMap::from([("label".into(), "changed".into())]),
                anchor: None,
            }],
        },
        Fault::None,
    )
    .unwrap();
    assert!(s
        .resolve_search_hit(&Resolve {
            query: q.clone(),
            result_hash: old.result_hash,
            hit_id: old.result.hits[0].id.clone()
        })
        .is_err());
    let mut historical = q;
    historical.mode = Mode::Historical;
    let retained = s.search(&historical).unwrap();
    assert_eq!(retained.result.total, 2);
    assert_eq!(
        retained.result.hits[0].spans[0].artifact_hash,
        old.result.hits[0].spans[0].artifact_hash
    );
    assert_eq!(
        retained.result.hits[0].spans[0].span.fields["label"],
        "focus"
    );
    let mut resolve = Resolve {
        query: historical,
        result_hash: retained.result_hash,
        hit_id: retained.result.hits[0].id.clone(),
    };
    assert_eq!(s.resolve_search_hit(&resolve).unwrap()["historical"], true);
    resolve.query.span.as_mut().unwrap().value = "changed".into();
    assert!(s.resolve_search_hit(&resolve).is_err());
    assert_eq!(
        s.search(&query(&s, &["alpha", "beta"], SpanField::Label, "focus"))
            .unwrap()
            .result
            .total,
        1
    );
}

#[test]
fn span_constraint_grammar_limits_and_legacy_omission_are_explicit() {
    let (_tmp, s) = fixture(SPANS, &[]);
    let mut q = query(&s, &["alpha"], SpanField::Label, "focus");
    q.span.as_mut().unwrap().value = "x".repeat(513);
    assert!(s.search(&q).unwrap_err().to_string().contains("length"));
    q.span.as_mut().unwrap().value = "\0".into();
    assert!(s.search(&q).is_err());
    let mut value = serde_json::to_value(&q).unwrap();
    value["span"] = serde_json::json!({"field":"regex","value":".*"});
    assert!(serde_json::from_value::<Query>(value.clone()).is_err());
    value["span"] = serde_json::json!({"field":"label","value":"focus","overlap":true});
    assert!(serde_json::from_value::<Query>(value.clone()).is_err());
    value.as_object_mut().unwrap().remove("span");
    let legacy: Query = serde_json::from_value(value).unwrap();
    let result = s.search(&legacy).unwrap();
    assert_eq!(result.result.total, 2);
    assert!(serde_json::to_value(result).unwrap()["result"]["query"]
        .get("span")
        .is_none());
}

#[test]
fn ambiguous_associations_and_unsupported_namespace_or_structure_fail_closed() {
    for spans in [
        "<spanGrp xmlns:x='urn:test'><span id='s' corresp='#w1' label='focus' x:label='other'/></spanGrp>",
        "<spanGrp><group><span id='s' corresp='#w1' label='focus'/></group></spanGrp>",
        "<other><span id='s' corresp='#w1' label='focus'/></other>",
        "<spanGrp xml:base='https://example.invalid/elsewhere.xml'><span id='s' corresp='#w1' label='focus'/></spanGrp>",
        "<spanGrp><span id='s' xml:base='other.xml' corresp='#w1' label='focus'/></spanGrp>",
    ] {
        let (_tmp, s) = fixture(spans, &[]);
        assert!(s.search(&query(&s, &["alpha"], SpanField::Label, "focus")).is_err());
    }
    let (_tmp, s) = fixture(SPANS, &[("xmlfiles/other/demo.xml", XML)]);
    let mut q = query(&s, &["alpha"], SpanField::Label, "focus");
    q.documents = vec![DOC.into()]; // Restricting hits cannot disambiguate shared evidence.
    assert!(s
        .search(&q)
        .unwrap_err()
        .to_string()
        .contains("multiple transcripts"));
}

#[test]
fn repeated_witness_evidence_is_bounded_and_a_smaller_page_still_works() {
    let tokens = (0..100)
        .map(|i| format!("<tok id='w{i}' form='alpha'/>"))
        .collect::<String>();
    let ids = (0..100)
        .map(|i| format!("#w{i}"))
        .collect::<Vec<_>>()
        .join(" ");
    let spans = format!(
        "<spanGrp><span id='s' corresp='{ids}' label='focus' note='{}'/></spanGrp>",
        "x".repeat(60_000)
    );
    let xml = format!("<TEI><text>{tokens}</text></TEI>");
    let (_tmp, s) = fixture(&spans, &[(DOC, &xml)]);
    let mut q = query(&s, &["alpha"], SpanField::Label, "focus");
    q.limit = 200;
    assert!(s
        .search(&q)
        .unwrap_err()
        .to_string()
        .contains("result size limit"));
    q.limit = 10;
    let result = s.search(&q).unwrap();
    assert_eq!(result.result.total, 100);
    assert_eq!(result.result.hits.len(), 10);
    assert_eq!(result.result.hits[0].spans[0].span.token_ids.len(), 100);
}

#[test]
fn span_join_work_is_bounded_before_searching() {
    let spans = format!(
        "<spanGrp>{}</spanGrp>",
        (0..11)
            .map(|i| format!(
                "<span id='s{i}' label='focus' corresp='{}'/>",
                "#w1 ".repeat(10_000)
            ))
            .collect::<String>()
    );
    let (_tmp, s) = fixture(&spans, &[]);
    assert!(s
        .search(&query(&s, &["alpha"], SpanField::Label, "focus"))
        .unwrap_err()
        .to_string()
        .contains("span anchor limit"));
}
