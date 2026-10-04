use corpus_workbench::{
    model::*,
    store::{Fault, Store},
    xml,
};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;

const DOC: &str = "xmlfiles/demo.xml";
const SIDE: &str = "Annotations/review_demo.xml";
const XML: &str = "<?xml version='1.0'?>\n<TEI xmlns:x='urn:opaque'><text><u id='u-1' start='0' end='4'><tok id='w-1' form='é😊x' relation_target = '#w-2' relation_type=\"context\" note='keep &amp; note' x:opaque='keep'>é😊x</tok> <tok id='w-2' form='two'>two</tok><tok id='w-3' form='three'>three</tok></u><u id='u-2' start='2' end='6'/></text></TEI>\n";
const SPANS: &str = "<?custom keep='yes'?>\n<spanGrp xmlns:x='urn:opaque'><!--keep--><span id='s-1' corresp='&#35;w-1   #w-3' label='old &amp; label' x:opaque='retain'>Authored <x:mark keep='yes'>mixed</x:mark> content</span><span id='s-2' corresp='#w-2' label='other'/></spanGrp>\n";
fn fixture_with(document: &str, spans: &str) -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    for sub in ["xmlfiles", "Annotations", "Resources", "Raw"] {
        fs::create_dir_all(input.join(sub)).unwrap();
    }
    fs::write(input.join(DOC), document).unwrap();
    fs::write(input.join(SIDE), spans).unwrap();
    fs::write(
        input.join("Resources/settings.xml"),
        "<ttsettings unknown='preserve'/>",
    )
    .unwrap();
    fs::write(
        input.join("Raw/asr.raw.json"),
        b"{\"text\":\"synthetic immutable draft\",\"word_times\":null}",
    )
    .unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    store.import(&input, "p").unwrap();
    (tmp, store)
}
fn fixture() -> (TempDir, Store) {
    fixture_with(XML, SPANS)
}
fn cmd(s: &Store, id: &str, ops: Vec<Operation>) -> Command {
    let v = s.view("p", None).unwrap();
    Command {
        schema: 1,
        project: "p".into(),
        command_id: id.into(),
        base_revision: v.revision.id,
        preimage_hash: v.revision.snapshot_hash,
        config_version: v.snapshot.config.version,
        label: id.into(),
        operations: ops,
    }
}
fn edit(fields: BTreeMap<String, String>, anchor: Option<SpanAnchorUpdate>) -> Operation {
    Operation::SetSpan {
        document: DOC.into(),
        sidecar: SIDE.into(),
        id: "s-1".into(),
        fields,
        anchor,
    }
}
fn label(value: &str) -> Operation {
    edit(BTreeMap::from([("label".into(), value.into())]), None)
}
fn tokens(ids: &[&str]) -> Operation {
    edit(
        BTreeMap::new(),
        Some(SpanAnchorUpdate::Tokens {
            token_ids: ids.iter().map(|s| s.to_string()).collect(),
        }),
    )
}
fn character(start: usize, end: usize, quote: &str) -> Operation {
    edit(
        BTreeMap::new(),
        Some(SpanAnchorUpdate::Character {
            anchor: CharacterAnchor {
                token: "w-1".into(),
                start,
                end,
                quote: quote.into(),
                coordinate: "unicode-codepoint".into(),
                layer: "corrected".into(),
            },
        }),
    )
}
fn relation(to: &str, kind: &str, note: Option<&str>) -> Operation {
    Operation::SetRelation {
        document: DOC.into(),
        from: "w-1".into(),
        to: to.into(),
        relation_type: kind.into(),
        note: note.map(str::to_string),
    }
}
fn clear() -> Operation {
    Operation::ClearRelation {
        document: DOC.into(),
        from: "w-1".into(),
    }
}
fn apply(s: &mut Store, id: &str, op: Operation) -> Revision {
    let c = cmd(s, id, vec![op]);
    s.apply("local-owner", &c, Fault::None).unwrap()
}
fn text(s: &Store, path: &str) -> String {
    let v = s.view("p", None).unwrap();
    s.objects.text(&v.snapshot, path).unwrap()
}
fn approve(s: &mut Store) -> bool {
    let r = s.head("p").unwrap();
    s.review(
        "local-owner",
        "p",
        r.id,
        &r.snapshot_hash,
        "approved",
        "Synthetic mechanics",
    )
    .is_ok()
}
fn reject_unchanged(s: &mut Store, id: &str, ops: Vec<Operation>) {
    let before = s.view("p", None).unwrap();
    let count = s.history("p").unwrap().len();
    let c = cmd(s, id, ops);
    assert!(s.apply("local-owner", &c, Fault::None).is_err(), "{id}");
    let after = s.view("p", None).unwrap();
    assert_eq!(before.revision.id, after.revision.id, "{id}");
    assert_eq!(before.snapshot, after.snapshot, "{id}");
    assert_eq!(count, s.history("p").unwrap().len(), "{id}");
}

