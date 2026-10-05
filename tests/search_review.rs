//! Independent synthetic falsification of exact-revision concordance contracts.
use corpus_workbench::{
    model::*,
    package,
    search::{Mode, Query, Reading, Resolve, Term},
    store::{Fault, Store},
};
use serde_json::json;
use std::{collections::BTreeMap, fs, path::PathBuf};
use tempfile::TempDir;

const DOC: &str = "xmlfiles/demo.xml";
const XML: &str = "<?xml version='1.0'?>\n<TEI xmlns:x='urn:synthetic'><teiHeader><media url='synthetic.wav'/></teiHeader><text><!--keep--><u id='u1' start='1' end='4'><tok id='w1' form='alpha' nform='ALPHA' x:note='keep'>alpha</tok> <tok id='w2' form='beta'>beta</tok> <tok id='w3' form='alpha'>alpha</tok></u></text></TEI>\n";

struct Case {
    _tmp: TempDir,
    package: PathBuf,
    store: Store,
}
impl Case {
    fn new(xml: &str) -> Self {
        let tmp = TempDir::new().unwrap();
        let input = tmp.path().join("package");
        for part in ["xmlfiles", "Resources", "Audio", "Video", "Raw", "CWB"] {
            fs::create_dir_all(input.join(part)).unwrap();
        }
        fs::write(input.join(DOC), xml).unwrap();
        fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
        fs::write(input.join("Audio/synthetic.wav"), b"RIFF synthetic only").unwrap();
        fs::write(input.join("Raw/asr.json"), b"{\"synthetic\":true}").unwrap();
        fs::write(input.join("CWB/offsets"), b"unverified opaque index").unwrap();
        let mut store = Store::open(&tmp.path().join("authority")).unwrap();
        store.import(&input, "p").unwrap();
        Self {
            _tmp: tmp,
            package: input,
            store,
        }
    }
    fn query(&self, words: &[&str]) -> Query {
        let head = self.store.head("p").unwrap();
        Query {
            schema: 1,
            project: "p".into(),
            revision: head.id,
            snapshot_hash: head.snapshot_hash,
            mode: Mode::Current,
            reading: Reading::Original,
            terms: words
                .iter()
                .map(|text| Term {
                    text: (*text).into(),
                    language: None,
                })
                .collect(),
            documents: vec![],
            context: 1,
            offset: 0,
            limit: 1,
        }
    }
    fn edit(&mut self, op: Operation, id: &str) -> Revision {
        let before = self.store.view("p", None).unwrap();
        self.store
            .apply(
                "local-owner",
                &Command {
                    schema: 1,
                    project: "p".into(),
                    command_id: id.into(),
                    base_revision: before.revision.id,
                    preimage_hash: before.revision.snapshot_hash,
                    config_version: before.snapshot.config.version,
                    label: "Synthetic review change".into(),
                    operations: vec![op],
                },
                Fault::None,
            )
            .unwrap()
    }
}

#[test]
fn every_result_binding_and_page_component_is_verified_on_resolution() {
    let case = Case::new(XML);
    let q = case.query(&["alpha"]);
    let page = case.store.search(&q).unwrap();
    let good = Resolve {
        query: q.clone(),
        result_hash: page.result_hash.clone(),
        hit_id: page.result.hits[0].id.clone(),
    };
    assert!(case.store.resolve_search_hit(&good).is_ok());
    let mut forged = good.clone();
    forged.result_hash = "0".repeat(64);
    assert!(case.store.resolve_search_hit(&forged).is_err());
    forged = good.clone();
    forged.hit_id = "0".repeat(64);
    assert!(case.store.resolve_search_hit(&forged).is_err());
    for (name, value) in [
        ("mode", json!("historical")),
        ("reading", json!("corrected")),
        ("context", json!(0)),
        ("offset", json!(1)),
        ("limit", json!(2)),
        ("documents", json!([DOC])),
        ("snapshot_hash", json!("0".repeat(64))),
    ] {
        let mut changed = serde_json::to_value(&good).unwrap();
        changed["query"][name] = value;
        let changed: Resolve = serde_json::from_value(changed).unwrap();
        assert!(case.store.resolve_search_hit(&changed).is_err(), "{name}");
    }
    let mut next_query = q;
    next_query.offset = 1;
    let next = case.store.search(&next_query).unwrap();
    let mut outside_page = good;
    outside_page.hit_id = next.result.hits[0].id.clone();
    assert!(case.store.resolve_search_hit(&outside_page).is_err());
}

