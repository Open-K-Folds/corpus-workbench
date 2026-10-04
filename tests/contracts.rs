use corpus_workbench::{
    model::*,
    package::{self, Objects},
    store::{Fault, Store},
    xml,
};
use std::{collections::BTreeMap, fs, path::Path};
use tempfile::TempDir;

const XML: &str = "<?xml version=\"1.0\"?>\n<?custom keep='yes'?>\n<TEI xmlns:x='urn:unknown'><!--keep--><teiHeader><title>synthetic</title><media url='synthetic.wav'/></teiHeader><text><body><u id='u-1' start='0.000' end='4.0'><tok id='w-1' form='é😀&amp;x' custom='retain &apos; lexical'>é😀&amp;x</tok> <tok form=\"ngiyabona\" id=\"w-2\">ngiyabona</tok><x:opaque a='&quot;'>unknown<mtok id='m-1'>nested</mtok></x:opaque></u><u id='u-2' start='2' end='6'><tok id='w-3' form='slang'>slang</tok></u></body></text></TEI>\n";
fn fixture() -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join("input");
    for sub in ["xmlfiles", "Resources", "Annotations", "Audio", "Raw"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }
    fs::write(dir.join("xmlfiles/demo.xml"), XML).unwrap();
    fs::write(
        dir.join("Resources/settings.xml"),
        "<ttsettings><annotations><item key='review' type='standoff'/></annotations></ttsettings>",
    )
    .unwrap();
    fs::write(
        dir.join("Annotations/review_def.xml"),
        "<annotation name='test'><interp key='label'/></annotation>",
    )
    .unwrap();
    fs::write(dir.join("Audio/synthetic.wav"), b"synthetic-media").unwrap();
    fs::write(
        dir.join("Raw/asr.raw.json"),
        b"{\"text\":\"immutable synthetic draft\"}",
    )
    .unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    store.import(&dir, "pilot").unwrap();
    (tmp, store)
}
fn command(store: &Store, id: &str, operations: Vec<Operation>) -> Command {
    let view = store.view("pilot", None).unwrap();
    Command {
        schema: 1,
        project: "pilot".into(),
        command_id: id.into(),
        base_revision: view.revision.id,
        preimage_hash: view.revision.snapshot_hash,
        config_version: view.snapshot.config.version,
        label: id.into(),
        operations,
    }
}
fn edit(store: &Store, id: &str, text: &str) -> Command {
    command(
        store,
        id,
        vec![Operation::SetToken {
            document: "xmlfiles/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("nform".into(), text.into())]),
        }],
    )
}
#[test]
fn noop_all_files_byte_identical() {
    let (tmp, store) = fixture();
    let head = store.head("pilot").unwrap();
    let out = tmp.path().join("export");
    store.export("pilot", head.id, &out).unwrap();
    for (p, a) in store.snapshot(&head).unwrap().files {
        assert_eq!(
            fs::read(out.join(p)).unwrap(),
            store.objects.read(&a).unwrap()
        );
    }
}
#[test]
fn intended_edit_preserves_every_unaffected_byte() {
    let (_tmp, mut s) = fixture();
    let c = edit(&s, "correct", "hello & \"'😀");
    s.apply("local-owner", &c, Fault::None).unwrap();
    let snap = s.snapshot(&s.head("pilot").unwrap()).unwrap();
    let text = s.objects.text(&snap, "xmlfiles/demo.xml").unwrap();
    assert_eq!(
        text,
        XML.replacen(
            "custom='retain &apos; lexical'>",
            "custom='retain &apos; lexical' nform=\"hello &amp; &quot;&apos;😀\">",
            1
        )
    );
    assert_eq!(
        s.view("pilot", None).unwrap().documents[0].tokens[0].original,
        "é😀&x"
    );
}
#[test]
fn stable_id_not_derived_from_text() {
    let (_tmp, mut s) = fixture();
    let id = s.view("pilot", None).unwrap().documents[0].tokens[0]
        .internal_id
        .clone();
    let c = edit(&s, "correct", "changed");
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(
        id,
        s.view("pilot", None).unwrap().documents[0].tokens[0].internal_id
    );
}
#[test]
fn unknown_xml_comments_pi_entity_quote_and_nested_forms_preserved() {
    let doc = xml::project_document("p", "d", XML, &Config::default()).unwrap();
    assert!(doc.opaque_elements.contains(&"mtok".into()));
    let result = xml::patch_attrs(
        XML,
        "tok",
        "w-2",
        &BTreeMap::from([("pos".into(), "custom".into())]),
    )
    .unwrap();
    assert!(result.contains("<?custom keep='yes'?>"));
    assert!(result.contains("<x:opaque a='&quot;'>unknown<mtok id='m-1'>nested</mtok></x:opaque>"));
}
#[test]
fn overlapping_speech_and_missing_word_times_are_not_filled() {
    let (_tmp, s) = fixture();
    let doc = &s.view("pilot", None).unwrap().documents[0];
    assert_eq!(doc.segments[1].start_us, Some(2_000_000));
    assert!(doc
        .tokens
        .iter()
        .all(|t| t.start_us.is_none() && t.end_us.is_none()));
}
#[test]
fn decimal_time_base_exact() {
    assert_eq!(xml::time_us(Some("123.456")).unwrap(), Some(123456000));
    assert!(xml::time_us(Some("0.1234567")).is_err());
    assert!(xml::time_us(Some("NaN")).is_err());
}
#[test]
fn stale_tab_rejected() {
    let (_tmp, mut s) = fixture();
    let a = edit(&s, "a", "A");
    let b = edit(&s, "b", "B");
    s.apply("local-owner", &a, Fault::None).unwrap();
    assert!(s
        .apply("local-owner", &b, Fault::None)
        .unwrap_err()
        .to_string()
        .contains("stale"));
    assert_eq!(s.history("pilot").unwrap().len(), 2);
}
#[test]
fn idempotent_retry_returns_original_revision() {
    let (_tmp, mut s) = fixture();
    let c = edit(&s, "retry", "A");
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(r.id, s.apply("local-owner", &c, Fault::None).unwrap().id);
    assert_eq!(s.history("pilot").unwrap().len(), 2);
}
#[test]
fn idempotency_payload_binding_rejects_changed_request() {
    let (_tmp, mut s) = fixture();
    let mut c = edit(&s, "retry", "A");
    s.apply("local-owner", &c, Fault::None).unwrap();
    c.label = "changed".into();
    assert!(s
        .apply("local-owner", &c, Fault::None)
        .unwrap_err()
        .to_string()
        .contains("idempotency"));
}
#[test]
fn source_preimage_and_configuration_preconditions_checked() {
    let (_tmp, mut s) = fixture();
    let mut c = edit(&s, "preimage", "A");
    c.preimage_hash = "0".repeat(64);
    assert!(s.apply("local-owner", &c, Fault::None).is_err());
    let mut c = edit(&s, "config", "A");
    c.config_version = 999;
    assert!(s.apply("local-owner", &c, Fault::None).is_err());
}
#[test]
fn crash_after_staging_keeps_old_head() {
    let (tmp, mut s) = fixture();
    let c = edit(&s, "stage", "A");
    let id = c.base_revision;
    assert!(s.apply("local-owner", &c, Fault::AfterStage).is_err());
    drop(s);
    let s = Store::open(&tmp.path().join("authority")).unwrap();
    assert_eq!(s.head("pilot").unwrap().id, id);
}
#[test]
fn crash_before_transaction_commit_rolls_back() {
    let (tmp, mut s) = fixture();
    let c = edit(&s, "before", "A");
    assert!(s.apply("local-owner", &c, Fault::BeforeCommit).is_err());
    drop(s);
    let s = Store::open(&tmp.path().join("authority")).unwrap();
    assert_eq!(s.history("pilot").unwrap().len(), 1);
}
#[test]
fn response_loss_after_commit_can_be_retried_after_restart() {
    let (tmp, mut s) = fixture();
    let c = edit(&s, "after", "A");
    assert!(s.apply("local-owner", &c, Fault::AfterCommit).is_err());
    drop(s);
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(r.id, s.head("pilot").unwrap().id);
    assert_eq!(s.history("pilot").unwrap().len(), 2);
}
#[test]
fn batch_is_atomic_when_later_operation_invalid() {
    let (_tmp, mut s) = fixture();
    let mut c = edit(&s, "atomic", "A");
    c.operations.push(Operation::AddRelation {
        document: "xmlfiles/demo.xml".into(),
        from: "w-1".into(),
        to: "missing".into(),
        relation_type: "x".into(),
        note: "".into(),
    });
    assert!(s.apply("local-owner", &c, Fault::None).is_err());
    assert_eq!(s.history("pilot").unwrap().len(), 1);
}
#[test]
fn approval_does_not_follow_changed_or_restored_content() {
    let (_tmp, mut s) = fixture();
    let r = s.head("pilot").unwrap();
    s.review(
        "local-owner",
        "pilot",
        r.id,
        &r.snapshot_hash,
        "approved",
        "self-review",
    )
    .unwrap();
    assert!(s.view("pilot", None).unwrap().approved);
    let c = edit(&s, "edit", "A");
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(!s.view("pilot", None).unwrap().approved);
    let c = command(&s, "restore", vec![Operation::Restore { revision: r.id }]);
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(!s.view("pilot", None).unwrap().approved);
    assert!(s.view("pilot", Some(r.id)).unwrap().approved);
}
#[test]
fn history_diff_and_restore_retain_intervening_records() {
    let (_tmp, mut s) = fixture();
    let r = s.head("pilot").unwrap();
    let c = edit(&s, "A", "A");
    let a = s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(
        s.diff("pilot", r.id, a.id).unwrap()["changes"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let c = command(&s, "undo", vec![Operation::Restore { revision: r.id }]);
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(s.history("pilot").unwrap().len(), 3);
}
#[test]
fn unicode_codepoints_not_utf16_or_bytes() {
    let (_tmp, mut s) = fixture();
    let op = Operation::AddSpan {
        document: "xmlfiles/demo.xml".into(),
        id: "an-unicode".into(),
        token_ids: vec!["w-1".into()],
        fields: BTreeMap::new(),
        character: Some(CharacterAnchor {
            token: "w-1".into(),
            start: 2,
            end: 3,
            quote: "😀".into(),
            coordinate: "unicode-codepoint".into(),
            layer: "corrected".into(),
        }),
    };
    let c = command(&s, "span", vec![op]);
    s.apply("local-owner", &c, Fault::None).unwrap();
    let span = &s.view("pilot", None).unwrap().documents[0].spans[0];
    assert_eq!(span.fields["wb_start"], "2");
    assert_eq!(span.fields["wb_quote"], "😀");
}
#[test]
fn character_span_becomes_unresolved_after_correction_and_blocks_review() {
    let (_tmp, mut s) = fixture();
    let c = command(
        &s,
        "span",
        vec![Operation::AddSpan {
            document: "xmlfiles/demo.xml".into(),
            id: "an-1".into(),
            token_ids: vec!["w-1".into()],
            fields: BTreeMap::new(),
            character: Some(CharacterAnchor {
                token: "w-1".into(),
                start: 2,
                end: 3,
                quote: "😀".into(),
                coordinate: "unicode-codepoint".into(),
                layer: "corrected".into(),
            }),
        }],
    );
    s.apply("local-owner", &c, Fault::None).unwrap();
    let c = edit(&s, "edit", "other");
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(s
        .view("pilot", None)
        .unwrap()
        .issues
        .iter()
        .any(|i| i.blocking));
    assert!(s
        .review(
            "local-owner",
            "pilot",
            r.id,
            &r.snapshot_hash,
            "approved",
            ""
        )
        .is_err());
}
#[test]
fn discontinuous_span_and_directed_relation_export() {
    let (tmp, mut s) = fixture();
    let c = command(
        &s,
        "span",
        vec![
            Operation::AddSpan {
                document: "xmlfiles/demo.xml".into(),
                id: "an-1".into(),
                token_ids: vec!["w-1".into(), "w-3".into()],
                fields: BTreeMap::from([("label".into(), "mixed".into())]),
                character: None,
            },
            Operation::AddRelation {
                document: "xmlfiles/demo.xml".into(),
                from: "w-1".into(),
                to: "w-3".into(),
                relation_type: "context".into(),
                note: "test".into(),
            },
        ],
    );
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    let out = tmp.path().join("out");
    s.export("pilot", r.id, &out).unwrap();
    let imported = package::import(&s.objects, &out, "again").unwrap();
    let doc = &package::documents(&s.objects, &imported).unwrap()[0];
    assert_eq!(doc.spans[0].token_ids, vec!["w-1", "w-3"]);
    assert_eq!(doc.tokens[0].attrs["relation_target"], "w-3");
}
#[test]
fn custom_language_and_explicit_override_survive_default_change() {
    let (_tmp, mut s) = fixture();
    let c = command(
        &s,
        "define",
        vec![
            Operation::DefineLanguage {
                value: "local-mixed".into(),
                description: "synthetic judgment".into(),
            },
            Operation::DefineLanguage {
                value: "xh".into(),
                description: "isiXhosa".into(),
            },
            Operation::SetLanguageDefault {
                value: Some("xh".into()),
            },
            Operation::SetToken {
                document: "xmlfiles/demo.xml".into(),
                token: "w-1".into(),
                fields: BTreeMap::from([("variety".into(), "local-mixed".into())]),
            },
        ],
    );
    s.apply("local-owner", &c, Fault::None).unwrap();
    let doc = &s.view("pilot", None).unwrap().documents[0];
    assert_eq!(doc.tokens[0].language_source, "token/variety");
    assert_eq!(
        doc.tokens[0].language_effective.as_deref(),
        Some("local-mixed")
    );
    assert_eq!(doc.tokens[1].language_source, "project/default");
}
#[test]
fn independent_normalized_and_corrected_layers() {
    let (_tmp, mut s) = fixture();
    let c = command(
        &s,
        "layers",
        vec![Operation::SetToken {
            document: "xmlfiles/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([
                ("nform".into(), "authentic".into()),
                ("wb_normalized".into(), "standard".into()),
            ]),
        }],
    );
    s.apply("local-owner", &c, Fault::None).unwrap();
    let t = &s.view("pilot", None).unwrap().documents[0].tokens[0];
    assert_eq!(t.corrected.as_deref(), Some("authentic"));
    assert_eq!(t.normalized.as_deref(), Some("standard"));
    assert_eq!(t.original, "é😀&x");
}
#[test]
fn raw_asr_cannot_be_overwritten_by_edit() {
    let (_tmp, mut s) = fixture();
    let before = s.snapshot(&s.head("pilot").unwrap()).unwrap().files["Raw/asr.raw.json"].clone();
    let c = edit(&s, "a", "A");
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(
        before,
        s.snapshot(&s.head("pilot").unwrap()).unwrap().files["Raw/asr.raw.json"]
    );
    let c = command(
        &s,
        "bad",
        vec![Operation::SetToken {
            document: "xmlfiles/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("form".into(), "bad".into())]),
        }],
    );
    assert!(s.apply("local-owner", &c, Fault::None).is_err());
}
#[test]
fn duplicate_ids_and_dangling_references_rejected() {
    for text in [
        XML.replace("id=\"w-2\"", "id=\"w-1\""),
        XML.replace(
            "form=\"ngiyabona\"",
            "relation_target=\"missing\" form=\"ngiyabona\"",
        ),
    ] {
        assert!(xml::project_document("p", "d", &text, &Config::default()).is_err());
    }
}
#[test]
fn xxe_dtd_malformed_and_deep_inputs_rejected() {
    assert!(xml::parse("<!DOCTYPE a [<!ENTITY x SYSTEM 'file:///secret'>]><a>&x;</a>").is_err());
    assert!(xml::parse("<a><b></a>").is_err());
    let deep = format!("{}{}", "<a>".repeat(140), "</a>".repeat(140));
    assert!(xml::parse(&deep).is_err());
}
#[test]
fn malicious_paths_rejected() {
    for p in [
        "../a", "/a", "C:/a", "x\\y", "CON.xml", "x:ads", "a/../b", "a./b",
    ] {
        assert!(package::safe_relative(p).is_err(), "{p}");
    }
}
#[test]
fn layer_cycles_and_impossible_containment_rejected() {
    let mut config = Config::default();
    config.layers[0].parent = Some("language".into());
    assert!(xml::validate_layers(&config).is_err());
    let text = XML.replace("id='w-1'", "id='w-1' start='3' end='5'");
    assert!(xml::project_document("p", "d", &text, &Config::default()).is_err());
}
#[test]
fn nested_token_edits_blocked_without_flattening() {
    let (_tmp, s) = fixture();
    let snap = s.snapshot(&s.head("pilot").unwrap()).unwrap();
    let text = s
        .objects
        .text(&snap, "xmlfiles/demo.xml")
        .unwrap()
        .replace("é😀&amp;x</tok>", "<dtok id='dt-1'>nested</dtok></tok>");
    let d = xml::project_document("p", "d", &text, &Config::default()).unwrap();
    assert!(!d.tokens[0].editable);
    let mut snapshot = snap;
    package::replace(&s.objects, &mut snapshot, "xmlfiles/demo.xml", &text).unwrap();
    assert!(package::token_fields(
        &s.objects,
        &mut snapshot,
        "xmlfiles/demo.xml",
        "w-1",
        &BTreeMap::from([("nform".into(), "x".into())])
    )
    .is_err());
}
#[test]
fn backup_api_and_clean_restore_preserve_head_and_approval() {
    let (tmp, mut s) = fixture();
    let c = edit(&s, "a", "A");
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    s.review(
        "local-owner",
        "pilot",
        r.id,
        &r.snapshot_hash,
        "approved",
        "self-review",
    )
    .unwrap();
    let target = tmp.path().join("restored");
    s.backup(&target).unwrap();
    let restored = Store::open(&target).unwrap();
    assert_eq!(
        restored.head("pilot").unwrap().snapshot_hash,
        r.snapshot_hash
    );
    assert!(restored.view("pilot", None).unwrap().approved);
}
#[test]
fn committed_object_corruption_detected_on_restart() {
    let (tmp, s) = fixture();
    let hash = s.head("pilot").unwrap().snapshot_hash;
    fs::write(s.objects.root.join(hash), b"corruption").unwrap();
    drop(s);
    assert!(Store::open(&tmp.path().join("authority")).is_err());
}
#[test]
fn incomplete_media_package_blocks_complete_export() {
    let (tmp, s) = fixture();
    let mut snap = s.snapshot(&s.head("pilot").unwrap()).unwrap();
    snap.files.remove("Audio/synthetic.wav");
    assert!(package::validate(&s.objects, &snap)
        .unwrap()
        .iter()
        .any(|i| i.blocking));
    assert!(package::export_directory(
        &s.objects,
        &snap,
        &tmp.path().join("out"),
        &serde_json::json!({})
    )
    .is_err());
}
#[test]
fn cross_project_and_actor_access_rejected() {
    let (_tmp, mut s) = fixture();
    let c = edit(&s, "a", "A");
    assert!(s.apply("other", &c, Fault::None).is_err());
    assert!(s.revision("other", c.base_revision).is_err());
}
#[test]
fn future_database_schema_refused() {
    let (tmp, s) = fixture();
    s.conn.execute_batch("PRAGMA user_version=999").unwrap();
    drop(s);
    assert!(Store::open(&tmp.path().join("authority")).is_err());
}
#[test]
fn current_approved_compiler_contract_only_and_no_ingestion_claim() {
    let (_tmp, mut s) = fixture();
    let r = s.head("pilot").unwrap();
    assert!(s.approved_contract("pilot", r.id).is_err());
    s.review(
        "local-owner",
        "pilot",
        r.id,
        &r.snapshot_hash,
        "approved",
        "",
    )
    .unwrap();
    assert_eq!(
        s.approved_contract("pilot", r.id).unwrap()["ingestion_status"],
        "not tested; no Semantica dispatch performed by this contract endpoint"
    );
    let c = edit(&s, "a", "A");
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(s.approved_contract("pilot", r.id).is_err());
}
#[test]
fn nonexistent_directory_import_rejected() {
    let tmp = TempDir::new().unwrap();
    let objects = Objects::new(&tmp.path().join("objects")).unwrap();
    assert!(package::import(&objects, Path::new("nonexistent"), "p").is_err());
}

