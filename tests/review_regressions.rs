use corpus_workbench::{
    model::{Command, Config, Operation, Snapshot},
    package,
    store::{Fault, Store},
};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;

fn fixture() -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        input.join("xmlfiles/demo.xml"),
        "<TEI><text><u id='u-1'><tok id='w-1' form='abc'>abc</tok></u></text></TEI>",
    )
    .unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    store.import(&input, "p").unwrap();
    (tmp, store)
}

#[test]
fn supplied_workbench_metadata_and_all_receipt_hashes_survive_repeated_export() {
    let (tmp, _) = fixture();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Workbench")).unwrap();
    let mut defs = serde_json::to_value(Config::default()).unwrap();
    defs["unknown_extension"] = serde_json::json!({"research_value":"must survive"});
    let original = serde_json::to_vec(&defs).unwrap();
    fs::write(input.join("Workbench/definitions.json"), &original).unwrap();
    fs::write(
        input.join("Workbench/export-receipt.json"),
        b"{\"imported_history\":\"retain\"}",
    )
    .unwrap();
    let mut source = input;
    for n in 0..3 {
        let mut s = Store::open(&tmp.path().join(format!("authority-{n}"))).unwrap();
        let revision = s.import(&source, "p").unwrap();
        if n == 0 {
            s.apply(
                "local-owner",
                &Command {
                    schema: 1,
                    project: "p".into(),
                    command_id: "define".into(),
                    base_revision: revision.id,
                    preimage_hash: revision.snapshot_hash,
                    config_version: 1,
                    label: "define".into(),
                    operations: vec![Operation::DefineLanguage {
                        value: "custom".into(),
                        description: "survive export".into(),
                    }],
                },
                Fault::None,
            )
            .unwrap();
        }
        assert_eq!(
            s.view("p", None).unwrap().snapshot.config.language_values["custom"],
            "survive export"
        );
        let output = tmp.path().join(format!("export-{n}"));
        s.export("p", s.head("p").unwrap().id, &output).unwrap();
        for (path, artifact) in s.snapshot(&s.head("p").unwrap()).unwrap().files {
            assert_eq!(
                package::hash(&fs::read(output.join(path)).unwrap()),
                artifact.sha256
            );
        }
        assert_eq!(
            fs::read(output.join("Workbench/definitions.json")).unwrap(),
            original
        );
        for entry in walkdir::WalkDir::new(output.join("Workbench/exports")) {
            let entry = entry.unwrap();
            if entry.file_name() == "export-receipt.json" {
                let value: serde_json::Value =
                    serde_json::from_slice(&fs::read(entry.path()).unwrap()).unwrap();
                let snapshot: Snapshot = serde_json::from_value(value["snapshot"].clone()).unwrap();
                for (path, artifact) in snapshot.files {
                    assert_eq!(
                        package::hash(&fs::read(output.join(path)).unwrap()),
                        artifact.sha256
                    );
                }
            }
        }
        source = output;
    }
}

#[test]
fn imported_impossible_or_incomplete_character_anchors_block_approval() {
    for fields in [
        "wb_start='99' wb_end='100' wb_quote='invented' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_status='resolved'",
        "wb_start='0' wb_end='1' wb_quote='wrong' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_status='resolved'",
        "wb_start='0'",
        "wb_start='0' wb_end='1' wb_quote='a' wb_coordinate='bytes' wb_layer='corrected' wb_status='resolved'",
    ] {
        let (tmp, _) = fixture();
        let input = tmp.path().join("input");
        fs::create_dir_all(input.join("Annotations")).unwrap();
        let original = format!("<spanGrp><span id='an-1' corresp='#w-1' {fields}>abc</span></spanGrp>");
        fs::write(input.join("Annotations/review_demo.xml"), &original).unwrap();
        let mut s = Store::open(&tmp.path().join("other")).unwrap();
        let rev = s.import(&input, "p").unwrap();
        assert!(s.view("p", None).unwrap().issues.iter().any(|i| i.code == "invalid-character-anchor" && i.blocking));
        assert!(s.review("local-owner", "p", rev.id, &rev.snapshot_hash, "approved", "").is_err());
        assert!(s.approved_contract("p", rev.id).is_err());
        let output = tmp.path().join("export");
        s.export("p", rev.id, &output).unwrap();
        assert_eq!(fs::read_to_string(output.join("Annotations/review_demo.xml")).unwrap(), original);
    }
}

#[test]
fn concurrent_identical_requests_return_one_committed_revision() {
    let (tmp, mut first) = fixture();
    let rev = first.head("p").unwrap();
    let cmd = Command {
        schema: 1,
        project: "p".into(),
        command_id: "same".into(),
        base_revision: rev.id,
        preimage_hash: rev.snapshot_hash,
        config_version: 1,
        label: "same".into(),
        operations: vec![Operation::SetToken {
            document: "xmlfiles/demo.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("nform".into(), "corrected".into())]),
        }],
    };
    assert!(first.apply("local-owner", &cmd, Fault::AfterStage).is_err());
    let mut second = Store::open(&tmp.path().join("authority")).unwrap();
    let lock = rusqlite::Connection::open(tmp.path().join("authority/ledger.sqlite")).unwrap();
    lock.execute_batch("BEGIN IMMEDIATE").unwrap();
    let a = cmd.clone();
    let one = std::thread::spawn(move || first.apply("local-owner", &a, Fault::None).unwrap().id);
    let two =
        std::thread::spawn(move || second.apply("local-owner", &cmd, Fault::None).unwrap().id);
    std::thread::sleep(std::time::Duration::from_millis(250));
    lock.execute_batch("COMMIT").unwrap();
    assert_eq!(one.join().unwrap(), two.join().unwrap());
    assert_eq!(
        Store::open(&tmp.path().join("authority"))
            .unwrap()
            .history("p")
            .unwrap()
            .len(),
        2
    );
}
