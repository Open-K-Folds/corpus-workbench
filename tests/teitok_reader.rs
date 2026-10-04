use corpus_workbench::{
    handoff::digest,
    model::*,
    retokenize::*,
    store::{Fault, Store},
    teitok_reader::*,
};
use std::fs;
use tempfile::TempDir;
const DOC: &str = "xmlfiles/demo.xml";
fn fixture(settings: &str, extra: &[(&str, &str)]) -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("package");
    for (path,text) in [(SETTINGS_PATH,settings),(DOC,"<TEI><text><tok id='w1' form='abcd'>abcd</tok><tok id='w2' form='two'>two</tok></text></TEI>"),("Annotations/review_demo.xml","<spanGrp><span id='s1' corresp='#w1' label='coverage'/></spanGrp>")].into_iter().chain(extra.iter().copied()){
  // A case-alias fixture must not overwrite its canonical counterpart on Windows.
  if path == "Annotations/review_demo.xml" && extra.iter().any(|(other,_)| *other != path && other.eq_ignore_ascii_case(path)) { continue; }
  let p=input.join(path);fs::create_dir_all(p.parent().unwrap()).unwrap();fs::write(p,text).unwrap();
 }
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    s.import(&input, "p").unwrap();
    (tmp, s)
}
fn install(s: &Store, id: &str) -> Command {
    let view = s.view("p", None).unwrap();
    Command {
        schema: 1,
        project: "p".into(),
        command_id: id.into(),
        base_revision: view.revision.id,
        preimage_hash: view.revision.snapshot_hash,
        config_version: view.snapshot.config.version,
        label: "Install reader".into(),
        operations: vec![Operation::InstallTeitokReader {
            profile_hash: profile_hash().unwrap(),
        }],
    }
}
fn split(s: &Store) -> Command {
    split_on(s, "w1")
}
fn split_on(s: &Store, selected_id: &str) -> Command {
    let inv = s.reference_inventory("p", s.head("p").unwrap().id).unwrap();
    let request = RetokenizeRequest {
        schema: 1,
        project: "p".into(),
        revision: inv.revision,
        snapshot_hash: inv.snapshot_hash,
        config_hash: inv.config_hash,
        inventory_hash: digest(&s.reference_inventory("p", inv.revision).unwrap()).unwrap(),
        document: DOC.into(),
        targets: vec![inv
            .ids
            .iter()
            .find(|t| t.artifact == DOC && t.id == selected_id)
            .unwrap()
            .clone()],
        replacement: vec![
            Reading {
                id: "part-a".into(),
                original: "ab".into(),
                corrected: None,
                normalized: None,
            },
            Reading {
                id: "part-b".into(),
                original: "cd".into(),
                corrected: None,
                normalized: None,
            },
        ],
        relation_endpoint: None,
    };
    let preview = s.retokenization_preview(&request).unwrap();
    assert!(preview.execution_enabled, "{:?}", preview.blockers);
    let mut c = install(s, "split");
    c.operations = vec![Operation::Retokenize {
        request,
        preview_hash: digest(&preview).unwrap(),
    }];
    c
}
#[test]
fn installation_is_previewed_revisioned_review_invalidating_and_undoable() {
    let (_tmp, mut s) = fixture("<ttsettings/>", &[]);
    let before = s.view("p", None).unwrap();
    s.review(
        "local-owner",
        "p",
        1,
        &before.revision.snapshot_hash,
        "approved",
        "Synthetic",
    )
    .unwrap();
    let count = fs::read_dir(&s.objects.root).unwrap().count();
    let p = s.teitok_reader_preview("p", 1).unwrap();
    assert!(p.enabled && !p.installed);
    assert_eq!(p.candidate_xml, files());
    assert_eq!(fs::read_dir(&s.objects.root).unwrap().count(), count);
    let command = install(&s, "reader");
    let saved = s.apply("local-owner", &command, Fault::None).unwrap();
    let view = s.view("p", None).unwrap();
    assert!(!view.approved);
    assert_eq!(view.snapshot.config.version, 2);
    for (path, text) in files() {
        assert_eq!(s.objects.text(&view.snapshot, &path).unwrap(), text);
    }
    for (path, artifact) in before
        .snapshot
        .files
        .iter()
        .filter(|(path, _)| path.as_str() != SETTINGS_PATH)
    {
        assert_eq!(view.snapshot.files[path], *artifact);
    }
    assert_eq!(
        s.apply("local-owner", &command, Fault::None).unwrap().id,
        saved.id
    );
    assert!(s.teitok_reader_preview("p", 2).unwrap().installed);
    assert!(!s.teitok_reader_preview("p", 2).unwrap().enabled);
    let mut restore = install(&s, "restore");
    restore.operations = vec![Operation::Restore { revision: 1 }];
    s.apply("local-owner", &restore, Fault::None).unwrap();
    assert_eq!(
        s.view("p", None).unwrap().snapshot.files,
        before.snapshot.files
    );
    assert_eq!(
        s.view("p", None).unwrap().snapshot.config,
        before.snapshot.config
    );
    assert!(s
        .view("p", None)
        .unwrap()
        .snapshot
        .index_status
        .contains("stale after restore"));
    assert!(!s.view("p", None).unwrap().approved);
}
#[test]
fn custom_configuration_definition_and_aliases_are_never_overwritten() {
    for (settings, extra) in [
        ("<ttsettings custom='retain'/>", vec![]),
        (
            "<ttsettings/>",
            vec![(DEFINITION_PATH, "<annotation name='custom'/>")],
        ),
        (
            "<ttsettings/>",
            vec![(
                "Annotations/review_DEF.xml",
                "<annotation name='case alias'/>",
            )],
        ),
        (
            "<ttsettings/>",
            vec![(
                "annotations/review_def.xml",
                "<annotation name='directory alias'/>",
            )],
        ),
        (
            "<ttsettings/>",
            vec![("Annotations/review_def.xml/child.xml", "<opaque/>")],
        ),
        (
            "<ttsettings/>",
            vec![("Annotations/other_demo.xml", "<spanGrp/>")],
        ),
    ] {
        let (_tmp, mut s) = fixture(settings, &extra);
        let before = s.view("p", None).unwrap();
        let objects = fs::read_dir(&s.objects.root).unwrap().count();
        let p = s.teitok_reader_preview("p", 1).unwrap();
        assert!(!p.enabled && !p.blockers.is_empty());
        assert!(s
            .apply("local-owner", &install(&s, "blocked"), Fault::None)
            .is_err());
        assert_eq!(s.view("p", None).unwrap().snapshot, before.snapshot);
        assert_eq!(s.history("p").unwrap().len(), 1);
        assert_eq!(fs::read_dir(&s.objects.root).unwrap().count(), objects);
    }
}
#[test]
fn malformed_profile_hash_stale_scope_and_batched_installation_are_rejected() {
    let (_tmp, mut s) = fixture("<ttsettings/>", &[]);
    let c = install(&s, "reader");
    let mut forged = c.clone();
    forged.operations = vec![Operation::InstallTeitokReader {
        profile_hash: "f".repeat(64),
    }];
    assert!(s.apply("local-owner", &forged, Fault::None).is_err());
    let mut batch = c.clone();
    batch.operations.push(Operation::DefineLanguage {
        value: "local".into(),
        description: "Synthetic".into(),
    });
    assert!(s.apply("local-owner", &batch, Fault::None).is_err());
    assert!(s.apply("other-actor", &c, Fault::None).is_err());
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(s.teitok_reader_preview("p", 1).is_err());
    let mut different = c;
    different.label = "Different request".into();
    assert!(s
        .apply("local-owner", &different, Fault::None)
        .unwrap_err()
        .to_string()
        .contains("idempotency"));
    assert_eq!(s.history("p").unwrap().len(), 2);
}
#[test]
fn profile_carriers_stay_exact_through_split_export_reimport_and_backup() {
    let (tmp, mut s) = fixture(SETTINGS, &[(DEFINITION_PATH, DEFINITION)]);
    let c = split(&s);
    s.apply("local-owner", &c, Fault::None).unwrap();
    let view = s.view("p", None).unwrap();
    let def = view.snapshot.files[DEFINITION_PATH].clone();
    let settings = view.snapshot.files[SETTINGS_PATH].clone();
    let out = tmp.path().join("export");
    s.export("p", 2, &out).unwrap();
    assert_eq!(
        fs::read(out.join(SETTINGS_PATH)).unwrap(),
        SETTINGS.as_bytes()
    );
    assert_eq!(
        fs::read(out.join(DEFINITION_PATH)).unwrap(),
        DEFINITION.as_bytes()
    );
    let mut reopened = Store::open(&tmp.path().join("reopen")).unwrap();
    reopened.import(&out, "p").unwrap();
    assert_eq!(
        reopened.view("p", None).unwrap().documents[0].spans[0].token_ids,
        vec!["part-a", "part-b"]
    );
    assert_eq!(
        reopened.view("p", None).unwrap().snapshot.files[DEFINITION_PATH],
        def
    );
    assert_eq!(
        reopened.view("p", None).unwrap().snapshot.files[SETTINGS_PATH],
        settings
    );
    s.backup(&tmp.path().join("backup")).unwrap();
}
#[test]
fn any_reader_profile_mutation_or_missing_definition_blocks_structural_proof() {
    for extra in [
        vec![],
        vec![(DEFINITION_PATH, "<annotation name='foreign'/>")],
        vec![
            (DEFINITION_PATH, DEFINITION),
            ("Resources/unproved.xml", "<schema endpoint='w1'/>"),
        ],
    ] {
        let (_tmp, s) = fixture(SETTINGS, &extra);
        let inv = s.reference_inventory("p", 1).unwrap();
        let request = RetokenizeRequest {
            schema: 1,
            project: "p".into(),
            revision: 1,
            snapshot_hash: inv.snapshot_hash.clone(),
            config_hash: inv.config_hash.clone(),
            inventory_hash: digest(&inv).unwrap(),
            document: DOC.into(),
            targets: vec![inv
                .ids
                .iter()
                .find(|t| t.artifact == DOC && t.id == "w1")
                .unwrap()
                .clone()],
            replacement: vec![
                Reading {
                    id: "a".into(),
                    original: "ab".into(),
                    corrected: None,
                    normalized: None,
                },
                Reading {
                    id: "b".into(),
                    original: "cd".into(),
                    corrected: None,
                    normalized: None,
                },
            ],
            relation_endpoint: None,
        };
        assert!(
            !s.retokenization_preview(&request)
                .unwrap()
                .execution_enabled
        );
    }
    let altered = SETTINGS.replace("//text", "//*[@id='w1']");
    let (_tmp, s) = fixture(&altered, &[(DEFINITION_PATH, DEFINITION)]);
    assert!(!s.teitok_reader_preview("p", 1).unwrap().enabled);
}
#[test]
fn installation_fault_boundaries_recover_both_files_as_one_revision() {
    for fault in [Fault::AfterStage, Fault::BeforeCommit, Fault::AfterCommit] {
        let (tmp, mut s) = fixture("<ttsettings/>", &[]);
        let c = install(&s, "fault");
        assert!(s.apply("local-owner", &c, fault).is_err());
        drop(s);
        let mut s = Store::open(&tmp.path().join("authority")).unwrap();
        let committed = fault == Fault::AfterCommit;
        assert_eq!(s.head("p").unwrap().id, if committed { 2 } else { 1 });
        assert_eq!(
            s.view("p", None)
                .unwrap()
                .snapshot
                .files
                .contains_key(DEFINITION_PATH),
            committed
        );
        assert_eq!(s.apply("local-owner", &c, Fault::None).unwrap().id, 2);
        assert_eq!(s.history("p").unwrap().len(), 2);
    }
}