#[test]
fn same_token_ids_in_another_project_do_not_confer_result_or_revision_access() {
    let mut case = Case::new(XML);
    let q = case.query(&["alpha"]);
    let page = case.store.search(&q).unwrap();
    let foreign = case.store.import(&case.package, "other").unwrap();
    let mut wrong = q.clone();
    wrong.project = "other".into();
    wrong.mode = Mode::Historical;
    assert!(case.store.search(&wrong).is_err());
    wrong.revision = foreign.id;
    assert!(case.store.search(&wrong).is_err());
    wrong.snapshot_hash = foreign.snapshot_hash;
    let other = case.store.search(&wrong).unwrap();
    assert_ne!(other.result.hits[0].id, page.result.hits[0].id);
    assert!(case
        .store
        .resolve_search_hit(&Resolve {
            query: wrong,
            result_hash: page.result_hash,
            hit_id: other.result.hits[0].id.clone(),
        })
        .is_err());
}

#[test]
fn restore_to_identical_bytes_still_requires_a_fresh_revision_proof() {
    let mut case = Case::new(XML);
    let q = case.query(&["alpha"]);
    case.edit(
        Operation::SetToken {
            document: DOC.into(),
            token: "w1".into(),
            fields: BTreeMap::from([("nform".into(), "changed".into())]),
        },
        "change",
    );
    let first_restore = case.edit(
        Operation::Restore {
            revision: q.revision,
        },
        "restore",
    );
    let restored_query = case.query(&["alpha"]);
    let page = case.store.search(&restored_query).unwrap();
    let restored = case.edit(
        Operation::Restore {
            revision: q.revision,
        },
        "restore-again",
    );
    assert_eq!(restored.snapshot_hash, first_restore.snapshot_hash);
    let mut replay = restored_query;
    replay.revision = restored.id;
    let fresh = case.store.search(&replay).unwrap();
    assert_eq!(fresh.result.hits[0].id, page.result.hits[0].id);
    assert_ne!(fresh.result_hash, page.result_hash);
    assert!(case
        .store
        .resolve_search_hit(&Resolve {
            query: replay,
            result_hash: page.result_hash,
            hit_id: fresh.result.hits[0].id.clone(),
        })
        .is_err());
}