#[test]
fn correction_invalidates_retained_normalization_until_explicitly_confirmed() {
    let (_tmp, mut s) = fixture();
    let c = command(
        &s,
        "normalized",
        vec![Operation::SetToken {
            document: "xmlfiles/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("wb_normalized".into(), "standard".into())]),
        }],
    );
    s.apply("local-owner", &c, Fault::None).unwrap();
    let c = edit(&s, "correct-again", "authentic");
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(s
        .view("pilot", None)
        .unwrap()
        .issues
        .iter()
        .any(|i| i.code == "unresolved-normalized-reading" && i.blocking));
    let c = command(
        &s,
        "confirm-normalized",
        vec![Operation::SetToken {
            document: "xmlfiles/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("wb_normalized".into(), "standard".into())]),
        }],
    );
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(!s
        .view("pilot", None)
        .unwrap()
        .issues
        .iter()
        .any(|i| i.code == "unresolved-normalized-reading"));
}
#[test]
fn stale_cwb_index_cannot_be_shipped_as_current_compatibility_data() {
    let (tmp, s) = fixture();
    let mut snapshot = s.snapshot(&s.head("pilot").unwrap()).unwrap();
    snapshot.files.insert(
        "cwb/old-index".into(),
        s.objects.put(b"old-byte-offsets", "derived-index").unwrap(),
    );
    snapshot.index_status = "stale".into();
    assert!(package::export_directory(
        &s.objects,
        &snapshot,
        &tmp.path().join("out"),
        &serde_json::json!({})
    )
    .unwrap_err()
    .to_string()
    .contains("stale CWB"));
}
