use corpus_workbench::{
    model::{Command, Operation, Snapshot},
    package,
    store::{Fault, Store},
};
use std::fs;
use tempfile::TempDir;

fn exported() -> (TempDir, std::path::PathBuf, std::path::PathBuf) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        input.join("xmlfiles/demo.xml"),
        "<TEI><text><tok id='w-1' form='abc'>abc</tok></text></TEI>",
    )
    .unwrap();
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    let r = s.import(&input, "p").unwrap();
    s.apply(
        "local-owner",
        &Command {
            schema: 1,
            project: "p".into(),
            command_id: "define".into(),
            base_revision: r.id,
            preimage_hash: r.snapshot_hash,
            config_version: 1,
            label: "Define custom".into(),
            operations: vec![
                Operation::DefineLanguage {
                    value: "custom".into(),
                    description: "must retain".into(),
                },
                Operation::SetLanguageDefault {
                    value: Some("custom".into()),
                },
            ],
        },
        Fault::None,
    )
    .unwrap();
    let out = tmp.path().join("export");
    s.export("p", s.head("p").unwrap().id, &out).unwrap();
    let receipt = walkdir::WalkDir::new(out.join("Workbench/exports"))
        .into_iter()
        .map(|e| e.unwrap())
        .find(|e| e.file_name() == "export-receipt.json")
        .unwrap()
        .into_path();
    (tmp, out, receipt)
}

#[test]
fn reject_changed_receipt_config_with_incorrect_revision_hash() {
    let (tmp, out, receipt) = exported();
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    let original = value["revision"]["snapshot_hash"]
        .as_str()
        .unwrap()
        .to_string();
    value["snapshot"]["config"]["rights"] = serde_json::json!("tampered unrestricted rights");
    value["snapshot"]["config"]["language_default"] = serde_json::json!(null);
    let changed: Snapshot = serde_json::from_value(value["snapshot"].clone()).unwrap();
    assert_ne!(
        package::hash(&serde_json::to_vec(&changed).unwrap()),
        original
    );
    fs::write(&receipt, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
    let mut imported = Store::open(&tmp.path().join("imported")).unwrap();
    assert!(
        imported.import(&out, "p").is_err(),
        "Tampered config must not be trusted"
    );
}

#[test]
fn reject_external_xml_edit_requiring_lineage_reconciliation() {
    let (tmp, out, _) = exported();
    let path = out.join("xmlfiles/demo.xml");
    let edited = fs::read_to_string(&path)
        .unwrap()
        .replace("form='abc'", "form='abc' nform='corrected externally'");
    fs::write(&path, &edited).unwrap();
    let mut imported = Store::open(&tmp.path().join("imported")).unwrap();
    assert!(
        imported.import(&out, "p").is_err(),
        "External edit must explicitly require reconciliation"
    );
    assert_eq!(
        fs::read_to_string(path).unwrap(),
        edited,
        "User source must remain untouched"
    );
}

#[test]
fn reject_changed_history_object_under_original_hash_filename() {
    let (tmp, out, receipt) = exported();
    let history = receipt.parent().unwrap().join("history-objects");
    let entry = fs::read_dir(&history).unwrap().next().unwrap().unwrap();
    let name = entry.file_name().into_string().unwrap();
    let edited = b"tampered history object";
    assert_ne!(package::hash(edited), name);
    fs::write(entry.path(), edited).unwrap();
    let mut imported = Store::open(&tmp.path().join("imported")).unwrap();
    assert!(
        imported.import(&out, "p").is_err(),
        "Tampered historical object must be rejected"
    );
}

#[test]
fn reject_invalid_or_missing_managed_receipt_without_config_fallback() {
    for remove in [false, true] {
        let (tmp, out, receipt) = exported();
        if remove {
            fs::remove_file(receipt).unwrap()
        } else {
            let mut value: serde_json::Value =
                serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
            value["snapshot"] = serde_json::Value::Null;
            fs::write(receipt, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        }
        let mut imported = Store::open(&tmp.path().join("imported")).unwrap();
        assert!(
            imported.import(&out, "p").is_err(),
            "Incomplete managed receipt must not silently fall back; removed={remove}"
        );
    }
}

#[test]
fn require_declared_historical_snapshot_object() {
    let (tmp, out, receipt) = exported();
    let value: serde_json::Value = serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    let prior = value["history"].as_array().unwrap().last().unwrap()["snapshot_hash"]
        .as_str()
        .unwrap();
    let object = receipt
        .parent()
        .unwrap()
        .join("history-objects")
        .join(prior);
    assert!(object.exists());
    fs::remove_file(object).unwrap();
    let mut imported = Store::open(&tmp.path().join("imported")).unwrap();
    assert!(
        imported.import(&out, "p").is_err(),
        "Declared historical snapshot missing from complete managed export"
    );
}

#[test]
fn concurrent_identical_requests_without_prestaging() {
    let mut errors = Vec::new();
    for n in 0..24 {
        let (tmp, out, _) = exported();
        let root = tmp.path().join("concurrent");
        let mut first = Store::open(&root).unwrap();
        let revision = first.import(&out, "p").unwrap();
        let mut second = Store::open(&root).unwrap();
        let operations = (0..100)
            .map(|i| Operation::DefineLanguage {
                value: format!("custom-{i}"),
                description: "x".repeat(2048),
            })
            .collect();
        let c = Command {
            schema: 1,
            project: "p".into(),
            command_id: "concurrent".into(),
            base_revision: revision.id,
            preimage_hash: revision.snapshot_hash,
            config_version: first.view("p", None).unwrap().snapshot.config.version,
            label: "Concurrent stress".into(),
            operations,
        };
        let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
        let other_gate = gate.clone();
        let other_c = c.clone();
        let a = std::thread::spawn(move || {
            gate.wait();
            first
                .apply("local-owner", &c, Fault::None)
                .map(|r| r.id)
                .map_err(|e| e.to_string())
        });
        let b = std::thread::spawn(move || {
            other_gate.wait();
            second
                .apply("local-owner", &other_c, Fault::None)
                .map(|r| r.id)
                .map_err(|e| e.to_string())
        });
        let results = [a.join().unwrap(), b.join().unwrap()];
        for result in results {
            if let Err(error) = result {
                errors.push(format!("trial {n}: {error}"));
            }
        }
    }
    assert!(
        errors.is_empty(),
        "Concurrent duplicate requests failed without prestaging: {errors:?}"
    );
}