#[test]
fn strict_contracts_and_numeric_text_document_bounds_fail_closed() {
    let case = Case::new(XML);
    let good = serde_json::to_value(case.query(&["alpha"])).unwrap();
    for (key, value) in [
        ("schema", json!(2)),
        ("revision", json!(0)),
        ("context", json!(13)),
        ("limit", json!(0)),
        ("limit", json!(201)),
        ("offset", json!(100001)),
        ("terms", json!([])),
        ("terms", json!([{"text":"","language":null}])),
        ("terms", json!([{"text":"a\u{0}","language":null}])),
        ("terms", json!([{"text":"x".repeat(513),"language":null}])),
        ("terms", json!([{"text":"alpha","language":""}])),
        (
            "terms",
            json!([{"text":"alpha","language":"x".repeat(257)}]),
        ),
        ("documents", json!([DOC, DOC])),
        ("documents", json!(["xmlfiles/not-in-snapshot.xml"])),
    ] {
        let mut invalid = good.clone();
        invalid[key] = value;
        let q: Query = serde_json::from_value(invalid).unwrap();
        assert!(case.store.search(&q).is_err(), "{key}");
    }
    let mut too_many = case.query(&["alpha"]);
    too_many.terms = vec![too_many.terms[0].clone(); 9];
    assert!(case.store.search(&too_many).is_err());
    too_many = case.query(&["alpha"]);
    too_many.documents = (0..1001).map(|i| format!("xmlfiles/{i}.xml")).collect();
    assert!(case.store.search(&too_many).is_err());
    for path in [vec!["extra"], vec!["terms", "0", "extra"]] {
        let mut invalid = good.clone();
        let mut location = &mut invalid;
        for component in path {
            location = if let Ok(index) = component.parse::<usize>() {
                &mut location[index]
            } else {
                &mut location[component]
            };
        }
        *location = json!(true);
        assert!(serde_json::from_value::<Query>(invalid).is_err());
    }
    let mut resolve = json!({"query":good,"result_hash":"","hit_id":""});
    resolve["extra"] = json!(true);
    assert!(serde_json::from_value::<Resolve>(resolve).is_err());
}

#[test]
fn repeated_search_resolution_and_projection_leave_all_authority_data_unchanged() {
    let case = Case::new(XML);
    let before = case.store.view("p", None).unwrap();
    let ledger_before: Vec<i64> = [
        "projects",
        "revisions",
        "commands",
        "reviews",
        "derived_generations",
    ]
    .iter()
    .map(|table| {
        case.store
            .conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    })
    .collect();
    let object_names = || {
        let mut names: Vec<_> = fs::read_dir(&case.store.objects.root)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        names.sort();
        names
    };
    let before_names = object_names();
    let q = case.query(&["alpha"]);
    for _ in 0..3 {
        let page = case.store.search(&q).unwrap();
        case.store.search_projection(&q).unwrap();
        case.store
            .resolve_search_hit(&Resolve {
                query: q.clone(),
                result_hash: page.result_hash,
                hit_id: page.result.hits[0].id.clone(),
            })
            .unwrap();
    }
    let after = case.store.view("p", None).unwrap();
    assert_eq!(before.snapshot, after.snapshot);
    assert_eq!(before.revision.id, after.revision.id);
    assert_eq!(before_names, object_names());
    for (i, table) in [
        "projects",
        "revisions",
        "commands",
        "reviews",
        "derived_generations",
    ]
    .iter()
    .enumerate()
    {
        let count: i64 = case
            .store
            .conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, ledger_before[i]);
    }
    for (path, artifact) in before.snapshot.files {
        assert_eq!(
            fs::read(case.package.join(path)).unwrap(),
            case.store.objects.read(&artifact).unwrap()
        );
    }
}

#[test]
fn namespace_qualified_utterances_cannot_create_cross_utterance_phrases() {
    for xml in [
        "<TEI xmlns='urn:synthetic'><text><u id='u1'><tok id='w1' form='left'>left</tok></u><u id='u2'><tok id='w2' form='right'>right</tok></u></text></TEI>",
        "<t:TEI xmlns:t='urn:synthetic'><t:text><t:u id='u1'><t:tok id='w1' form='left'>left</t:tok></t:u><t:u id='u2'><t:tok id='w2' form='right'>right</t:tok></t:u></t:text></t:TEI>",
    ] {
        let case = Case::new(xml);
        // Either conservatively reject ambiguous projections or respect the actual boundary.
        if let Ok(page) = case.store.search(&case.query(&["left", "right"])) {
            assert_eq!(page.result.total, 0, "namespace-qualified u boundary lost: {:?}", page.result.hits);
        }
    }
}

#[test]
fn nested_tokens_cannot_count_the_same_source_body_twice_in_a_phrase() {
    let case = Case::new("<TEI><text><u id='u'><tok id='outer'>left<tok id='inner'>right</tok></tok></u></text></TEI>");
    if let Ok(page) = case.store.search(&case.query(&["leftright", "right"])) {
        assert_eq!(page.result.total, 0, "nested token body was double-counted");
    }
}

