use corpus_workbench::{
    model::*,
    store::{Fault, Store},
};
use std::{collections::BTreeMap, fs, process::Command as Process};
use tempfile::TempDir;
fn crash_case(point: &str, committed: bool) {
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("package");
    fs::create_dir_all(source.join("Resources")).unwrap();
    fs::create_dir_all(source.join("xmlfiles")).unwrap();
    fs::write(source.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        source.join("xmlfiles/test.xml"),
        "<TEI><text><u id='u-1'><tok id='w-1' form='original'>original</tok></u></text></TEI>",
    )
    .unwrap();
    let authority = temp.path().join("authority");
    let mut store = Store::open(&authority).unwrap();
    store.import(&source, "test").unwrap();
    let view = store.view("test", None).unwrap();
    let cmd = Command {
        schema: 1,
        project: "test".into(),
        command_id: "crash-retry".into(),
        base_revision: view.revision.id,
        preimage_hash: view.revision.snapshot_hash,
        config_version: 1,
        label: "Crash test".into(),
        operations: vec![Operation::SetToken {
            document: "xmlfiles/test.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("nform".into(), "acknowledged".into())]),
        }],
    };
    let file = temp.path().join("command.json");
    fs::write(&file, serde_json::to_vec(&cmd).unwrap()).unwrap();
    drop(store);
    let result = Process::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .arg("apply")
        .arg("--store")
        .arg(&authority)
        .arg("--command")
        .arg(&file)
        .arg("--fault")
        .arg(point)
        .env("WORKBENCH_TEST_HARD_CRASH", "yes")
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(73));
    let mut store = Store::open(&authority).unwrap();
    assert_eq!(
        store.history("test").unwrap().len(),
        if committed { 2 } else { 1 }
    );
    let rev = store.apply("local-owner", &cmd, Fault::None).unwrap();
    assert_eq!(store.head("test").unwrap().id, rev.id);
    assert_eq!(store.history("test").unwrap().len(), 2);
    assert_eq!(
        store.view("test", None).unwrap().documents[0].tokens[0]
            .corrected
            .as_deref(),
        Some("acknowledged")
    );
}
#[test]
fn abrupt_process_exit_after_blob_stage_restarts_without_partial_head() {
    crash_case("after-stage", false)
}
#[test]
fn abrupt_process_exit_inside_transaction_rolls_back() {
    crash_case("before-commit", false)
}
#[test]
fn abrupt_process_exit_after_commit_preserves_acknowledged_save_and_retry() {
    crash_case("after-commit", true)
}
