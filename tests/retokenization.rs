//! Synthetic contracts for a closed structural dialect, not arbitrary TEITOK.
use corpus_workbench::{
    handoff::digest,
    model::*,
    retokenize::*,
    store::{Fault, Store},
};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;
const DOC: &str = "xmlfiles/demo.xml";
const SIDE: &str = "Annotations/review_demo.xml";
const XML: &str = "<?xml version='1.0'?>\n<TEI><text><u id='u1' start='0' end='5'><tok id='w1' form='é🙂x' nform='a🙂bc' wb_normalized='A🙂BC' variety='local'>é🙂x</tok> <tok id='w2' form='two' relation_target='#w1' relation_type='context' note='keep &amp; note'>two</tok><tok id='w3' form='three'>three</tok></u></text></TEI>\n";
const SPANS: &str = "<spanGrp><span id='s1' corresp='#w1   #w3' label='ordered discontinuous'/><span id='s2' corresp='#w1' label='character' wb_start='1' wb_end='2' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_quote='🙂' wb_status='resolved'/></spanGrp>";
fn fixture(doc: &str, spans: &str, extra: &[(&str, &[u8])]) -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    for (path, bytes) in [
        (DOC, doc.as_bytes()),
        (SIDE, spans.as_bytes()),
        ("Resources/settings.xml", b"<ttsettings/>".as_slice()),
    ]
    .into_iter()
    .chain(extra.iter().copied())
    {
        let file = input.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, bytes).unwrap();
    }
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    s.import(&input, "p").unwrap();
    (tmp, s)
}
fn reading(id: &str, original: &str, corrected: Option<&str>, normalized: Option<&str>) -> Reading {
    Reading {
        id: id.into(),
        original: original.into(),
        corrected: corrected.map(str::to_string),
        normalized: normalized.map(str::to_string),
    }
}
fn request(
    s: &Store,
    ids: &[&str],
    replacement: Vec<Reading>,
    endpoint: Option<&str>,
) -> RetokenizeRequest {
    let inv = s.reference_inventory("p", s.head("p").unwrap().id).unwrap();
    RetokenizeRequest {
        schema: 1,
        project: "p".into(),
        revision: inv.revision,
        snapshot_hash: inv.snapshot_hash.clone(),
        config_hash: inv.config_hash.clone(),
        inventory_hash: digest(&inv).unwrap(),
        document: DOC.into(),
        targets: ids
            .iter()
            .map(|id| {
                inv.ids
                    .iter()
                    .find(|t| t.artifact == DOC && t.id == *id)
                    .unwrap()
                    .clone()
            })
            .collect(),
        replacement,
        relation_endpoint: endpoint.map(str::to_string),
    }
}
fn split(s: &Store) -> RetokenizeRequest {
    request(
        s,
        &["w1"],
        vec![
            reading("part-a", "é🙂", Some("a🙂"), Some("A🙂")),
            reading("part-b", "x", Some("bc"), Some("BC")),
        ],
        Some("part-b"),
    )
}
fn command(s: &Store, id: &str, r: RetokenizeRequest) -> Command {
    let p = s.retokenization_preview(&r).unwrap();
    let v = s.view("p", None).unwrap();
    Command {
        schema: 1,
        project: "p".into(),
        command_id: id.into(),
        base_revision: v.revision.id,
        preimage_hash: v.revision.snapshot_hash,
        config_version: v.snapshot.config.version,
        label: id.into(),
        operations: vec![Operation::Retokenize {
            request: r,
            preview_hash: digest(&p).unwrap(),
        }],
    }
}
fn text(s: &Store, path: &str) -> String {
    s.objects
        .text(&s.view("p", None).unwrap().snapshot, path)
        .unwrap()
}
#[test]
fn preview_is_read_only_and_split_repairs_unicode_span_and_explicit_endpoint() {
    let (_tmp, mut s) = fixture(XML, SPANS, &[]);
    let r = split(&s);
    let files = fs::read_dir(s.objects.root.clone()).unwrap().count();
    let p = s.retokenization_preview(&r).unwrap();
    assert!(p.execution_enabled, "{:?}", p.blockers);
    assert_eq!(s.history("p").unwrap().len(), 1);
    assert_eq!(fs::read_dir(s.objects.root.clone()).unwrap().count(), files);
    let c = command(&s, "split", r);
    let rev = s.apply("local-owner", &c, Fault::None).unwrap();
    let v = s.view("p", None).unwrap();
    assert_eq!(rev.snapshot_hash, p.candidate_snapshot_hash.unwrap());
    assert_eq!(v.documents[0].tokens[0].id, "part-a");
    assert_eq!(v.documents[0].tokens[0].start_us, None);
    assert_eq!(v.documents[0].tokens[0].corrected.as_deref(), Some("a🙂"));
    assert_eq!(
        v.documents[0].spans[0].token_ids,
        vec!["part-a", "part-b", "w3"]
    );
    assert_eq!(v.documents[0].spans[1].token_ids, vec!["part-a"]);
    assert_eq!(v.documents[0].spans[1].fields["wb_start"], "1");
    assert!(text(&s, DOC).contains("relation_target='#part-b'"));
    assert!(text(&s, DOC).contains("note='keep &amp; note'"));
    assert!(text(&s, SIDE).contains("#part-a #part-b   #w3"));
    assert!(v
        .snapshot
        .files
        .keys()
        .any(|p| p.starts_with("Resources/retokenization/")));
    assert_eq!(s.apply("local-owner", &c, Fault::None).unwrap().id, rev.id);
}
#[test]
fn merge_after_split_preserves_layers_character_quote_and_ordered_coverage() {
    let (_tmp, mut s) = fixture(XML, SPANS, &[]);
    let c = command(&s, "split", split(&s));
    s.apply("local-owner", &c, Fault::None).unwrap();
    let r = request(
        &s,
        &["part-a", "part-b"],
        vec![reading("merged", "é🙂x", Some("a🙂bc"), Some("A🙂BC"))],
        None,
    );
    let p = s.retokenization_preview(&r).unwrap();
    assert!(p.execution_enabled, "{:?}", p.blockers);
    let c = command(&s, "merge", r);
    s.apply("local-owner", &c, Fault::None).unwrap();
    let v = s.view("p", None).unwrap();
    assert_eq!(v.documents[0].tokens[0].id, "merged");
    assert_eq!(v.documents[0].spans[0].token_ids, vec!["merged", "w3"]);
    assert_eq!(v.documents[0].spans[1].fields["wb_quote"], "🙂");
    assert!(text(&s, DOC).contains("relation_target='#merged'"));
}
#[test]
fn every_unknown_artifact_or_carrier_blocks_without_discarding_bytes() {
    for (path, bytes) in [
        ("Other/opaque.bin", b"opaque".as_slice()),
        ("Raw/asr.json", b"{\"text\":\"original machine draft\"}"),
        ("Audio/example.wav", b"RIFFnot-a-proven-decoder"),
        ("Other/unknown.xml", b"<links target='#w1'/>"),
        ("Resources/schema.xsd", b"<schema/>"),
        ("CWB/offsets", b"offsets"),
    ] {
        let (_tmp, mut s) = fixture(XML, SPANS, &[(path, bytes)]);
        let r = split(&s);
        let p = s.retokenization_preview(&r).unwrap();
        assert!(!p.execution_enabled, "{path}");
        assert!(p.blockers.iter().any(|v| v.contains(path)));
        let c = command(&s, "blocked", r);
        assert!(s.apply("local-owner", &c, Fault::None).is_err());
        assert_eq!(
            s.objects
                .read(&s.view("p", None).unwrap().snapshot.files[path])
                .unwrap(),
            bytes
        );
        assert_eq!(s.history("p").unwrap().len(), 1);
    }
    for modified in [
        XML.replace("<TEI>", "<TEI unknown='custom'>"),
        XML.replace("<TEI>", "<TEI xmlns:x='urn:custom'>"),
        XML.replace(
            "<text>",
            "<text><!-- #w1 -- >".replace("-- >", "-->").as_str(),
        ),
        XML.replace("<text>", "<text><?custom token='w1'?>"),
        XML.replace("é🙂x</tok>", "<![CDATA[é🙂x]]></tok>"),
        XML.replace("é🙂x</tok>", "é<hi>🙂</hi>x</tok>"),
        XML.replace("<ttsettings/>", "<ttsettings xpath='//tok'/>"),
        XML.replace("variety='local'", "variety='local' custom='unrelated'"),
        XML.replace("<text>", "<text xml:base='elsewhere/'>"),
    ] {
        if modified == XML {
            continue;
        }
        let (_tmp, s) = fixture(&modified, SPANS, &[]);
        let p = s.retokenization_preview(&split(&s)).unwrap();
        assert!(!p.execution_enabled, "{modified}");
        assert_eq!(text(&s, DOC), modified);
    }
}
#[test]
fn stale_or_forged_inventory_or_preview_or_qualified_target_is_rejected() {
    let (_tmp, mut s) = fixture(XML, SPANS, &[]);
    let r = split(&s);
    let mut bad = r.clone();
    bad.inventory_hash = "0".repeat(64);
    assert!(s.retokenization_preview(&bad).is_err());
    let mut bad = r.clone();
    bad.targets[0].element_start += 1;
    assert!(s.retokenization_preview(&bad).is_err());
    let mut c = command(&s, "bad", r.clone());
    if let Operation::Retokenize { preview_hash, .. } = &mut c.operations[0] {
        *preview_hash = "0".repeat(64)
    }
    assert!(s.apply("local-owner", &c, Fault::None).is_err());
    let c = command(&s, "split", r.clone());
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(s.retokenization_preview(&r).is_err());
    assert_eq!(s.history("p").unwrap().len(), 2);
}
#[test]
fn loss_of_any_text_layer_or_missing_endpoint_choice_blocks() {
    let (_tmp, s) = fixture(XML, SPANS, &[]);
    let r = split(&s);
    for change in 0..6 {
        let mut bad = r.clone();
        match change {
            0 => bad.replacement[0].original = "lost".into(),
            1 => bad.replacement[0].corrected = None,
            2 => bad.replacement[1].normalized = None,
            3 => bad.relation_endpoint = None,
            4 => bad.relation_endpoint = Some("w2".into()),
            _ => bad.replacement[0].id = "w2".into(),
        };
        let p = s.retokenization_preview(&bad).unwrap();
        assert!(!p.execution_enabled, "change {change}");
    }
}
#[test]
fn selected_word_timing_outgoing_judgments_and_cross_boundary_character_ranges_block() {
    for modified in [
        XML.replace("id='w1'", "id='w1' start='0' end='1'"),
        XML.replace(
            "id='w1'",
            "id='w1' relation_target='#w3' relation_type='context'",
        ),
        XML.replace("id='w1'", "id='w1' note='authored note'"),
    ] {
        let (_tmp, s) = fixture(&modified, SPANS, &[]);
        assert!(
            !s.retokenization_preview(&split(&s))
                .unwrap()
                .execution_enabled
        );
    }
    let spans = SPANS
        .replace("wb_end='2'", "wb_end='3'")
        .replace("wb_quote='🙂'", "wb_quote='🙂b'");
    let (_tmp, s) = fixture(XML, &spans, &[]);
    assert!(
        !s.retokenization_preview(&split(&s))
            .unwrap()
            .execution_enabled
    );
}
#[test]
fn merge_partial_token_span_different_variety_and_nonadjacent_selection_block() {
    let plain="<TEI><text><tok id='w1' form='one'>one</tok> <tok id='w2' form='two'>two</tok><tok id='w3' form='three'>three</tok></text></TEI>";
    let (_tmp, s) = fixture(
        plain,
        "<spanGrp><span id='s' corresp='#w1'/></spanGrp>",
        &[],
    );
    let r = request(
        &s,
        &["w1", "w2"],
        vec![reading("merged", "one two", None, None)],
        None,
    );
    assert!(!s.retokenization_preview(&r).unwrap().execution_enabled);
    let (_tmp, s) = fixture(
        &plain.replace("id='w1'", "id='w1' variety='one'"),
        "<spanGrp/>",
        &[],
    );
    let r = request(
        &s,
        &["w1", "w2"],
        vec![reading("merged", "one two", None, None)],
        None,
    );
    assert!(!s.retokenization_preview(&r).unwrap().execution_enabled);
    let (_tmp, s) = fixture(plain, "<spanGrp/>", &[]);
    let r = request(
        &s,
        &["w1", "w3"],
        vec![reading("merged", "onethree", None, None)],
        None,
    );
    assert!(!s.retokenization_preview(&r).unwrap().execution_enabled);
}
#[test]
fn merge_keeps_only_proven_literal_separator_and_moves_character_coordinate() {
    let doc="<TEI><text><tok id='w1' form='ab'>ab</tok>  <tok id='w2' form='🙂x'>🙂x</tok></text></TEI>";
    let side="<spanGrp><span id='s' corresp='#w2' wb_start='0' wb_end='1' wb_quote='🙂' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_status='resolved'/></spanGrp>";
    let (_tmp, mut s) = fixture(doc, side, &[]);
    let r = request(
        &s,
        &["w1", "w2"],
        vec![reading("merged", "ab  🙂x", None, None)],
        None,
    );
    let c = command(&s, "merge", r);
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(
        s.view("p", None).unwrap().documents[0].spans[0].fields["wb_start"],
        "4"
    );
    assert!(text(&s, DOC).contains(">ab  🙂x</tok>"));
}
#[test]
fn historical_ids_approval_and_complete_export_reimport_remain_distinct() {
    let (tmp, mut s) = fixture(XML, SPANS, &[]);
    let before = s.head("p").unwrap();
    s.review(
        "local-owner",
        "p",
        before.id,
        &before.snapshot_hash,
        "approved",
        "Synthetic review",
    )
    .unwrap();
    let old = s
        .approved_contract_for_mapping("p", before.id, "corpus-evidence/2")
        .unwrap();
    let c = command(&s, "split", split(&s));
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(!s.view("p", None).unwrap().approved);
    assert!(s.approved_contract("p", s.head("p").unwrap().id).is_err());
    assert_eq!(
        s.view("p", Some(before.id)).unwrap().documents[0].tokens[0].id,
        "w1"
    );
    assert_eq!(old["documents"][0]["tokens"][0]["id"], "w1");
    let r = request(
        &s,
        &["part-a", "part-b"],
        vec![reading("w1", "é🙂x", Some("a🙂bc"), Some("A🙂BC"))],
        None,
    );
    assert!(
        !s.retokenization_preview(&r).unwrap().execution_enabled,
        "retired compiler identities cannot be reused"
    );
    let out = tmp.path().join("export");
    s.export("p", s.head("p").unwrap().id, &out).unwrap();
    let mut other = Store::open(&tmp.path().join("reimport")).unwrap();
    other.import(&out, "copy").unwrap();
    let reopened = other.view("copy", None).unwrap();
    assert_eq!(reopened.documents[0].tokens[0].original, "é🙂");
    assert_eq!(
        reopened.documents[0].spans[0].token_ids,
        vec!["part-a", "part-b", "w3"]
    );
    assert_eq!(reopened.documents[0].spans[1].fields["wb_quote"], "🙂");
    for (path, artifact) in &s.view("p", None).unwrap().snapshot.files {
        assert_eq!(reopened.snapshot.files[path], *artifact);
    }
    let backup = tmp.path().join("backup");
    s.backup(&backup).unwrap();
    let reopened = Store::open(&backup).unwrap();
    assert_eq!(reopened.history("p").unwrap().len(), 2);
    assert_eq!(text(&reopened, DOC), text(&s, DOC));
}
#[test]
fn atomic_crash_boundaries_and_idempotency_bind_structural_payload() {
    for fault in [Fault::AfterStage, Fault::BeforeCommit, Fault::AfterCommit] {
        let (tmp, mut s) = fixture(XML, SPANS, &[]);
        let c = command(&s, "split", split(&s));
        assert!(s.apply("local-owner", &c, fault).is_err());
        drop(s);
        let mut s = Store::open(&tmp.path().join("authority")).unwrap();
        assert_eq!(
            s.history("p").unwrap().len(),
            if fault == Fault::AfterCommit { 2 } else { 1 }
        );
        let r = s.apply("local-owner", &c, Fault::None).unwrap();
        assert_eq!(s.head("p").unwrap().id, r.id);
        assert_eq!(s.history("p").unwrap().len(), 2);
        let mut forged = c.clone();
        forged.label = "different".into();
        assert!(s.apply("local-owner", &forged, Fault::None).is_err());
    }
}
#[test]
fn structural_edit_cannot_be_batched_with_an_unproved_change() {
    let (_tmp, mut s) = fixture(XML, SPANS, &[]);
    let mut c = command(&s, "split", split(&s));
    c.operations.push(Operation::SetToken {
        document: DOC.into(),
        token: "w2".into(),
        fields: BTreeMap::from([("nform".into(), "different".into())]),
    });
    assert!(s.apply("local-owner", &c, Fault::None).is_err());
    assert_eq!(s.history("p").unwrap().len(), 1);
}
#[test]
fn restore_and_reimport_keep_retired_id_reservations_and_allow_fresh_operations() {
    let (tmp, mut s) = fixture(XML, SPANS, &[]);
    let c = command(&s, "split", split(&s));
    s.apply("local-owner", &c, Fault::None).unwrap();
    let v = s.view("p", None).unwrap();
    let restore = Command {
        schema: 1,
        project: "p".into(),
        command_id: "restore".into(),
        base_revision: v.revision.id,
        preimage_hash: v.revision.snapshot_hash,
        config_version: v.snapshot.config.version,
        label: "Restore source".into(),
        operations: vec![Operation::Restore { revision: 1 }],
    };
    s.apply("local-owner", &restore, Fault::None).unwrap();
    assert!(
        !s.retokenization_preview(&split(&s))
            .unwrap()
            .execution_enabled
    );
    let out = tmp.path().join("restored-export");
    s.export("p", s.head("p").unwrap().id, &out).unwrap();
    let mut other = Store::open(&tmp.path().join("reimported")).unwrap();
    other.import(&out, "p").unwrap();
    assert!(
        !other
            .retokenization_preview(&split(&other))
            .unwrap()
            .execution_enabled,
        "retired successors stay reserved across restored export"
    );
    let mut fresh = split(&other);
    fresh.replacement[0].id = "new-a".into();
    fresh.replacement[1].id = "new-b".into();
    fresh.relation_endpoint = Some("new-b".into());
    let proof = other.retokenization_preview(&fresh).unwrap();
    assert!(proof.execution_enabled, "{:?}", proof.blockers);
    assert!(proof
        .artifact_rules
        .values()
        .any(|v| v.contains("immutable export history")));
    let c = command(&other, "fresh", fresh);
    other.apply("local-owner", &c, Fault::None).unwrap();
    let twice = tmp.path().join("twice-export");
    other
        .export("p", other.head("p").unwrap().id, &twice)
        .unwrap();
    let mut third = Store::open(&tmp.path().join("twice-reimported")).unwrap();
    third.import(&twice, "p").unwrap();
    let r = request(
        &third,
        &["new-a", "new-b"],
        vec![reading("last", "é🙂x", Some("a🙂bc"), Some("A🙂BC"))],
        None,
    );
    let proof = third.retokenization_preview(&r).unwrap();
    assert!(proof.execution_enabled, "{:?}", proof.blockers);
    let c = command(&third, "merge", r);
    third.apply("local-owner", &c, Fault::None).unwrap();
}
#[test]
fn unrecognized_files_inside_managed_namespace_and_forged_lineage_block() {
    let (tmp, s) = fixture(XML, SPANS, &[]);
    let out = tmp.path().join("export");
    s.export("p", 1, &out).unwrap();
    let ns = fs::read_dir(out.join("Workbench/exports"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(ns.join("unknown.bin"), b"opaque #w1").unwrap();
    let mut other = Store::open(&tmp.path().join("copy")).unwrap();
    other.import(&out, "p").unwrap();
    let proof = other.retokenization_preview(&split(&other)).unwrap();
    assert!(!proof.execution_enabled);
    assert!(proof
        .blockers
        .iter()
        .any(|v| v.contains("undeclared managed namespace")));
    let bytes = b"{\"schema\":1,\"unrecognized\":\"#w1\"}";
    let name = format!(
        "Resources/retokenization/{}.json",
        corpus_workbench::package::hash(bytes)
    );
    let (_tmp, s) = fixture(XML, SPANS, &[(&name, bytes)]);
    assert!(
        !s.retokenization_preview(&split(&s))
            .unwrap()
            .execution_enabled
    );
}
#[test]
fn structural_diff_reports_additions_retirements_and_qualified_span_repairs() {
    let (_tmp, mut s) = fixture(XML, SPANS, &[]);
    let c = command(&s, "split", split(&s));
    let r = s.apply("local-owner", &c, Fault::None).unwrap();
    let diff = s.diff("p", 1, r.id).unwrap();
    let changes = diff["changes"].as_array().unwrap();
    assert_eq!(
        changes
            .iter()
            .filter(|v| v["field"] == "token-added")
            .count(),
        2
    );
    assert_eq!(
        changes
            .iter()
            .filter(|v| v["field"] == "token-retired")
            .count(),
        1
    );
    assert!(changes
        .iter()
        .any(|v| v["sidecar"] == SIDE && v["target"] == "s1"));
    assert!(changes
        .iter()
        .any(|v| v["field"] == "retokenization-lineage"
            && v["after"].as_str().unwrap().contains("part-a")));
}
#[test]
fn literal_id_like_readings_and_entities_are_not_reference_candidates_for_rewrite() {
    let doc="<TEI><text><tok id='w1' form='ab&amp;x'>ab&amp;x</tok><tok id='w2' form='#w1' note='literal &amp; preserved'>#w1</tok></text></TEI>";
    let (_tmp, mut s) = fixture(doc, "<spanGrp/>", &[]);
    let r = request(
        &s,
        &["w1"],
        vec![
            reading("a", "ab", None, None),
            reading("b", "&x", None, None),
        ],
        None,
    );
    let c = command(&s, "split", r);
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(
        text(&s, DOC).contains("<tok id='w2' form='#w1' note='literal &amp; preserved'>#w1</tok>")
    );
    assert_eq!(
        s.view("p", None).unwrap().documents[0].tokens[1].original,
        "&x"
    );
}
#[test]
fn absent_layers_mixed_presence_body_divergence_and_reference_order_are_falsified() {
    let doc="<TEI><text><tok id='w1' form='one'>one</tok><tok id='w2' form='two' nform='TWO'>two</tok></text></TEI>";
    let (_tmp, s) = fixture(doc, "<spanGrp/>", &[]);
    let r = request(
        &s,
        &["w1", "w2"],
        vec![reading("new", "onetwo", None, None)],
        None,
    );
    assert!(!s.retokenization_preview(&r).unwrap().execution_enabled);
    let (_tmp, s) = fixture(&XML.replace(">é🙂x</tok>", ">different</tok>"), SPANS, &[]);
    assert!(
        !s.retokenization_preview(&split(&s))
            .unwrap()
            .execution_enabled
    );
    let plain = doc.replace(" nform='TWO'", "");
    for refs in ["#w2 #w1", "#w1 #w2 #w1"] {
        let side = format!("<spanGrp><span id='s' corresp='{refs}'/></spanGrp>");
        let (_tmp, s) = fixture(&plain, &side, &[]);
        let r = request(
            &s,
            &["w1", "w2"],
            vec![reading("new", "onetwo", None, None)],
            None,
        );
        assert!(!s.retokenization_preview(&r).unwrap().execution_enabled);
    }
    let (_tmp, s) = fixture(
        XML,
        SPANS,
        &[(
            "Resources/settings.xml",
            b"<ttsettings xpath='//tok[@id]'/>",
        )],
    );
    assert!(
        !s.retokenization_preview(&split(&s))
            .unwrap()
            .execution_enabled
    );
}
fn hard_structural_crash(point: &str, committed: bool) {
    let (tmp, s) = fixture(XML, SPANS, &[]);
    let c = command(&s, "process-retry", split(&s));
    let file = tmp.path().join("command.json");
    fs::write(&file, serde_json::to_vec(&c).unwrap()).unwrap();
    drop(s);
    let outcome = std::process::Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["apply", "--fault", point, "--command"])
        .arg(&file)
        .arg("--store")
        .arg(tmp.path().join("authority"))
        .env("WORKBENCH_TEST_HARD_CRASH", "yes")
        .output()
        .unwrap();
    assert_eq!(outcome.status.code(), Some(73));
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    assert_eq!(s.history("p").unwrap().len(), if committed { 2 } else { 1 });
    let rev = s.apply("local-owner", &c, Fault::None).unwrap();
    assert_eq!(s.head("p").unwrap().id, rev.id);
    assert_eq!(s.history("p").unwrap().len(), 2);
    assert_eq!(
        s.view("p", None).unwrap().documents[0].spans[0].token_ids,
        vec!["part-a", "part-b", "w3"]
    );
}
#[test]
fn structural_process_exit_after_stage_has_no_partial_revision() {
    hard_structural_crash("after-stage", false)
}
#[test]
fn structural_process_exit_before_commit_rolls_back_all_artifacts() {
    hard_structural_crash("before-commit", false)
}
#[test]
fn structural_process_exit_after_commit_recovers_and_reuses_bound_retry() {
    hard_structural_crash("after-commit", true)
}
#[test]
fn plain_package_copy_reserves_retired_ids_from_immutable_successor_records() {
    let (tmp, mut s) = fixture(XML, SPANS, &[]);
    let c = command(&s, "split", split(&s));
    s.apply("local-owner", &c, Fault::None).unwrap();
    let v = s.view("p", None).unwrap();
    let copy = tmp.path().join("plain-copy");
    for (path, a) in &v.snapshot.files {
        let file = copy.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, s.objects.read(a).unwrap()).unwrap();
    }
    let mut imported = Store::open(&tmp.path().join("imported-plain")).unwrap();
    imported.import(&copy, "p").unwrap();
    let r = request(
        &imported,
        &["part-a", "part-b"],
        vec![reading("w1", "é🙂x", Some("a🙂bc"), Some("A🙂BC"))],
        None,
    );
    let proof = imported.retokenization_preview(&r).unwrap();
    assert!(!proof.execution_enabled);
    assert!(proof
        .blockers
        .iter()
        .any(|v| v.contains("historical evidence")));
    let r = request(
        &imported,
        &["part-a", "part-b"],
        vec![reading("fresh", "é🙂x", Some("a🙂bc"), Some("A🙂BC"))],
        None,
    );
    assert!(
        imported
            .retokenization_preview(&r)
            .unwrap()
            .execution_enabled
    );
}
#[test]
fn omitting_a_retired_revision_cannot_erase_identity_claims_on_reimport() {
    let (tmp, mut s) = fixture(XML, SPANS, &[]);
    let c = command(&s, "split", split(&s));
    s.apply("local-owner", &c, Fault::None).unwrap();
    let v = s.view("p", None).unwrap();
    let c = Command {
        schema: 1,
        project: "p".into(),
        command_id: "restore".into(),
        base_revision: v.revision.id,
        preimage_hash: v.revision.snapshot_hash,
        config_version: v.snapshot.config.version,
        label: "Restored".into(),
        operations: vec![Operation::Restore { revision: 1 }],
    };
    s.apply("local-owner", &c, Fault::None).unwrap();
    let out = tmp.path().join("forged-export");
    s.export("p", 3, &out).unwrap();
    let namespace = fs::read_dir(out.join("Workbench/exports"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let path = namespace.join("export-receipt.json");
    let mut receipt: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    receipt["history"]
        .as_array_mut()
        .unwrap()
        .retain(|r| r["id"] != 2);
    fs::write(&path, serde_json::to_vec(&receipt).unwrap()).unwrap();
    let mut imported = Store::open(&tmp.path().join("forged-import")).unwrap();
    let err = imported.import(&out, "p").unwrap_err().to_string();
    assert!(err.contains("missing managed history parent"), "{err}");
    assert!(!imported.project_exists("p").unwrap());
}

#[test]
fn overlapping_retries_recheck_exact_binding_after_lookup_or_proof_races() {
    use rusqlite::ffi;
    use std::{
        ffi::{c_void, CStr},
        sync::mpsc,
        thread,
        time::Duration,
    };
    struct Gate {
        prefix: &'static str,
        fired: bool,
        resumed: bool,
        start: mpsc::Sender<()>,
        resume: mpsc::Receiver<()>,
    }
    unsafe extern "C" fn trace(
        kind: u32,
        context: *mut c_void,
        statement: *mut c_void,
        _time: *mut c_void,
    ) -> i32 {
        if kind == ffi::SQLITE_TRACE_PROFILE as u32 {
            // SQLite invokes this synchronously with the registered live Box and statement.
            let gate = unsafe { &mut *(context as *mut Gate) };
            let sql =
                unsafe { CStr::from_ptr(ffi::sqlite3_sql(statement as *mut ffi::sqlite3_stmt)) }
                    .to_string_lossy();
            if !gate.fired && sql.starts_with(gate.prefix) {
                gate.fired = true;
                if gate.start.send(()).is_ok() {
                    gate.resumed = gate.resume.recv_timeout(Duration::from_secs(15)).is_ok();
                }
            }
        }
        0
    }
    for prefix in [
        "SELECT request_hash,revision FROM commands",
        "SELECT head FROM projects",
    ] {
        for different_payload in [false, true] {
            let (tmp, mut first) = fixture(XML, SPANS, &[]);
            let original = command(&first, "overlapping-retry", split(&first));
            let mut competing = original.clone();
            if different_payload {
                competing.label.push_str(" different payload");
            }
            let root = tmp.path().join("authority");
            let (start_tx, start_rx) = mpsc::channel();
            let (resume_tx, resume_rx) = mpsc::channel();
            let worker = thread::spawn(move || {
                start_rx.recv_timeout(Duration::from_secs(15)).unwrap();
                let mut second = Store::open(&root).unwrap();
                let result = second.apply("local-owner", &competing, Fault::None);
                resume_tx.send(()).unwrap();
                result
            });
            let mut gate = Box::new(Gate {
                prefix,
                fired: false,
                resumed: false,
                start: start_tx,
                resume: resume_rx,
            });
            // The observer and its Box remain alive on this thread until explicitly unregistered.
            unsafe {
                assert_eq!(
                    ffi::sqlite3_trace_v2(
                        first.conn.handle(),
                        ffi::SQLITE_TRACE_PROFILE as u32,
                        Some(trace),
                        (&mut *gate as *mut Gate).cast()
                    ),
                    ffi::SQLITE_OK
                );
            }
            let first_result = first.apply("local-owner", &original, Fault::None);
            unsafe {
                ffi::sqlite3_trace_v2(first.conn.handle(), 0, None, std::ptr::null_mut());
            }
            let second_revision = worker.join().unwrap().unwrap();
            assert!(
                gate.fired && gate.resumed,
                "barrier did not complete for {prefix}"
            );
            assert_eq!(second_revision.id, 2);
            if different_payload {
                assert!(first_result
                    .unwrap_err()
                    .to_string()
                    .contains("idempotency key bound to different payload"));
            } else {
                assert_eq!(
                    first_result.unwrap().snapshot_hash,
                    second_revision.snapshot_hash
                );
            }
            assert_eq!(first.history("p").unwrap().len(), 2);
            assert_eq!(first.head("p").unwrap().id, 2);
        }
    }
}