#[test]
fn ambiguous_media_basename_and_unproven_xml_base_do_not_get_audio_proofs() {
    let case = Case::new(XML);
    fs::write(
        case.package.join("Video/synthetic.wav"),
        b"other synthetic timeline",
    )
    .unwrap();
    let mut ambiguous = Store::open(&case._tmp.path().join("ambiguous")).unwrap();
    let r = ambiguous.import(&case.package, "p").unwrap();
    let mut q = case.query(&["alpha"]);
    q.revision = r.id;
    q.snapshot_hash = r.snapshot_hash;
    if let Ok(page) = ambiguous.search(&q) {
        assert!(
            page.result.hits[0].audio.is_none(),
            "two artifact scopes silently chose one"
        );
    }
    let base = Case::new(&XML.replace("<teiHeader>", "<teiHeader xml:base='Video/'>"));
    if let Ok(page) = base.store.search(&base.query(&["alpha"])) {
        assert!(
            page.result.hits[0].audio.is_none(),
            "unproven xml:base ignored"
        );
    }
}

#[test]
fn combined_xml_source_limit_is_enforced_before_projection() {
    let case = Case::new(XML);
    let large = format!(
        "<TEI><!--{}--><text><tok id='w' form='alpha'>alpha</tok></text></TEI>",
        "x".repeat(8 * 1024 * 1024)
    );
    for path in ["xmlfiles/large-a.xml", "xmlfiles/large-b.xml"] {
        fs::write(case.package.join(path), &large).unwrap();
    }
    let mut large_store = Store::open(&case._tmp.path().join("large")).unwrap();
    let r = large_store.import(&case.package, "p").unwrap();
    let mut q = case.query(&["alpha"]);
    q.revision = r.id;
    q.snapshot_hash = r.snapshot_hash;
    assert!(large_store
        .search(&q)
        .unwrap_err()
        .to_string()
        .contains("size limit"));
    assert!(large_store.search_projection(&q).is_err());
}

#[test]
fn result_size_limit_does_not_allow_large_original_fields_through_small_corrected_hits() {
    let xml = format!(
        "<TEI><text><u id='u'>{}</u></text></TEI>",
        (0..100)
            .map(|i| format!(
                "<tok id='w{i}' form='{}' nform='small'/>",
                "x".repeat(60000)
            ))
            .collect::<String>()
    );
    let case = Case::new(&xml);
    let mut q = case.query(&["small"]);
    q.reading = Reading::Corrected;
    q.limit = 100;
    q.context = 0;
    assert!(case
        .store
        .search(&q)
        .unwrap_err()
        .to_string()
        .contains("result size limit"));
    q.limit = 1;
    let page = case.store.search(&q).unwrap();
    assert_eq!(page.result.total, 100);
    if let Ok(resolved) = case.store.resolve_search_hit(&Resolve {
        query: q,
        result_hash: page.result_hash,
        hit_id: page.result.hits[0].id.clone(),
    }) {
        assert!(
            serde_json::to_vec(&resolved).unwrap().len() <= 4 * 1024 * 1024,
            "a bounded hit resolution leaked an unbounded full-corpus response"
        );
    }
}

#[test]
fn namespaced_status_is_inert_and_unresolved_normalization_is_not_searchable() {
    let xml="<TEI xmlns:x='urn:synthetic'><text><tok id='w' form='raw' nform='corrected' wb_normalized='obsolete' wb_normalized_status='unresolved' x:wb_normalized_status='resolved'/></text></TEI>";
    let case = Case::new(xml);
    let mut q = case.query(&["obsolete"]);
    q.reading = Reading::Normalized;
    assert_eq!(case.store.search(&q).unwrap().result.total, 0);
    q.terms[0].text = "corrected".into();
    assert_eq!(case.store.search(&q).unwrap().result.total, 1);
    assert_eq!(
        package::hash(xml.as_bytes()),
        case.store.view("p", None).unwrap().snapshot.files[DOC].sha256
    );
}

