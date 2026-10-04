use rusqlite::Connection;

#[test]
fn actual_bundled_sqlite_matches_qualified_engine() {
    // Cargo advisory tools identify the wrapper crate, not the bundled C engine.
    // Falsify accidental linkage to an older OS SQLite or a changed crate bundle.
    assert_eq!(rusqlite::version(), "3.53.2");
    let connection = Connection::open_in_memory().unwrap();
    let reported: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .unwrap();
    assert_eq!(reported, "3.53.2");
}
