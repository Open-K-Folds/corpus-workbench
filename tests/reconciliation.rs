//! Independent synthetic falsification of external return reconciliation.
use corpus_workbench::{
    model::*,
    package,
    reconcile::{Choice, Request},
    store::{Fault, Store},
};
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::PathBuf};
use tempfile::TempDir;

const DOC: &str = "xmlfiles/demo.xml";
const XML: &str = "<?xml version='1.0'?>\n<?keep source?>\n<TEI xmlns:x='urn:opaque'><text><!--keep comment--><u id='u-1' start='0' end='4'><tok id='w-1' form='raw' nform='base' x:opaque='keep &amp; value'>raw</tok> <tok id='w-2' form='two'>two</tok></u><x:unknown keep='yes'>retain me</x:unknown></text></TEI>\n";

struct Case {
    _tmp: TempDir,
    store: Store,
    returned: PathBuf,
}
impl Case {
    fn new(xml: &str) -> Self {
        let tmp = TempDir::new().unwrap();
        let input = tmp.path().join("input");
        for sub in ["xmlfiles", "Resources", "Raw", "Audio"] {
            fs::create_dir_all(input.join(sub)).unwrap();
        }
        fs::write(input.join(DOC), xml).unwrap();
        fs::write(
            input.join("Resources/settings.xml"),
            "<ttsettings preserve='yes'/>",
        )
        .unwrap();
        fs::write(
            input.join("Raw/asr.raw.json"),
            b"{\"synthetic\":true,\"word_times\":null}",
        )
        .unwrap();
        fs::write(
            input.join("Audio/synthetic.wav"),
            b"RIFF synthetic fixture only",
        )
        .unwrap();
        let mut store = Store::open(&tmp.path().join("authority")).unwrap();
        store.import(&input, "p").unwrap();
        let returned = tmp.path().join("return");
        store
            .export("p", store.head("p").unwrap().id, &returned)
            .unwrap();
        Self {
            _tmp: tmp,
            store,
            returned,
        }
    }
    fn replace(&self, from: &str, to: &str) {
        let text = fs::read_to_string(self.returned.join(DOC)).unwrap();
        assert!(text.contains(from));
        fs::write(self.returned.join(DOC), text.replace(from, to)).unwrap();
    }
    fn request(&self) -> Request {
        let head = self.store.head("p").unwrap();
        Request {
            schema: 1,
            project: "p".into(),
            revision: head.id,
            snapshot_hash: head.snapshot_hash,
            stage: self.store.stage_return(&self.returned, "p").unwrap(),
            resolutions: BTreeMap::new(),
        }
    }
    fn text(&self) -> String {
        let view = self.store.view("p", None).unwrap();
        self.store.objects.text(&view.snapshot, DOC).unwrap()
    }
    fn local(&mut self, fields: BTreeMap<String, String>) -> Revision {
        let command = command(
            &self.store,
            "local-edit",
            vec![Operation::SetToken {
                document: DOC.into(),
                token: "w-1".into(),
                fields,
            }],
        );
        self.store
            .apply("local-owner", &command, Fault::None)
            .unwrap()
    }
    fn preview(&self, r: &Request) -> Value {
        self.store.reconciliation_preview(r).unwrap()
    }
    fn apply(
        &mut self,
        id: &str,
        r: &Request,
        preview: &Value,
        fault: Fault,
    ) -> anyhow::Result<Revision> {
        let command = command(
            &self.store,
            id,
            vec![Operation::ReconcilePackage {
                request: r.clone(),
                preview_hash: preview["preview_hash"].as_str().unwrap().into(),
            }],
        );
        self.store.apply("local-owner", &command, fault)
    }
}
fn command(store: &Store, id: &str, operations: Vec<Operation>) -> Command {
    let view = store.view("p", None).unwrap();
    Command {
        schema: 1,
        project: "p".into(),
        command_id: id.into(),
        base_revision: view.revision.id,
        preimage_hash: view.revision.snapshot_hash,
        config_version: view.snapshot.config.version,
        label: id.into(),
        operations,
    }
}
fn authority_objects(store: &Store) -> Vec<String> {
    let mut names: Vec<_> = fs::read_dir(&store.objects.root)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}
fn assert_blocked(case: &Case, request: &Request) {
    if let Ok(p) = case.store.reconciliation_preview(request) {
        assert_eq!(
            p["preview"]["ready"], false,
            "unexpected executable return: {p}"
        );
    }
}

#[test]
fn return_review_xml_id_survives_preview_commit_and_reimport() {
    let original = XML.replace("id='w-1'", "xml:id='w-1'");
    let mut c = Case::new(&original);
    c.replace("nform='base'", "nform='returned'");
    let request = c.request();
    let preview = c.preview(&request);
    assert_eq!(preview["preview"]["ready"], true, "{preview}");
    let revision = c
        .apply("xml-id-return", &request, &preview, Fault::None)
        .unwrap();
    assert_eq!(
        c.text(),
        original.replace("nform='base'", "nform='returned'")
    );
    let export = c._tmp.path().join("xml-id-export");
    c.store.export("p", revision.id, &export).unwrap();
    let mut reopened = Store::open(&c._tmp.path().join("xml-id-reimport")).unwrap();
    reopened.import(&export, "copy").unwrap();
    let view = reopened.view("copy", None).unwrap();
    assert_eq!(view.documents[0].tokens[0].id, "w-1");
    assert_eq!(
        view.documents[0].tokens[0].corrected.as_deref(),
        Some("returned")
    );
    assert_eq!(
        reopened.objects.text(&view.snapshot, DOC).unwrap(),
        c.text()
    );
}

