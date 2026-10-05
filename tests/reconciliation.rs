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
    match case.store.reconciliation_preview(request) {
        Ok(p) => assert_eq!(
            p["preview"]["ready"], false,
            "unexpected executable return: {p}"
        ),
        Err(_) => {}
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