// SQLite PROFILE is a synchronous observer, not a production hook. It holds one
// exact existing read boundary while another connection commits a synthetic edit.
fn current_read_race(kind: &str, observed_view: usize) {
    use rusqlite::ffi;
    use std::{
        ffi::{c_void, CStr},
        sync::mpsc,
        thread,
        time::Duration,
    };
    struct Gate {
        prefix: &'static str,
        count: usize,
        target: usize,
        resumed: bool,
        start: mpsc::Sender<()>,
        resume: mpsc::Receiver<()>,
    }
    unsafe extern "C" fn trace(
        event: u32,
        context: *mut c_void,
        statement: *mut c_void,
        _time: *mut c_void,
    ) -> i32 {
        if event == ffi::SQLITE_TRACE_PROFILE {
            // SQLite invokes this on the registering thread with the still-live Box.
            let gate = unsafe { &mut *(context as *mut Gate) };
            let sql =
                unsafe { CStr::from_ptr(ffi::sqlite3_sql(statement as *mut ffi::sqlite3_stmt)) }
                    .to_string_lossy();
            if sql.starts_with(gate.prefix) {
                gate.count += 1;
                if gate.count == gate.target && gate.start.send(()).is_ok() {
                    gate.resumed = gate.resume.recv_timeout(Duration::from_secs(15)).is_ok();
                }
            }
        }
        0
    }
    let case = Case::new(XML);
    let q = case.query(&["alpha"]);
    let page = case.store.search(&q).unwrap();
    let before = case.store.view("p", None).unwrap();
    let cmd = Command {
        schema: 1,
        project: "p".into(),
        command_id: "concurrent-change".into(),
        base_revision: before.revision.id,
        preimage_hash: before.revision.snapshot_hash,
        config_version: before.snapshot.config.version,
        label: "Synthetic concurrent change".into(),
        operations: vec![Operation::SetToken {
            document: DOC.into(),
            token: "w2".into(),
            fields: BTreeMap::from([("nform".into(), "concurrent".into())]),
        }],
    };
    let root = case.store.root.clone();
    let (start_tx, start_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let worker = thread::spawn(move || {
        start_rx.recv_timeout(Duration::from_secs(15)).unwrap();
        let mut competing = Store::open(&root).unwrap();
        let result = competing.apply("local-owner", &cmd, Fault::None);
        resume_tx.send(()).unwrap();
        result
    });
    let mut gate = Box::new(Gate {
        prefix: if kind == "resolve" {
            "SELECT head FROM projects"
        } else {
            "SELECT decision FROM reviews"
        },
        count: 0,
        target: observed_view,
        resumed: false,
        start: start_tx,
        resume: resume_rx,
    });
    // Observer data remain alive until unregistration; no core source is altered.
    unsafe {
        assert_eq!(
            ffi::sqlite3_trace_v2(
                case.store.conn.handle(),
                ffi::SQLITE_TRACE_PROFILE,
                Some(trace),
                (&mut *gate as *mut Gate).cast(),
            ),
            ffi::SQLITE_OK
        );
    }
    let result = match kind {
        "search" => case.store.search(&q).map(|_| ()),
        "projection" => case.store.search_projection(&q).map(|_| ()),
        "resolve" => case
            .store
            .resolve_search_hit(&Resolve {
                query: q,
                result_hash: page.result_hash,
                hit_id: page.result.hits[0].id.clone(),
            })
            .map(|_| ()),
        _ => unreachable!(),
    };
    unsafe {
        ffi::sqlite3_trace_v2(case.store.conn.handle(), 0, None, std::ptr::null_mut());
    }
    assert_eq!(worker.join().unwrap().unwrap().id, 2);
    assert!(
        gate.count >= gate.target && gate.resumed,
        "race observer did not run"
    );
    assert!(result.unwrap_err().to_string().contains("stale"), "{kind}");
    assert_eq!(case.store.history("p").unwrap().len(), 2);
}

#[test]
fn concurrent_edit_during_search_rejects_current_result() {
    current_read_race("search", 1);
}

#[test]
fn concurrent_edit_during_hit_resolution_rejects_current_navigation() {
    current_read_race("resolve", 2);
}

#[test]
fn concurrent_edit_during_projection_rejects_current_derived_output() {
    current_read_race("projection", 1);
}

#[test]
fn actual_http_search_and_historical_media_keep_session_origin_and_project_scope() {
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        process::{Child, Command as Process, Stdio},
        thread,
        time::{Duration, Instant},
    };
    struct OwnedServer(Child);
    impl Drop for OwnedServer {
        fn drop(&mut self) {
            if self.0.try_wait().ok().flatten().is_none() {
                let _ = self.0.kill();
            }
            let _ = self.0.wait();
        }
    }
    fn request(
        port: u16,
        method: &str,
        path: &str,
        headers: &str,
        body: &[u8],
    ) -> (u16, String, Vec<u8>) {
        let mut tcp = TcpStream::connect(("127.0.0.1", port)).unwrap();
        tcp.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        tcp.set_write_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        write!(tcp,"{method} {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n",body.len()).unwrap();
        tcp.write_all(body).unwrap();
        let mut raw = Vec::new();
        tcp.read_to_end(&mut raw).unwrap();
        let header_end = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        let header = String::from_utf8(raw[..header_end].to_vec()).unwrap();
        let status = header.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, header, raw[header_end..].to_vec())
    }
    let mut case = Case::new(XML);
    let q = case.query(&["alpha"]);
    let other = case.store.import(&case.package, "other").unwrap();
    let server_dir = case._tmp.path().join("server");
    fs::create_dir_all(server_dir.join("ui")).unwrap();
    fs::write(
        server_dir.join("ui/index.html"),
        "<!doctype html><title>synthetic review only</title>",
    )
    .unwrap();
    let reservation = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = reservation.local_addr().unwrap().port();
    drop(reservation);
    let mut child = OwnedServer(
        Process::new(env!("CARGO_BIN_EXE_corpus-workbench"))
            .args([
                "serve",
                "--project",
                "p",
                "--port",
                &port.to_string(),
                "--ui",
                "ui",
                "--store",
            ])
            .arg(&case.store.root)
            .current_dir(&server_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if server_dir.join(".runtime/session-code").is_file() {
            break;
        }
        assert!(
            child.0.try_wait().unwrap().is_none(),
            "own synthetic server exited"
        );
        assert!(
            Instant::now() < deadline,
            "own synthetic server did not start"
        );
        thread::sleep(Duration::from_millis(20));
    }
    let origin = format!("http://127.0.0.1:{port}");
    let capability = fs::read_to_string(server_dir.join(".runtime/session-code")).unwrap();
    let login = serde_json::to_vec(&json!({"code":capability})).unwrap();
    assert_eq!(
        request(
            port,
            "POST",
            "/api/session",
            "Origin: http://wrong.invalid\r\n",
            &login
        )
        .0,
        403
    );
    let (status, headers, _) = request(
        port,
        "POST",
        "/api/session",
        &format!("Origin: {origin}\r\n"),
        &login,
    );
    assert_eq!(status, 200);
    assert!(headers.contains("HttpOnly") && headers.contains("SameSite=Strict"));
    let cookie = format!("Cookie: wb_session={capability}\r\n");
    let authenticated = format!(
        "{cookie}Origin: {origin}\r\nX-WB-CSRF: {capability}\r\nContent-Type: application/json\r\n"
    );
    let query = serde_json::to_vec(&q).unwrap();
    assert_eq!(request(port, "POST", "/api/search", "", &query).0, 403);
    assert_eq!(request(port, "POST", "/api/search", &cookie, &query).0, 403);
    let (status, _, body) = request(port, "POST", "/api/search", &authenticated, &query);
    assert_eq!(status, 200);
    let envelope: corpus_workbench::search::Envelope = serde_json::from_slice(&body).unwrap();
    let mut foreign = q.clone();
    foreign.project = "other".into();
    foreign.revision = other.id;
    foreign.snapshot_hash = other.snapshot_hash;
    assert_eq!(
        request(
            port,
            "POST",
            "/api/search",
            &authenticated,
            &serde_json::to_vec(&foreign).unwrap()
        )
        .0,
        403
    );
    let mut forged = Resolve {
        query: q.clone(),
        result_hash: envelope.result_hash,
        hit_id: "0".repeat(64),
    };
    assert_eq!(
        request(
            port,
            "POST",
            "/api/search/resolve",
            &authenticated,
            &serde_json::to_vec(&forged).unwrap()
        )
        .0,
        422
    );
    forged.hit_id = envelope.result.hits[0].id.clone();
    assert_eq!(
        request(
            port,
            "POST",
            "/api/search/resolve",
            &authenticated,
            &serde_json::to_vec(&forged).unwrap()
        )
        .0,
        200
    );
    let media_path = format!(
        "/api/media?revision={}&path=Audio/synthetic.wav",
        q.revision
    );
    assert_eq!(request(port, "GET", &media_path, "", &[]).0, 403);
    let (status, headers, bytes) = request(
        port,
        "GET",
        &media_path,
        &format!("{cookie}Range: bytes=0-3\r\n"),
        &[],
    );
    assert_eq!(status, 206);
    assert!(headers.contains("Content-Range: bytes 0-3/"));
    assert_eq!(bytes, b"RIFF");
    assert_eq!(
        request(
            port,
            "GET",
            &format!("/api/media?revision={}&path=Audio/synthetic.wav", other.id),
            &cookie,
            &[]
        )
        .0,
        422
    );
    assert_eq!(
        request(port, "GET", "/api/media?path=Raw/asr.json", &cookie, &[]).0,
        403
    );
    assert_eq!(
        request(
            port,
            "GET",
            "/api/media?path=../Audio/synthetic.wav",
            &cookie,
            &[]
        )
        .0,
        422
    );
    case.edit(
        Operation::SetToken {
            document: DOC.into(),
            token: "w1".into(),
            fields: BTreeMap::from([("nform".into(), "new".into())]),
        },
        "http-concurrent-change",
    );
    assert_eq!(
        request(port, "POST", "/api/search", &authenticated, &query).0,
        409
    );
    assert_eq!(
        request(
            port,
            "POST",
            "/api/search/resolve",
            &authenticated,
            &serde_json::to_vec(&forged).unwrap()
        )
        .0,
        409
    );
    let mut history = q;
    history.mode = Mode::Historical;
    let (status, _, body) = request(
        port,
        "POST",
        "/api/search",
        &authenticated,
        &serde_json::to_vec(&history).unwrap(),
    );
    assert_eq!(status, 200);
    let historical: corpus_workbench::search::Envelope = serde_json::from_slice(&body).unwrap();
    let (status, _, body) = request(
        port,
        "POST",
        "/api/search/resolve",
        &authenticated,
        &serde_json::to_vec(&Resolve {
            query: history,
            result_hash: historical.result_hash,
            hit_id: historical.result.hits[0].id.clone(),
        })
        .unwrap(),
    );
    assert_eq!(status, 200);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["historical"],
        true
    );
    assert_eq!(
        request(port, "GET", &media_path, &cookie, &[]).2,
        b"RIFF synthetic only"
    );
    // Dropping child stops only the server spawned here. No protected port/store is used.
}