#[test]
fn field_edit_changes_only_requested_lexical_value_and_preserves_identity() {
    let (_tmp, mut s) = fixture();
    let before = s.view("p", None).unwrap();
    apply(&mut s, "label", label("new & label"));
    assert_eq!(
        text(&s, SIDE),
        SPANS.replace("label='old &amp; label'", "label='new &amp; label'")
    );
    let after = s.view("p", None).unwrap();
    for (path, a) in before.snapshot.files {
        if path != SIDE {
            assert_eq!(after.snapshot.files[&path], a)
        }
    }
    assert_eq!(
        before.documents[0].tokens[0].internal_id,
        after.documents[0].tokens[0].internal_id
    );
    assert_eq!(after.documents[0].spans[0].id, "s-1");
    assert!(after.documents[0]
        .tokens
        .iter()
        .all(|t| t.start_us.is_none()));
}
#[test]
fn unchanged_anchors_and_fields_keep_original_entities_and_spacing() {
    let (_tmp, mut s) = fixture();
    let op = edit(
        BTreeMap::from([
            ("label".into(), "old & label".into()),
            ("note".into(), "new".into()),
        ]),
        Some(SpanAnchorUpdate::Tokens {
            token_ids: vec!["w-1".into(), "w-3".into()],
        }),
    );
    apply(&mut s, "note", op);
    assert_eq!(
        text(&s, SIDE),
        SPANS.replacen("x:opaque='retain'>", "x:opaque='retain' note=\"new\">", 1)
    );
    reject_unchanged(&mut s, "noop", vec![label("old & label")]);
}
#[test]
fn ordered_discontinuous_reanchor_keeps_span_body_and_all_token_ids() {
    let (_tmp, mut s) = fixture();
    apply(&mut s, "reanchor", tokens(&["w-3", "w-1"]));
    assert_eq!(
        text(&s, SIDE),
        SPANS.replace("corresp='&#35;w-1   #w-3'", "corresp='#w-3 #w-1'")
    );
    assert_eq!(text(&s, DOC), XML);
    assert_eq!(
        s.view("p", None).unwrap().documents[0].spans[0].token_ids,
        vec!["w-3", "w-1"]
    );
}
#[test]
fn invalid_anchor_field_and_scope_edits_leave_authority_unchanged() {
    let (_tmp, mut s) = fixture();
    for (i, op) in [
        tokens(&[]),
        tokens(&["missing"]),
        tokens(&["w-1", "w-1"]),
        edit(BTreeMap::from([("id".into(), "renamed".into())]), None),
        edit(
            BTreeMap::from([("variety".into(), "undefined".into())]),
            None,
        ),
        Operation::SetSpan {
            document: DOC.into(),
            sidecar: "Annotations/foreign_demo.xml".into(),
            id: "s-1".into(),
            fields: BTreeMap::from([("label".into(), "bad".into())]),
            anchor: None,
        },
    ]
    .into_iter()
    .enumerate()
    {
        reject_unchanged(&mut s, &format!("invalid-{i}"), vec![op])
    }
}
#[test]
fn unknown_sidecar_structures_and_namespace_collisions_are_read_only() {
    for (i, spans) in [
        SPANS
            .replace("<spanGrp ", "<wrapper><spanGrp ")
            .replace("</spanGrp>", "</spanGrp></wrapper>"),
        SPANS
            .replace("<span id='s-1'", "<group><span id='s-1'")
            .replace("</span><span id='s-2'", "</span></group><span id='s-2'"),
        SPANS.replace(
            "label='old &amp; label'",
            "label='old &amp; label' x:label='ambiguous'",
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let (_tmp, mut s) = fixture_with(XML, &spans);
        reject_unchanged(&mut s, &format!("dialect-{i}"), vec![label("changed")]);
    }
}
#[test]
fn unicode_character_repair_is_explicit_and_label_edits_do_not_resolve_it() {
    let (_tmp, mut s) = fixture();
    apply(&mut s, "character", character(1, 3, "́😊"));
    assert!(approve(&mut s));
    apply(
        &mut s,
        "correct",
        Operation::SetToken {
            document: DOC.into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("nform".into(), "É😊x".into())]),
        },
    );
    apply(&mut s, "label", label("still unresolved"));
    assert_eq!(
        s.view("p", None).unwrap().documents[0].spans[0].fields["wb_status"],
        "unresolved"
    );
    assert!(!approve(&mut s));
    apply(&mut s, "repair", character(1, 3, "́😊"));
    assert!(approve(&mut s));
    assert_eq!(
        s.view("p", None).unwrap().documents[0].tokens[0].original,
        "é😊x"
    );
}
#[test]
fn byte_utf16_grapheme_and_invalid_character_ranges_are_rejected() {
    let (_tmp, mut s) = fixture();
    for (i, op) in [
        character(1, 4, "́😊"),
        character(1, 7, "́😊"),
        character(1, 2, "😊"),
        character(3, 2, ""),
        character(0, 0, ""),
        character(2, 3, "wrong"),
    ]
    .into_iter()
    .enumerate()
    {
        reject_unchanged(&mut s, &format!("coordinate-{i}"), vec![op])
    }
}
#[test]
fn whole_token_conversion_removes_only_character_attributes() {
    let (_tmp, mut s) = fixture();
    apply(&mut s, "character", character(1, 3, "́😊"));
    let before = text(&s, SIDE);
    let expected = xml::remove_attrs(
        &before,
        "span",
        "s-1",
        &[
            "wb_start",
            "wb_end",
            "wb_coordinate",
            "wb_layer",
            "wb_quote",
            "wb_status",
        ],
    )
    .unwrap();
    apply(&mut s, "whole", tokens(&["w-1"]));
    assert_eq!(text(&s, SIDE), expected);
    assert!(approve(&mut s));
    assert!(text(&s, SIDE).contains("x:opaque='retain'"));
}
#[test]
fn lexical_attribute_removal_retains_every_surrounding_byte() {
    let input =
        "<r><tok id='a'\n relation_target \t= \"#b&amp;#c\"  relation_type='a=b' note='😊'/></r>";
    assert_eq!(
        xml::remove_attrs(input, "tok", "a", &["relation_target", "relation_type"]).unwrap(),
        "<r><tok id='a'\n    note='😊'/></r>"
    );
}
#[test]
fn relation_edit_and_clear_preserve_original_text_notes_unknowns_and_ids() {
    let (_tmp, mut s) = fixture();
    apply(&mut s, "link", relation("#w-3", "changed", None));
    let edited = XML
        .replace("'#w-2'", "'#w-3'")
        .replace("\"context\"", "\"changed\"");
    assert_eq!(text(&s, DOC), edited);
    apply(&mut s, "clear", clear());
    assert_eq!(
        text(&s, DOC),
        edited
            .replace("relation_target = '#w-3'", "")
            .replace("relation_type=\"changed\"", "")
    );
    assert_eq!(text(&s, SIDE), SPANS);
    let v = s.view("p", None).unwrap();
    assert_eq!(v.documents[0].tokens[0].attrs["note"], "keep & note");
    assert_eq!(v.documents[0].tokens[0].original, "é😊x");
    reject_unchanged(&mut s, "missing", vec![clear()]);
}
#[test]
fn relation_note_change_is_explicit_and_invalid_or_ambiguous_links_fail() {
    let (_tmp, mut s) = fixture();
    apply(
        &mut s,
        "note",
        relation("#w-2", "context", Some("new note")),
    );
    assert!(text(&s, DOC).contains("note='new note'"));
    for (i, op) in [
        relation("#w-1", "context", None),
        relation("missing", "context", None),
        relation("", "context", None),
        relation("#w-2", " ", None),
        relation("#w-2", "context", Some("new note")),
    ]
    .into_iter()
    .enumerate()
    {
        reject_unchanged(&mut s, &format!("link-{i}"), vec![op])
    }
    for key in ["relation_target", "relation_type", "note"] {
        let value = if key == "relation_target" {
            "#w-3"
        } else {
            "ambiguous"
        };
        let xml = XML.replace(
            "x:opaque='keep'",
            &format!("x:opaque='keep' x:{key}='{value}'"),
        );
        let (_tmp, mut s) = fixture_with(&xml, SPANS);
        reject_unchanged(&mut s, key, vec![relation("#w-3", "change", None)]);
        reject_unchanged(&mut s, &format!("clear-{key}"), vec![clear()]);
    }
}
#[test]
fn batch_failure_rolls_back_span_and_relation_together() {
    let (_tmp, mut s) = fixture();
    reject_unchanged(
        &mut s,
        "atomic",
        vec![label("staged"), relation("missing", "bad", None)],
    );
    assert_eq!(text(&s, SIDE), SPANS);
    assert_eq!(text(&s, DOC), XML);
}
#[test]
fn undo_restores_exact_bytes_without_restoring_approval_and_retries_are_bound() {
    let (_tmp, mut s) = fixture();
    assert!(approve(&mut s));
    let c = cmd(&s, "edit", vec![label("new"), clear()]);
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(r.id, s.apply("local-owner", &c, Fault::None).unwrap().id);
    assert!(!s.view("p", None).unwrap().approved);
    let mut different = c.clone();
    different.operations = vec![label("other")];
    assert!(s.apply("local-owner", &different, Fault::None).is_err());
    reject_unchanged(&mut s, "stale", vec![Operation::Restore { revision: 999 }]);
    apply(
        &mut s,
        "undo",
        Operation::Restore {
            revision: c.base_revision,
        },
    );
    assert_eq!(text(&s, SIDE), SPANS);
    assert_eq!(text(&s, DOC), XML);
    assert!(!s.view("p", None).unwrap().approved);
    assert!(s
        .apply("local-owner", &cmd_at_old(&c), Fault::None)
        .is_err());
}
fn cmd_at_old(c: &Command) -> Command {
    let mut old = c.clone();
    old.command_id = "stale-tab".into();
    old
}
#[test]
fn multi_artifact_annotation_commit_recovers_at_each_transaction_boundary() {
    for (i, fault) in [Fault::AfterStage, Fault::BeforeCommit, Fault::AfterCommit]
        .into_iter()
        .enumerate()
    {
        let (tmp, mut s) = fixture();
        let c = cmd(&s, &format!("fault-{i}"), vec![label("new"), clear()]);
        assert!(s.apply("local-owner", &c, fault).is_err());
        drop(s);
        let mut s = Store::open(&tmp.path().join("authority")).unwrap();
        if i < 2 {
            assert_eq!(text(&s, SIDE), SPANS);
            assert_eq!(text(&s, DOC), XML);
        } else {
            assert!(text(&s, SIDE).contains("label='new'"));
            assert!(!text(&s, DOC).contains("relation_target"));
        }
        s.apply("local-owner", &c, Fault::None).unwrap();
        assert_eq!(s.history("p").unwrap().len(), 2);
    }
}
#[test]
fn complete_export_reimport_keeps_edited_artifacts_and_all_historical_objects() {
    let (tmp, mut s) = fixture();
    let first = s.head("p").unwrap();
    apply(&mut s, "span", tokens(&["w-3", "w-1"]));
    apply(&mut s, "clear", clear());
    let head = s.head("p").unwrap();
    let out = tmp.path().join("export");
    s.export("p", head.id, &out).unwrap();
    let current = s.snapshot(&head).unwrap();
    for (path, a) in &current.files {
        assert_eq!(
            fs::read(out.join(path)).unwrap(),
            s.objects.read(a).unwrap()
        );
    }
    let original = s.snapshot(&first).unwrap();
    for a in original.files.values() {
        assert!(walkdir::WalkDir::new(&out)
            .into_iter()
            .any(|e| e.unwrap().file_name().to_str() == Some(a.sha256.as_str())));
    }
    let mut reopened = Store::open(&tmp.path().join("reopened")).unwrap();
    reopened.import(&out, "p").unwrap();
    assert_eq!(text(&reopened, SIDE), text(&s, SIDE));
    assert_eq!(text(&reopened, DOC), text(&s, DOC));
    assert!(!reopened.view("p", None).unwrap().approved);
}