#[test]
fn return_review_deleted_normalization_has_no_native_status() {
    for status in ["resolved", "unresolved"] {
        let original = XML.replace("nform='base'", &format!("nform='base' wb_normalized='normalized' wb_normalized_status='{status}' x:wb_normalized_status='keep'"));
        let mut c = Case::new(&original);
        c.replace("wb_normalized='normalized'", "");
        let request = c.request();
        let preview = c.preview(&request);
        assert_eq!(preview["preview"]["ready"], true, "{preview}");
        let revision = c
            .apply("remove-normalization", &request, &preview, Fault::None)
            .unwrap();
        let view = c.store.view("p", None).unwrap();
        let token = &view.documents[0].tokens[0];
        assert_eq!(token.normalized, None);
        assert!(
            !token.attrs.contains_key("wb_normalized_status"),
            "{token:?}"
        );
        assert_eq!(
            token
                .attrs
                .get("{urn:opaque}wb_normalized_status")
                .map(String::as_str),
            Some("keep")
        );
        assert_eq!(token.corrected.as_deref(), Some("base"));
        let export = c._tmp.path().join("normalization-export");
        c.store.export("p", revision.id, &export).unwrap();
        let mut reopened = Store::open(&c._tmp.path().join("normalization-reimport")).unwrap();
        reopened.import(&export, "copy").unwrap();
        let copy = reopened.view("copy", None).unwrap();
        assert_eq!(copy.documents[0].tokens[0].normalized, None);
        assert!(!copy.documents[0].tokens[0]
            .attrs
            .contains_key("wb_normalized_status"));
    }
}

#[test]
fn serializer_trivia_correction_backups_commit_and_complete_reimport() {
    let mut c = Case::new(XML);
    let returned = XML
        .replace(
            "<?xml version='1.0'?>",
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        )
        .replace(
            "id='w-1' form='raw' nform='base' x:opaque='keep &amp; value'",
            "x:opaque=\"keep &#38; value\" nform=\"next é🙂\" form=\"raw\" id=\"w-1\"",
        );
    fs::write(c.returned.join(DOC), &returned).unwrap();
    let backup = c.returned.join("backups/demo-20261005.xml");
    fs::create_dir_all(backup.parent().unwrap()).unwrap();
    fs::write(&backup, XML).unwrap();
    let original = c.store.view("p", None).unwrap().snapshot;
    let r = c.request();
    let p = c.preview(&r);
    assert_eq!(p["preview"]["ready"], true, "{p}");
    let revision = c.apply("reconcile", &r, &p, Fault::None).unwrap();
    assert_eq!(c.text(), XML.replace("nform='base'", "nform='next é🙂'"));
    let view = c.store.view("p", None).unwrap();
    for (path, artifact) in &original.files {
        if path != DOC {
            assert_eq!(view.snapshot.files[path], *artifact);
        }
    }
    let lineage_path = p["preview"]["lineage_path"].as_str().unwrap();
    let lineage: Value =
        serde_json::from_str(&c.store.objects.text(&view.snapshot, lineage_path).unwrap()).unwrap();
    assert_eq!(lineage["frozen_xml"][DOC], returned);
    assert_eq!(lineage["frozen_xml"]["backups/demo-20261005.xml"], XML);
    let exported = c._tmp.path().join("roundtrip");
    c.store.export("p", revision.id, &exported).unwrap();
    let mut reopened = Store::open(&c._tmp.path().join("reopened")).unwrap();
    reopened.import(&exported, "copy").unwrap();
    let reopened = reopened.view("copy", None).unwrap();
    for (path, artifact) in &view.snapshot.files {
        assert_eq!(reopened.snapshot.files[path].sha256, artifact.sha256);
        assert_eq!(
            package::hash(&fs::read(exported.join(path)).unwrap()),
            artifact.sha256
        );
    }
}

#[test]
fn valid_field_edit_cannot_hide_unsupported_xml_changes() {
    for (from, to) in [
        (">raw</tok>", ">hidden raw</tok>"),
        ("form='raw'", "form='different'"),
        ("keep comment", "changed comment"),
        ("<?keep source?>", "<?keep changed?>"),
        ("retain me", "changed unknown content"),
        ("urn:opaque", "urn:changed"),
        ("x:opaque='keep &amp; value'", "x:opaque='changed'"),
        ("start='0'", "start='1'"),
        ("id='w-1'", "id='new-identity'"),
        ("nform='base'", "x:nform='foreign'"),
    ] {
        let c = Case::new(XML);
        c.replace("<tok id='w-2'", "<tok note='valid external edit' id='w-2'");
        c.replace(from, to);
        let before = c.store.head("p").unwrap();
        let objects = authority_objects(&c.store);
        let r = c.request();
        assert_blocked(&c, &r);
        assert_eq!(
            c.store.head("p").unwrap().snapshot_hash,
            before.snapshot_hash
        );
        assert_eq!(authority_objects(&c.store), objects);
    }
}

