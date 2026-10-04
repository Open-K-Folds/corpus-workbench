use corpus_workbench::{package, store::Store};
use std::fs;
use tempfile::TempDir;
fn backup(temp: &TempDir) -> std::path::PathBuf {
    let source = temp.path().join("package");
    fs::create_dir_all(source.join("Resources")).unwrap();
    fs::create_dir_all(source.join("xmlfiles")).unwrap();
    fs::write(source.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        source.join("xmlfiles/test.xml"),
        "<TEI><text><tok id='w-1'>synthetic</tok></text></TEI>",
    )
    .unwrap();
    let mut live = Store::open(&temp.path().join("live")).unwrap();
    live.import(&source, "test").unwrap();
    let target = temp.path().join("closed backup #1");
    live.backup(&target).unwrap();
    target
}
#[test]
fn readonly_closed_backup_is_verified_without_changes_and_can_restore_fresh_clone() {
    let temp = TempDir::new().unwrap();
    let root = backup(&temp);
    let database_hash = package::hash(&fs::read(root.join("ledger.sqlite")).unwrap());
    let store = Store::open_backup_readonly(&root).unwrap();
    assert!(store.conn.execute("DELETE FROM projects", []).is_err());
    let head = store.head("test").unwrap();
    let clone = temp.path().join("clone");
    store.backup(&clone).unwrap();
    drop(store);
    assert_eq!(
        package::hash(&fs::read(root.join("ledger.sqlite")).unwrap()),
        database_hash
    );
    assert!(!root.join("ledger.sqlite-wal").exists());
    assert!(!root.join("ledger.sqlite-shm").exists());
    assert_eq!(
        Store::open(&clone)
            .unwrap()
            .head("test")
            .unwrap()
            .snapshot_hash,
        head.snapshot_hash
    );
}
#[test]
fn readonly_backup_refuses_sidecars_legacy_future_and_incomplete_roots() {
    let temp = TempDir::new().unwrap();
    let root = backup(&temp);
    fs::write(root.join("ledger.sqlite-wal"), b"").unwrap();
    assert!(Store::open_backup_readonly(&root).is_err());
    fs::remove_file(root.join("ledger.sqlite-wal")).unwrap();
    fs::write(root.join("ledger.sqlite-shm"), b"").unwrap();
    assert!(Store::open_backup_readonly(&root).is_err());
    fs::remove_file(root.join("ledger.sqlite-shm")).unwrap();
    for version in [1, 3] {
        let db = rusqlite::Connection::open(root.join("ledger.sqlite")).unwrap();
        db.pragma_update(None, "user_version", version).unwrap();
        drop(db);
        assert!(Store::open_backup_readonly(&root).is_err());
    }
    let missing = temp.path().join("absent");
    assert!(Store::open_backup_readonly(&missing).is_err());
    assert!(!missing.exists());
}
#[test]
fn readonly_backup_rejects_committed_object_corruption() {
    let temp = TempDir::new().unwrap();
    let root = backup(&temp);
    let store = Store::open_backup_readonly(&root).unwrap();
    let hash = store.head("test").unwrap().snapshot_hash;
    drop(store);
    fs::write(root.join("objects").join(hash), b"tampered").unwrap();
    assert!(Store::open_backup_readonly(&root).is_err());
}