#[test]
fn same_bare_span_id_in_two_sidecars_edits_and_diffs_the_requested_scope() {
    let (tmp, _initial) = fixture();
    let other = "Annotations/other_demo.xml";
    fs::write(tmp.path().join("input").join(other), SPANS).unwrap();
    let mut s = Store::open(&tmp.path().join("scoped-authority")).unwrap();
    let before = s.import(&tmp.path().join("input"), "p").unwrap();
    let op = Operation::SetSpan {
        document: DOC.into(),
        sidecar: other.into(),
        id: "s-1".into(),
        fields: BTreeMap::from([("label".into(), "scoped change".into())]),
        anchor: None,
    };
    let after = apply(&mut s, "scope", op);
    assert_eq!(text(&s, SIDE), SPANS);
    assert_eq!(
        text(&s, other),
        SPANS.replace("label='old &amp; label'", "label='scoped change'")
    );
    let diff = s.diff("p", before.id, after.id).unwrap();
    let changes = diff["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0]["sidecar"], other);
    assert_eq!(changes[0]["target"], "s-1");
    assert!(approve(&mut s));
    assert!(s
        .approved_contract("p", after.id)
        .unwrap_err()
        .to_string()
        .contains("ambiguous span IDs"));
}

#[test]
fn sidecar_aliasing_between_equal_transcript_filenames_blocks_edits_and_handoff() {
    let (tmp, _initial) = fixture();
    for folder in ["a", "b"] {
        let path = tmp.path().join("input/xmlfiles").join(folder);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("demo.xml"), XML).unwrap();
    }
    let mut s = Store::open(&tmp.path().join("aliased-authority")).unwrap();
    s.import(&tmp.path().join("input"), "p").unwrap();
    let mut operation = label("only A");
    if let Operation::SetSpan { document, .. } = &mut operation {
        *document = "xmlfiles/a/demo.xml".into()
    }
    reject_unchanged(&mut s, "aliased", vec![operation]);
    assert_eq!(text(&s, SIDE), SPANS);
    assert!(approve(&mut s));
    assert!(s
        .approved_contract("p", s.head("p").unwrap().id)
        .unwrap_err()
        .to_string()
        .contains("multiple transcripts"));
}