#[test]
fn literal_schema_keys_do_not_become_document_references_when_ids_match() {
    let (tmp, initial) = fixture(SETTINGS, &[(DEFINITION_PATH, DEFINITION)]);
    drop(initial);
    let input = tmp.path().join("package");
    for name in [DOC, "Annotations/review_demo.xml"] {
        let path = input.join(name);
        let text = fs::read_to_string(&path).unwrap().replace("w1", "form");
        fs::write(&path, text).unwrap();
    }
    let mut s = Store::open(&tmp.path().join("literal-authority")).unwrap();
    s.import(&input, "p").unwrap();
    let c = split_on(&s, "form");
    s.apply("local-owner", &c, Fault::None).unwrap();
    let view = s.view("p", None).unwrap();
    assert_eq!(
        s.objects.text(&view.snapshot, SETTINGS_PATH).unwrap(),
        SETTINGS
    );
    assert_eq!(
        s.objects.text(&view.snapshot, DEFINITION_PATH).unwrap(),
        DEFINITION
    );
    assert_eq!(
        view.documents[0].spans[0].token_ids,
        vec!["part-a", "part-b"]
    );
}
#[test]
fn installed_reader_blocks_structural_edits_of_undeclared_annotation_families() {
    let (_known_tmp, known) = fixture(SETTINGS, &[(DEFINITION_PATH, DEFINITION)]);
    let command = split(&known);
    let Operation::Retokenize { request, .. } = command.operations[0].clone() else {
        panic!("expected structural operation")
    };
    for unsupported in [
        "Annotations/foreign_demo.xml",
        "Annotations/review_extra_demo.xml",
        "Annotations/review_extra/sub_demo.xml",
        "Annotations/REVIEW_demo.xml",
    ] {
        let mut request = request.clone();
        let (_tmp, s) = fixture(
            SETTINGS,
            &[
                (DEFINITION_PATH, DEFINITION),
                (
                    unsupported,
                    "<spanGrp><span id='foreign' corresp='#w1' label='retain'/></spanGrp>",
                ),
            ],
        );
        let inventory = s.reference_inventory("p", 1).unwrap();
        request.snapshot_hash = inventory.snapshot_hash.clone();
        request.config_hash = inventory.config_hash.clone();
        request.inventory_hash = digest(&inventory).unwrap();
        let before = s.view("p", None).unwrap().snapshot;
        let objects = fs::read_dir(&s.objects.root).unwrap().count();
        let reader = s.teitok_reader_preview("p", 1).unwrap();
        assert!(reader.installed && !reader.enabled);
        let preview = s.retokenization_preview(&request).unwrap();
        assert!(!preview.execution_enabled);
        assert!(preview
            .blockers
            .iter()
            .any(|value| value.contains("other annotation families")));
        assert_eq!(s.view("p", None).unwrap().snapshot, before);
        assert_eq!(fs::read_dir(&s.objects.root).unwrap().count(), objects);
    }
}
#[test]
fn reader_requires_portable_case_exact_direct_transcript_paths() {
    for noncanonical in [
        "XMLFILES/demo.xml",
        "xmlfiles/demo.XML",
        "xmlfiles/nested/demo.xml",
    ] {
        let (tmp, initial) = fixture(SETTINGS, &[(DEFINITION_PATH, DEFINITION)]);
        let command = split(&initial);
        let Operation::Retokenize { mut request, .. } = command.operations[0].clone() else {
            panic!("expected structural operation")
        };
        drop(initial);
        let package = tmp.path().join("package");
        let text = fs::read(package.join(DOC)).unwrap();
        fs::remove_dir_all(package.join("xmlfiles")).unwrap();
        fs::remove_file(package.join("Annotations/review_demo.xml")).unwrap();
        let target = package.join(noncanonical);
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(target, text).unwrap();
        let mut s = Store::open(&tmp.path().join("noncanonical-authority")).unwrap();
        s.import(&package, "p").unwrap();
        let inv = s.reference_inventory("p", 1).unwrap();
        request.snapshot_hash = inv.snapshot_hash.clone();
        request.config_hash = inv.config_hash.clone();
        request.inventory_hash = digest(&inv).unwrap();
        request.document = noncanonical.into();
        request.targets = vec![inv
            .ids
            .iter()
            .find(|t| t.artifact == noncanonical && t.id == "w1")
            .unwrap()
            .clone()];
        let reader = s.teitok_reader_preview("p", 1).unwrap();
        assert!(reader.installed && !reader.enabled);
        assert!(reader.blockers.iter().any(|b| b.contains("case-exact")));
        let before = s.view("p", None).unwrap().snapshot;
        let count = fs::read_dir(&s.objects.root).unwrap().count();
        assert!(
            !s.retokenization_preview(&request)
                .unwrap()
                .execution_enabled
        );
        assert_eq!(s.view("p", None).unwrap().snapshot, before);
        assert_eq!(fs::read_dir(&s.objects.root).unwrap().count(), count);
    }
}
#[test]
fn exhausted_configuration_version_blocks_without_staging_or_panicking() {
    let (tmp, initial) = fixture("<ttsettings/>", &[]);
    drop(initial);
    let input = tmp.path().join("package");
    fs::create_dir(input.join("Workbench")).unwrap();
    let config = Config {
        version: u32::MAX,
        ..Config::default()
    };
    fs::write(
        input.join("Workbench/definitions.json"),
        serde_json::to_vec(&config).unwrap(),
    )
    .unwrap();
    let mut s = Store::open(&tmp.path().join("exhausted-authority")).unwrap();
    s.import(&input, "p").unwrap();
    let count = fs::read_dir(&s.objects.root).unwrap().count();
    assert!(!s.teitok_reader_preview("p", 1).unwrap().enabled);
    let c = install(&s, "exhausted");
    assert!(s
        .apply("local-owner", &c, Fault::None)
        .unwrap_err()
        .to_string()
        .contains("exhausted"));
    assert_eq!(fs::read_dir(&s.objects.root).unwrap().count(), count);
    assert_eq!(s.head("p").unwrap().id, 1);
}