#[test]
fn selected_export_namespace_addition_is_not_silently_dropped() {
    let c = Case::new(XML);
    c.replace("nform='base'", "nform='external'");
    let namespace = fs::read_dir(c.returned.join("Workbench/exports"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(
        namespace.join("unexpected.bin"),
        b"synthetic opaque bytes must not disappear",
    )
    .unwrap();
    assert_blocked(&c, &c.request());
}

#[test]
fn changed_managed_receipt_metadata_is_not_accepted_as_ordinary_token_return() {
    for field in ["authority", "approved", "reviews", "unknown_key"] {
        let c = Case::new(XML);
        c.replace("nform='base'", "nform='external'");
        let namespace = fs::read_dir(c.returned.join("Workbench/exports"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let path = namespace.join("export-receipt.json");
        let mut receipt: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        receipt[field] = match field {
            "authority" => Value::String("unsupported-external-authority".into()),
            "approved" => Value::Bool(true),
            "reviews" => {
                serde_json::json!([{"revision":receipt["revision"]["id"],"snapshot_hash":receipt["revision"]["snapshot_hash"],"actor":"local-owner","decision":"approved","scope":"full","note":"synthetic forged review","created_at":"2026-10-05T00:00:00.000Z","self_review":true}])
            }
            "unknown_key" => serde_json::json!({"unsupported":"new metadata"}),
            _ => unreachable!(),
        };
        fs::write(path, serde_json::to_vec_pretty(&receipt).unwrap()).unwrap();
        assert_blocked(&c, &c.request());
    }
}

#[test]
fn qualified_attr_reordering_cannot_invent_or_hide_a_correction() {
    let xml = XML.replace("nform='base'", "x:nform='foreign' nform='base'");
    let mut c = Case::new(&xml);
    c.replace(
        "x:nform='foreign' nform='base'",
        "nform='base' x:nform='foreign' note='valid external edit'",
    );
    let r = c.request();
    match c.store.reconciliation_preview(&r) {
        Err(_) => {} // Conservative ambiguous-attribute rejection is acceptable.
        Ok(p) if p["preview"]["ready"] == false => {}
        Ok(p) => {
            let changes = p["preview"]["changes"].as_array().unwrap();
            assert!(
                !changes.iter().any(|change| change["field"] == "nform"),
                "invented correction: {p}"
            );
            c.apply("qualified-return", &r, &p, Fault::None).unwrap();
            let view = c.store.view("p", None).unwrap();
            assert_eq!(
                view.documents[0].tokens[0].corrected.as_deref(),
                Some("base")
            );
        }
    }
}

#[test]
fn frozen_stage_preview_does_not_mutate_authority_or_read_live_source() {
    let c = Case::new(XML);
    c.replace("nform='base'", "nform='external'");
    let before = authority_objects(&c.store);
    let r = c.request();
    let first = c.preview(&r);
    c.replace("nform='external'", "nform='later untrusted source change'");
    let second = c.preview(&r);
    assert_eq!(first, second);
    assert_eq!(authority_objects(&c.store), before);
    assert_eq!(c.store.history("p").unwrap().len(), 1);
    assert_eq!(c.text(), XML);
}

#[test]
fn three_way_conflict_requires_explicit_choice_and_preserves_other_local_fields() {
    for choice in [Choice::Current, Choice::External] {
        let mut c = Case::new(XML);
        c.replace("nform='base'", "nform='external' note='remote note'");
        c.local(BTreeMap::from([
            ("nform".into(), "local".into()),
            ("lemma".into(), "local lemma".into()),
        ]));
        let mut r = c.request();
        let conflict = c.preview(&r);
        assert_eq!(conflict["preview"]["ready"], false);
        let change = conflict["preview"]["changes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|ch| ch["field"] == "nform")
            .unwrap();
        assert_eq!(change["state"], "conflict");
        r.resolutions
            .insert(change["key"].as_str().unwrap().into(), choice);
        let p = c.preview(&r);
        assert_eq!(p["preview"]["ready"], true, "{p}");
        c.apply("resolved-return", &r, &p, Fault::None).unwrap();
        let view = c.store.view("p", None).unwrap();
        let t = &view.documents[0].tokens[0];
        assert_eq!(
            t.corrected.as_deref(),
            Some(if choice == Choice::Current {
                "local"
            } else {
                "external"
            })
        );
        assert_eq!(
            t.attrs.get("lemma").map(String::as_str),
            Some("local lemma")
        );
        assert_eq!(t.attrs.get("note").map(String::as_str), Some("remote note"));
    }
}

#[test]
fn stale_proof_bound_idempotency_fault_recovery_and_review_invalidation() {
    let mut c = Case::new(XML);
    let base = c.store.head("p").unwrap();
    c.store
        .review(
            "local-owner",
            "p",
            base.id,
            &base.snapshot_hash,
            "approved",
            "synthetic",
        )
        .unwrap();
    c.replace("nform='base'", "nform='external'");
    let r = c.request();
    let p = c.preview(&r);
    let operation = Operation::ReconcilePackage {
        request: r.clone(),
        preview_hash: p["preview_hash"].as_str().unwrap().into(),
    };
    let cmd = command(&c.store, "retryable-return", vec![operation]);
    assert!(c
        .store
        .apply("local-owner", &cmd, Fault::AfterStage)
        .is_err());
    assert_eq!(c.store.head("p").unwrap().id, base.id);
    assert!(c
        .store
        .apply("local-owner", &cmd, Fault::BeforeCommit)
        .is_err());
    assert_eq!(c.store.head("p").unwrap().id, base.id);
    let committed = c.store.apply("local-owner", &cmd, Fault::None).unwrap();
    assert_eq!(
        c.store
            .apply("local-owner", &cmd, Fault::None)
            .unwrap()
            .snapshot_hash,
        committed.snapshot_hash
    );
    assert_eq!(c.store.history("p").unwrap().len(), 2);
    assert!(!c.store.view("p", None).unwrap().approved);
    assert!(c.store.view("p", Some(base.id)).unwrap().approved);
    assert!(c.store.reconciliation_preview(&r).is_err());
    let mut altered = cmd;
    altered.label = "different payload".into();
    assert!(c.store.apply("local-owner", &altered, Fault::None).is_err());
}

#[test]
fn deleting_authored_fields_preserves_absence_and_invalidates_retained_normalization() {
    let xml = XML.replace(
        "nform='base'",
        "nform='base' wb_normalized='normalized' wb_normalized_status='resolved'",
    );
    let mut c = Case::new(&xml);
    c.replace(" nform='base'", "");
    let r = c.request();
    let p = c.preview(&r);
    assert_eq!(p["preview"]["ready"], true, "{p}");
    c.apply("delete-correction", &r, &p, Fault::None).unwrap();
    let view = c.store.view("p", None).unwrap();
    let t = &view.documents[0].tokens[0];
    assert_eq!(t.corrected, None);
    assert_eq!(t.normalized.as_deref(), Some("normalized"));
    assert_eq!(
        t.attrs.get("wb_normalized_status").map(String::as_str),
        Some("unresolved")
    );
}

#[test]
fn normalization_from_a_different_corrected_basis_cannot_become_resolved() {
    let xml = XML.replace(
        "nform='base'",
        "nform='base' wb_normalized='old normalized' wb_normalized_status='resolved'",
    );
    let mut c = Case::new(&xml);
    c.replace(
        "wb_normalized='old normalized'",
        "wb_normalized='external normalized for base'",
    );
    c.local(BTreeMap::from([(
        "nform".into(),
        "local corrected basis".into(),
    )]));
    let r = c.request();
    match c.store.reconciliation_preview(&r) {
        Err(_) => {}
        Ok(p) if p["preview"]["ready"] == false => {}
        Ok(p) => {
            c.apply("normalization-context", &r, &p, Fault::None)
                .unwrap();
            let view = c.store.view("p", None).unwrap();
            let t = &view.documents[0].tokens[0];
            assert_eq!(t.corrected.as_deref(), Some("local corrected basis"));
            assert_ne!(
                t.attrs.get("wb_normalized_status").map(String::as_str),
                Some("resolved"),
                "normalization applied on a different corrected basis was falsely resolved"
            );
            assert!(view.issues.iter().any(|i| i.blocking));
        }
    }
}

#[test]
fn removing_empty_correction_changes_the_effective_basis_and_invalidates_normalization() {
    let xml = XML.replace(
        "nform='base'",
        "nform='' wb_normalized='normalized empty' wb_normalized_status='resolved'",
    );
    let mut c = Case::new(&xml);
    c.replace(" nform=''", "");
    let r = c.request();
    let p = c.preview(&r);
    assert_eq!(p["preview"]["ready"], true, "{p}");
    c.apply("empty-correction-deletion", &r, &p, Fault::None)
        .unwrap();
    let view = c.store.view("p", None).unwrap();
    let t = &view.documents[0].tokens[0];
    assert_eq!(t.corrected, None);
    assert_eq!(
        t.attrs.get("wb_normalized_status").map(String::as_str),
        Some("unresolved")
    );
}

#[test]
fn current_correction_choice_cannot_resolve_normalization_for_external_correction() {
    let xml = XML.replace(
        "nform='base'",
        "nform='base' wb_normalized='old normalized' wb_normalized_status='resolved'",
    );
    let mut c = Case::new(&xml);
    c.replace("nform='base'", "nform='external correction'");
    c.replace(
        "wb_normalized='old normalized'",
        "wb_normalized='external normalized'",
    );
    c.local(BTreeMap::from([(
        "nform".into(),
        "local correction".into(),
    )]));
    let mut r = c.request();
    let conflict = c.preview(&r);
    let change = conflict["preview"]["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|change| change["field"] == "nform")
        .unwrap();
    r.resolutions
        .insert(change["key"].as_str().unwrap().into(), Choice::Current);
    match c.store.reconciliation_preview(&r) {
        Err(_) => {}
        Ok(p) if p["preview"]["ready"] == false => {}
        Ok(p) => {
            c.apply("normalization-conflict-context", &r, &p, Fault::None)
                .unwrap();
            let view = c.store.view("p", None).unwrap();
            let t = &view.documents[0].tokens[0];
            assert_eq!(t.corrected.as_deref(), Some("local correction"));
            assert_ne!(
                t.attrs.get("wb_normalized_status").map(String::as_str),
                Some("resolved")
            );
        }
    }
}

#[test]
fn correction_return_preserves_character_quote_and_invalidates_its_judgment() {
    let mut c = Case::new(XML);
    let add = command(
        &c.store,
        "character-anchor",
        vec![Operation::AddSpan {
            document: DOC.into(),
            id: "s-1".into(),
            token_ids: vec!["w-1".into()],
            fields: BTreeMap::from([("label".into(), "synthetic character judgment".into())]),
            character: Some(CharacterAnchor {
                token: "w-1".into(),
                start: 0,
                end: 4,
                quote: "base".into(),
                coordinate: "unicode-codepoint".into(),
                layer: "corrected".into(),
            }),
        }],
    );
    let base = c.store.apply("local-owner", &add, Fault::None).unwrap();
    c.store
        .review(
            "local-owner",
            "p",
            base.id,
            &base.snapshot_hash,
            "approved",
            "synthetic",
        )
        .unwrap();
    let exported = c._tmp.path().join("return-with-character");
    c.store.export("p", base.id, &exported).unwrap();
    c.returned = exported;
    c.replace("nform='base'", "nform='é🙂 next'");
    let r = c.request();
    let p = c.preview(&r);
    assert_eq!(p["preview"]["ready"], true, "{p}");
    c.apply("character-context-return", &r, &p, Fault::None)
        .unwrap();
    let view = c.store.view("p", None).unwrap();
    let span = &view.documents[0].spans[0];
    assert_eq!(
        span.fields.get("wb_quote").map(String::as_str),
        Some("base")
    );
    assert_eq!(
        span.fields.get("wb_status").map(String::as_str),
        Some("unresolved")
    );
    assert!(!view.approved);
    assert!(view.issues.iter().any(|issue| issue.blocking));
}

#[test]
fn altered_preview_proof_and_staged_bytes_reject_without_revision() {
    let mut c = Case::new(XML);
    c.replace("nform='base'", "nform='external'");
    let r = c.request();
    let mut p = c.preview(&r);
    p["preview_hash"] = Value::String("0".repeat(64));
    assert!(c.apply("bad-proof", &r, &p, Fault::None).is_err());
    let manifest: Value = serde_json::from_slice(
        &fs::read(
            c.store
                .root
                .join("returns")
                .join(&r.stage)
                .join("stage.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let artifact_hash = manifest["files"][DOC]["sha256"].as_str().unwrap();
    fs::write(
        c.store
            .root
            .join("returns")
            .join(&r.stage)
            .join("objects")
            .join(artifact_hash),
        b"synthetic staged-byte tamper",
    )
    .unwrap();
    assert!(c.store.reconciliation_preview(&r).is_err());
    assert_eq!(c.store.history("p").unwrap().len(), 1);
    assert_eq!(c.text(), XML);
}

#[test]
fn changed_or_missing_non_transcript_and_new_unknown_artifacts_are_blocked() {
    for mode in ["settings", "raw", "media", "deleted", "unknown"] {
        let c = Case::new(XML);
        c.replace("nform='base'", "nform='external'");
        match mode {
            "settings" => fs::write(
                c.returned.join("Resources/settings.xml"),
                "<ttsettings changed='yes'/>",
            )
            .unwrap(),
            "raw" => fs::write(c.returned.join("Raw/asr.raw.json"), b"{\"changed\":true}").unwrap(),
            "media" => fs::write(
                c.returned.join("Audio/synthetic.wav"),
                b"changed synthetic media",
            )
            .unwrap(),
            "deleted" => fs::remove_file(c.returned.join("Audio/synthetic.wav")).unwrap(),
            "unknown" => fs::write(
                c.returned.join("Resources/new-opaque.bin"),
                b"new opaque bytes",
            )
            .unwrap(),
            _ => unreachable!(),
        }
        let before = authority_objects(&c.store);
        let r = c.request();
        assert_blocked(&c, &r);
        assert_eq!(c.store.history("p").unwrap().len(), 1);
        assert_eq!(authority_objects(&c.store), before);
    }
}

#[test]
fn reconciliation_hard_process_crashes_recover_and_retry_exactly_once() {
    for (point, committed) in [
        ("after-stage", false),
        ("before-commit", false),
        ("after-commit", true),
    ] {
        let mut c = Case::new(XML);
        c.replace("nform='base'", "nform='external'");
        let r = c.request();
        let p = c.preview(&r);
        let cmd = command(
            &c.store,
            "crash-retry-return",
            vec![Operation::ReconcilePackage {
                request: r,
                preview_hash: p["preview_hash"].as_str().unwrap().into(),
            }],
        );
        let file = c._tmp.path().join("crash-command.json");
        fs::write(&file, serde_json::to_vec(&cmd).unwrap()).unwrap();
        let root = c.store.root.clone();
        drop(c.store);
        let outcome = std::process::Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
            .args(["apply", "--fault", point, "--command"])
            .arg(&file)
            .arg("--store")
            .arg(&root)
            .env("WORKBENCH_TEST_HARD_CRASH", "yes")
            .output()
            .unwrap();
        assert_eq!(
            outcome.status.code(),
            Some(73),
            "{point}: {}",
            String::from_utf8_lossy(&outcome.stderr)
        );
        c.store = Store::open(&root).unwrap();
        assert_eq!(
            c.store.history("p").unwrap().len(),
            if committed { 2 } else { 1 }
        );
        let saved = c.store.apply("local-owner", &cmd, Fault::None).unwrap();
        assert_eq!(c.store.history("p").unwrap().len(), 2);
        assert_eq!(
            c.store.head("p").unwrap().snapshot_hash,
            saved.snapshot_hash
        );
        assert_eq!(c.text(), XML.replace("nform='base'", "nform='external'"));
        let export = c._tmp.path().join("recovered-export");
        c.store.export("p", saved.id, &export).unwrap();
        let mut copy = Store::open(&c._tmp.path().join("recovered-import")).unwrap();
        copy.import(&export, "copy").unwrap();
    }
}

#[test]
fn accepted_return_remains_eligible_for_otherwise_proven_retokenization() {
    use corpus_workbench::{
        handoff::digest,
        retokenize::{Reading, RetokenizeRequest},
    };
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(input.join(DOC), "<TEI><text><tok id='w-1' form='one' nform='base'>one</tok> <tok id='w-2' form='two'>two</tok></text></TEI>").unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    store.import(&input, "p").unwrap();
    let returned = tmp.path().join("return");
    store
        .export("p", store.head("p").unwrap().id, &returned)
        .unwrap();
    let mut c = Case {
        _tmp: tmp,
        store,
        returned,
    };
    c.replace("nform='base'", "nform='next'");
    let r = c.request();
    let p = c.preview(&r);
    c.apply("return-before-split", &r, &p, Fault::None).unwrap();
    let view = c.store.view("p", None).unwrap();
    let lineage_path = p["preview"]["lineage_path"].as_str().unwrap();
    let lineage = c
        .store
        .objects
        .read(&view.snapshot.files[lineage_path])
        .unwrap();
    let inv = c.store.reference_inventory("p", view.revision.id).unwrap();
    let request = RetokenizeRequest {
        schema: 1,
        project: "p".into(),
        revision: inv.revision,
        snapshot_hash: inv.snapshot_hash.clone(),
        config_hash: inv.config_hash.clone(),
        inventory_hash: digest(&inv).unwrap(),
        document: DOC.into(),
        targets: vec![inv
            .ids
            .iter()
            .find(|id| id.artifact == DOC && id.id == "w-1")
            .unwrap()
            .clone()],
        replacement: vec![
            Reading {
                id: "fresh-a".into(),
                original: "o".into(),
                corrected: Some("n".into()),
                normalized: None,
            },
            Reading {
                id: "fresh-b".into(),
                original: "ne".into(),
                corrected: Some("ext".into()),
                normalized: None,
            },
        ],
        relation_endpoint: None,
    };
    let proof = c.store.retokenization_preview(&request).unwrap();
    assert!(proof.execution_enabled, "{:?}", proof.blockers);
    let command = command(
        &c.store,
        "split-after-return",
        vec![Operation::Retokenize {
            request,
            preview_hash: digest(&proof).unwrap(),
        }],
    );
    let saved = c.store.apply("local-owner", &command, Fault::None).unwrap();
    let split = c.store.view("p", None).unwrap();
    assert_eq!(
        c.store
            .objects
            .read(&split.snapshot.files[lineage_path])
            .unwrap(),
        lineage
    );
    assert_eq!(
        split.documents[0]
            .tokens
            .iter()
            .map(|t| t.id.as_str())
            .collect::<Vec<_>>(),
        vec!["fresh-a", "fresh-b", "w-2"]
    );
    let export = c._tmp.path().join("return-then-split-export");
    c.store.export("p", saved.id, &export).unwrap();
    let mut copy = Store::open(&c._tmp.path().join("return-then-split-import")).unwrap();
    copy.import(&export, "copy").unwrap();
    let imported = copy.view("copy", None).unwrap();
    assert_eq!(
        copy.objects
            .read(&imported.snapshot.files[lineage_path])
            .unwrap(),
        lineage
    );
}

fn synthetic_generation(store: &Store) -> (corpus_workbench::handoff::Completion, Vec<u8>) {
    use corpus_workbench::handoff::{digest, Anchor, Binding, Completion, Recipe};
    use serde_json::json;
    let view = store.view("p", None).unwrap();
    let contract = store.approved_contract("p", view.revision.id).unwrap();
    let binding = Binding {
        schema: 1,
        authority: "research-intelligence".into(),
        project: "p".into(),
        revision: view.revision.id,
        snapshot_hash: view.revision.snapshot_hash,
        config_hash: contract["config_hash"].as_str().unwrap().into(),
        contract_hash: digest(&contract).unwrap(),
        recipe: Recipe {
            mapping_version: "corpus-evidence/1".into(),
            adapter_hash: "a".repeat(64),
            compiler_commit: "b".repeat(40),
            compiler_source_hash: "c".repeat(64),
            compiler_version: "semantica/0.6.8".into(),
            runtime_hash: "d".repeat(64),
            ontology_hash: "e".repeat(64),
            model_hash: "f".repeat(64),
            options: BTreeMap::from([
                ("access".into(), "local-only".into()),
                (
                    "extraction".into(),
                    "none; authored evidence mapping".into(),
                ),
            ]),
        },
    };
    let lineage = json!({"project_id":"p","revision":binding.revision,"bundle_hash":binding.snapshot_hash,"config_hash":binding.config_hash,"contract_hash":binding.contract_hash,"recipe_hash":digest(&binding.recipe).unwrap(),"access_policy":"local-only"});
    let doc = &contract["documents"][0];
    let anchors = BTreeMap::from([
        (
            "d".into(),
            Anchor {
                document: DOC.into(),
                kind: "document".into(),
                external_id: DOC.into(),
                sidecar: None,
            },
        ),
        (
            "t".into(),
            Anchor {
                document: DOC.into(),
                kind: "token".into(),
                external_id: "w-1".into(),
                sidecar: None,
            },
        ),
    ]);
    let mut nodes = Vec::new();
    for (id, source, kind, content) in [
        (
            "d",
            json!({"path":doc["path"],"title":doc["title"],"media":doc["media"],"metadata":doc["metadata"],"opaque_elements":doc["opaque_elements"]}),
            "CorpusDocument",
            doc["title"].clone(),
        ),
        (
            "t",
            doc["tokens"][0].clone(),
            "CorpusToken",
            doc["tokens"][0]["corrected"].clone(),
        ),
    ] {
        let mut properties = lineage.clone();
        properties["anchor"] = serde_json::to_value(&anchors[id]).unwrap();
        properties["source"] = source;
        properties["artifact_hash"] = contract["artifact_manifest"][DOC]["sha256"].clone();
        properties["rights"] = contract["rights"].clone();
        properties["definition_version"] = contract["definition_version"].clone();
        properties["content"] = content;
        nodes.push(json!({"id":id,"type":kind,"properties":properties}));
    }
    let bytes = serde_json::to_vec(&json!({"nodes":nodes,"edges":[{"source_id":"t","target_id":"d","type":"partOfDocument","properties":lineage}]})).unwrap();
    let completion = Completion {
        schema: 1,
        binding,
        graph_hash: package::hash(&bytes),
        node_count: 2,
        edge_count: 1,
        anchors,
    };
    (completion, bytes)
}

#[test]
fn old_export_generation_history_remains_valid_after_local_authoring() {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        input.join(DOC),
        "<TEI><text><tok id='w-1' form='one' nform='base'>one</tok></text></TEI>",
    )
    .unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    let base = store.import(&input, "p").unwrap();
    store
        .review(
            "local-owner",
            "p",
            base.id,
            &base.snapshot_hash,
            "approved",
            "synthetic compiler fixture",
        )
        .unwrap();
    let (completion, graph) = synthetic_generation(&store);
    store
        .accept_generation(&completion, &graph, Fault::None)
        .unwrap();
    let generation = store.generations("p", true).unwrap()[0].clone();
    assert_eq!(generation["current"], true);
    let returned = tmp.path().join("return");
    store.export("p", base.id, &returned).unwrap();
    let mut c = Case {
        _tmp: tmp,
        store,
        returned,
    };
    c.replace("nform='base'", "nform='external'");
    c.local(BTreeMap::from([(
        "note".into(),
        "local note remains".into(),
    )]));
    assert_eq!(c.store.generations("p", true).unwrap()[0]["current"], false);
    let r = c.request();
    let p = c.preview(&r);
    assert_eq!(p["preview"]["ready"], true, "{p}");
    c.apply("historical-compiler-return", &r, &p, Fault::None)
        .unwrap();
    let historical = c
        .store
        .generation("p", generation["generation_id"].as_str().unwrap(), true)
        .unwrap();
    assert_eq!(
        historical["generation"]["graph_hash"],
        generation["graph_hash"]
    );
    assert!(c.store.generations("p", false).unwrap().is_empty());
    let view = c.store.view("p", None).unwrap();
    let token = &view.documents[0].tokens[0];
    assert_eq!(token.corrected.as_deref(), Some("external"));
    assert_eq!(
        token.attrs.get("note").map(String::as_str),
        Some("local note remains")
    );
    assert!(!view.approved);
}

#[test]
fn existing_dotted_unicode_token_identifier_is_preserved_through_return() {
    let xml = XML.replace("id='w-1'", "id='w.part-é🙂'");
    let mut c = Case::new(&xml);
    c.replace("nform='base'", "nform='external'");
    let r = c.request();
    let p = c.preview(&r);
    assert_eq!(p["preview"]["ready"], true, "{p}");
    c.apply("unicode-existing-id", &r, &p, Fault::None).unwrap();
    assert_eq!(c.text(), xml.replace("nform='base'", "nform='external'"));
    assert_eq!(
        c.store.view("p", None).unwrap().documents[0].tokens[0].id,
        "w.part-é🙂"
    );
}

#[test]
fn qualified_status_and_relation_attributes_remain_inert_after_correction() {
    for mode in ["token_status", "span_status", "relation"] {
        let xml = match mode {
            "token_status" => XML.replace("nform='base'", "nform='base' wb_normalized='normalized' wb_normalized_status='resolved' x:wb_normalized_status='resolved'"),
            "relation" => XML.replace("nform='base'", "nform='base' x:relation_target='#not-a-native-target'"),
            _ => XML.into(),
        };
        let mut c = Case::new(&xml);
        if mode == "span_status" {
            let input = c._tmp.path().join("input");
            fs::create_dir_all(input.join("Annotations")).unwrap();
            fs::write(input.join("Annotations/review_demo.xml"), "<spanGrp xmlns:x='urn:opaque'><span id='s1' corresp='#w-1' wb_start='0' wb_end='4' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_quote='base' wb_status='resolved' x:wb_status='resolved'/></spanGrp>").unwrap();
            let mut store = Store::open(&c._tmp.path().join("authority-with-span")).unwrap();
            store.import(&input, "p").unwrap();
            c.store = store;
            c.returned = c._tmp.path().join("return-with-span");
            c.store
                .export("p", c.store.head("p").unwrap().id, &c.returned)
                .unwrap();
        }
        c.replace("nform='base'", "nform='next'");
        let r = c.request();
        let p = c.preview(&r);
        assert_eq!(p["preview"]["ready"], true, "{mode}: {p}");
        c.apply("qualified-derived-fields", &r, &p, Fault::None)
            .unwrap();
        let view = c.store.view("p", None).unwrap();
        let token = &view.documents[0].tokens[0];
        match mode {
            "token_status" => {
                assert_eq!(
                    token.attrs.get("wb_normalized_status").map(String::as_str),
                    Some("unresolved")
                );
                assert_eq!(
                    token
                        .attrs
                        .get("{urn:opaque}wb_normalized_status")
                        .map(String::as_str),
                    Some("resolved")
                );
                assert!(view.issues.iter().any(|issue| issue.blocking));
            }
            "span_status" => {
                let span = &view.documents[0].spans[0];
                assert_eq!(
                    span.fields.get("wb_status").map(String::as_str),
                    Some("unresolved")
                );
                assert_eq!(
                    span.fields.get("{urn:opaque}wb_status").map(String::as_str),
                    Some("resolved")
                );
                assert!(view.issues.iter().any(|issue| issue.blocking));
            }
            "relation" => {
                assert!(!token.attrs.contains_key("relation_target"));
                assert_eq!(
                    token
                        .attrs
                        .get("{urn:opaque}relation_target")
                        .map(String::as_str),
                    Some("#not-a-native-target")
                );
            }
            _ => unreachable!(),
        }
    }
}

#[test]
fn legacy_collapsed_namespace_generation_is_historical_without_rewriting_bytes() {
    use corpus_workbench::handoff::digest;
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(input.join(DOC), "<TEI xmlns:x='urn:opaque'><text><tok id='w-1' form='one' nform='base' note='native' x:note='foreign'>one</tok></text></TEI>").unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    let base = store.import(&input, "p").unwrap();
    store
        .review(
            "local-owner",
            "p",
            base.id,
            &base.snapshot_hash,
            "approved",
            "synthetic namespace fixture",
        )
        .unwrap();
    let (mut completion, graph) = synthetic_generation(&store);
    let valid = store
        .accept_generation(&completion, &graph, Fault::None)
        .unwrap();
    let mut contract = store.approved_contract("p", base.id).unwrap();
    let attrs = contract["documents"][0]["tokens"][0]["attrs"]
        .as_object_mut()
        .unwrap();
    let foreign = attrs.remove("{urn:opaque}note").unwrap();
    attrs.insert("note".into(), foreign);
    let contract_bytes = serde_json::to_vec(&contract).unwrap();
    completion.binding.contract_hash = package::hash(&contract_bytes);
    let mut legacy_graph: Value = serde_json::from_slice(&graph).unwrap();
    for node in legacy_graph["nodes"].as_array_mut().unwrap() {
        node["properties"]["contract_hash"] =
            Value::String(completion.binding.contract_hash.clone());
        if node["id"] == "t" {
            node["properties"]["source"] = contract["documents"][0]["tokens"][0].clone();
        }
    }
    for edge in legacy_graph["edges"].as_array_mut().unwrap() {
        edge["properties"]["contract_hash"] =
            Value::String(completion.binding.contract_hash.clone());
    }
    let legacy_graph_bytes = serde_json::to_vec(&legacy_graph).unwrap();
    completion.graph_hash = package::hash(&legacy_graph_bytes);
    let receipt_bytes = serde_json::to_vec(&completion).unwrap();
    let id = digest(&completion.binding).unwrap();
    store
        .objects
        .put(&contract_bytes, "approved-compiler-contract")
        .unwrap();
    let receipt = store
        .objects
        .put(&receipt_bytes, "compiler-completion")
        .unwrap();
    store
        .objects
        .put(&legacy_graph_bytes, "derived-semantic-graph")
        .unwrap();
    // Simulate a previously accepted row from the prior projection, with its
    // corresponding immutable source contract, receipt and graph still intact.
    store.conn.execute("INSERT INTO derived_generations(id,project,revision,snapshot_hash,recipe_hash,receipt_hash,graph_hash) VALUES(?,'p',?,?,?,?,?)",rusqlite::params![id,base.id,base.snapshot_hash,digest(&completion.binding.recipe).unwrap(),receipt.sha256,completion.graph_hash]).unwrap();
    let current = store.generations("p", false).unwrap();
    assert_eq!(current.len(), 1);
    assert_eq!(current[0]["generation_id"], valid["generation_id"]);
    assert!(store.generation("p", &id, false).is_err());
    let historical = store.generation("p", &id, true).unwrap();
    assert_eq!(historical["generation"]["current"], false);
    assert_eq!(historical["contract"], contract);
    assert_eq!(historical["graph"], legacy_graph);
    assert_eq!(
        store.objects.read_hash(&receipt.sha256).unwrap(),
        receipt_bytes
    );
    assert_eq!(
        store.objects.read_hash(&completion.graph_hash).unwrap(),
        legacy_graph_bytes
    );
    assert!(store.view("p", None).unwrap().approved);
    assert_eq!(store.history("p").unwrap().len(), 1);
}
