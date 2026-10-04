use corpus_workbench::store::Store;
use rusqlite::Connection;
use std::{fs, process::Command};
use tempfile::TempDir;

fn legacy(temp: &TempDir) -> std::path::PathBuf {
    let source = temp.path().join("package");
    fs::create_dir_all(source.join("xmlfiles")).unwrap();
    fs::create_dir_all(source.join("Resources")).unwrap();
    fs::write(source.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        source.join("xmlfiles/test.xml"),
        "<TEI><text><tok id='w-1'>synthetic</tok></text></TEI>",
    )
    .unwrap();
    let root = temp.path().join("authority");
    let mut store = Store::open(&root).unwrap();
    store.import(&source, "test").unwrap();
    store
        .conn
        .execute_batch("DROP TABLE derived_generations; PRAGMA user_version=1;")
        .unwrap();
    root
}
#[test]
fn migration_abrupt_exit_keeps_legacy_schema_and_exact_revision() {
    let temp = TempDir::new().unwrap();
    let root = legacy(&temp);
    let old = Store::open(&root).unwrap().head("test").unwrap();
    Connection::open(root.join("ledger.sqlite"))
        .unwrap()
        .execute_batch("DROP TABLE derived_generations; PRAGMA user_version=1;")
        .unwrap();
    let child = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["check", "--store"])
        .arg(&root)
        .env("WORKBENCH_TEST_SCHEMA_HARD_CRASH", "yes")
        .output()
        .unwrap();
    assert_eq!(child.status.code(), Some(73));
    let db = Connection::open(root.join("ledger.sqlite")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='derived_generations'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    drop(db);
    let reopened = Store::open(&root).unwrap();
    assert_eq!(
        reopened.head("test").unwrap().snapshot_hash,
        old.snapshot_hash
    );
    assert_eq!(reopened.history("test").unwrap().len(), 1);
    assert!(reopened.snapshot(&old).is_ok());
}
#[test]
fn fresh_migration_crash_rolls_back_all_tables_then_recovers() {
    let temp = TempDir::new().unwrap();
    let root = temp.path().join("authority");
    let child = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["view", "--store"])
        .arg(&root)
        .env("WORKBENCH_TEST_SCHEMA_HARD_CRASH", "yes")
        .output()
        .unwrap();
    assert_eq!(child.status.code(), Some(73));
    let db = Connection::open(root.join("ledger.sqlite")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    drop(db);
    assert!(Store::open(&root).unwrap().projects().unwrap().is_empty());
}
#[test]
fn concurrent_legacy_open_serializes_migration_without_new_revision() {
    let temp = TempDir::new().unwrap();
    let root = legacy(&temp);
    let mut children = vec![];
    for _ in 0..2 {
        children.push(
            Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
                .args(["check", "--store"])
                .arg(&root)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap(),
        );
    }
    for child in children {
        let result = child.wait_with_output().unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    assert_eq!(
        Store::open(&root).unwrap().history("test").unwrap().len(),
        1
    );
}
#[test]
fn future_schema_and_check_missing_authority_fail_without_creating_a_ledger() {
    let temp = TempDir::new().unwrap();
    let missing = temp.path().join("missing");
    assert!(!Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["check", "--store"])
        .arg(&missing)
        .output()
        .unwrap()
        .status
        .success());
    assert!(!missing.exists());
    let root = legacy(&temp);
    let db = Connection::open(root.join("ledger.sqlite")).unwrap();
    db.pragma_update(None, "journal_mode", "DELETE").unwrap();
    db.pragma_update(None, "user_version", 3).unwrap();
    drop(db);
    let before = fs::read(root.join("ledger.sqlite")).unwrap();
    assert!(Store::open(&root).is_err());
    assert_eq!(fs::read(root.join("ledger.sqlite")).unwrap(), before);
    assert!(!root.join("ledger.sqlite-wal").exists());
    let db = Connection::open(root.join("ledger.sqlite")).unwrap();
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    assert_eq!(
        db.query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "delete"
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='derived_generations'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}