#[test]
fn new_span_cannot_introduce_ambiguous_shared_sidecar_association() {
    let (tmp, _initial) = fixture();
    fs::remove_file(tmp.path().join("input").join(SIDE)).unwrap();
    for folder in ["a", "b"] {
        let path = tmp.path().join("input/xmlfiles").join(folder);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("demo.xml"), XML).unwrap();
    }
    let mut s = Store::open(&tmp.path().join("new-span-authority")).unwrap();
    s.import(&tmp.path().join("input"), "p").unwrap();
    reject_unchanged(
        &mut s,
        "new-aliased",
        vec![Operation::AddSpan {
            document: "xmlfiles/a/demo.xml".into(),
            id: "new-span".into(),
            token_ids: vec!["w-1".into()],
            fields: BTreeMap::from([("label".into(), "only A".into())]),
            character: None,
        }],
    );
    assert!(s
        .view("p", None)
        .unwrap()
        .documents
        .iter()
        .all(|d| d.spans.is_empty()));
}

#[test]
fn token_correction_cannot_rewrite_shared_character_sidecar_status() {
    let spans=SPANS.replace("corresp='&#35;w-1   #w-3'","corresp='#w-1' wb_start='0' wb_end='1' wb_quote='e' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_status='resolved'");
    let (tmp, _initial) = fixture_with(XML, &spans);
    let folder = tmp.path().join("input/xmlfiles/a");
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("demo.xml"), XML).unwrap();
    let mut s = Store::open(&tmp.path().join("shared-character-authority")).unwrap();
    s.import(&tmp.path().join("input"), "p").unwrap();
    reject_unchanged(
        &mut s,
        "shared-correction",
        vec![Operation::SetToken {
            document: "xmlfiles/a/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("nform".into(), "changed".into())]),
        }],
    );
    assert_eq!(text(&s, SIDE), spans);
    assert_eq!(text(&s, "xmlfiles/a/demo.xml"), XML);
}
