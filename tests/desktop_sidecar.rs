use corpus_workbench::{
    model::{Command as CorpusCommand, Operation},
    store::Store,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
use tempfile::TempDir;

struct Case {
    _temp: TempDir,
    authority: PathBuf,
    ui: PathBuf,
    cwd: PathBuf,
    runtime: PathBuf,
}
impl Case {
    fn new() -> Self {
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
        fs::create_dir_all(source.join("Audio")).unwrap();
        // Exceed tiny_http's default 32 KiB chunk threshold. These synthetic
        // media bytes exercise HTTP framing; Electron tests use a valid WAV.
        fs::write(source.join("Audio/test.wav"), vec![0u8; 65_536]).unwrap();
        let authority = temp.path().join("authority");
        Store::open(&authority)
            .unwrap()
            .import(&source, "test")
            .unwrap();
        let ui = temp.path().join("installed-ui");
        fs::create_dir(&ui).unwrap();
        fs::write(
            ui.join("index.html"),
            "<!doctype html><title>synthetic</title>",
        )
        .unwrap();
        let cwd = temp.path().join("installed-cwd");
        fs::create_dir(&cwd).unwrap();
        let runtime = temp.path().join("private-writable-runtime");
        fs::create_dir(&runtime).unwrap();
        fs::write(runtime.join("preserved.txt"), "other session data").unwrap();
        Self {
            _temp: temp,
            authority,
            ui,
            cwd,
            runtime,
        }
    }
    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"));
        command
            .args(["serve", "--store"])
            .arg(&self.authority)
            .args(["--project", "test", "--ui"])
            .arg(&self.ui)
            .args(["--desktop", "yes", "--port", "0", "--runtime-dir"])
            .arg(&self.runtime)
            .args(["--parent-stdin", "yes"])
            .current_dir(&self.cwd);
        command
    }
    fn start(&self) -> Running {
        let child = self
            .command()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut running = Running {
            child,
            ready: Value::Null,
        };
        let stdout = running.child.stdout.take().unwrap();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            BufReader::new(stdout).read_line(&mut line).unwrap();
            let _ = send.send(line);
        });
        let line = receive
            .recv_timeout(Duration::from_secs(10))
            .expect("sidecar must publish readiness");
        running.ready = serde_json::from_str(&line).expect("single machine-readable ready line");
        assert_eq!(running.ready["event"], "workbench-ready");
        assert_ne!(running.port(), 0);
        assert_eq!(running.ready["project"], "test");
        assert_eq!(running.capability().len(), 64);
        running
    }
}
struct Running {
    child: Child,
    ready: Value,
}
impl Running {
    fn port(&self) -> u16 {
        self.ready["port"].as_u64().unwrap().try_into().unwrap()
    }
    fn capability(&self) -> &str {
        self.ready["capability"].as_str().unwrap()
    }
    fn request(&self, method: &str, path: &str, body: &Value) -> (u16, Vec<u8>) {
        request(
            self.port(),
            method,
            path,
            &format!("X-WB-Desktop: {}\r\n", self.capability()),
            &serde_json::to_vec(body).unwrap(),
        )
    }
    fn stop(&mut self, explicit: bool) {
        let mut stdin = self.child.stdin.take().unwrap();
        if explicit {
            stdin.write_all(b"shutdown\n").unwrap();
        }
        drop(stdin);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "graceful sidecar exit: {status}");
                break;
            }
            assert!(
                Instant::now() < deadline,
                "sidecar did not release after parent exit"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!Path::new(self.ready["runtime"].as_str().unwrap()).exists());
        assert!(TcpStream::connect(("127.0.0.1", self.port())).is_err());
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn request(port: u16, method: &str, path: &str, headers: &str, body: &[u8]) -> (u16, Vec<u8>) {
    let (status, headers, bytes) = request_with_headers(port, method, path, headers, body);
    // Export downloads remain valid chunked HTTP streams. Decode transfer
    // framing in this raw-socket helper before inspecting the ZIP payload.
    if headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        let mut payload = Vec::new();
        let mut remaining = bytes.as_slice();
        loop {
            let line_end = remaining.windows(2).position(|w| w == b"\r\n").unwrap();
            let length =
                usize::from_str_radix(std::str::from_utf8(&remaining[..line_end]).unwrap(), 16)
                    .unwrap();
            remaining = &remaining[line_end + 2..];
            if length == 0 {
                break;
            }
            payload.extend_from_slice(&remaining[..length]);
            assert_eq!(&remaining[length..length + 2], b"\r\n");
            remaining = &remaining[length + 2..];
        }
        (status, payload)
    } else {
        (status, bytes)
    }
}
fn request_with_headers(
    port: u16,
    method: &str,
    path: &str,
    headers: &str,
    body: &[u8],
) -> (u16, String, Vec<u8>) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n{headers}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n", body.len()).unwrap();
    stream.write_all(body).unwrap();
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    let split = bytes.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = String::from_utf8_lossy(&bytes[..split]);
    let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, head.into_owned(), bytes[split + 4..].to_vec())
}
fn json_body(response: (u16, Vec<u8>)) -> Value {
    assert_eq!(response.0, 200, "{}", String::from_utf8_lossy(&response.1));
    serde_json::from_slice(&response.1).unwrap()
}

#[test]
fn desktop_sidecar_is_private_relaunches_with_stable_lineage_and_cleans_runtime() {
    let case = Case::new();
    let mut first = case.start();
    assert!(!case.cwd.join(".runtime").exists());
    assert!(!case.runtime.join("session-code").exists());
    assert!(!case.runtime.join("Open-Workbench.html").exists());
    assert_eq!(request(first.port(), "GET", "/api/view", "", b"").0, 403);
    assert_eq!(
        request(
            first.port(),
            "GET",
            "/api/view",
            "X-WB-Desktop: incorrect\r\n",
            b""
        )
        .0,
        403
    );
    let cookie = format!("Cookie: wb_session={}\r\n", first.capability());
    assert_eq!(
        request(first.port(), "GET", "/api/view", &cookie, b"").0,
        403
    );
    assert_eq!(
        first
            .request("POST", "/api/session", &json!({"code":first.capability()}))
            .0,
        403
    );
    let session = json_body(first.request("GET", "/api/session", &Value::Null));
    assert_eq!(session["csrf"], "");
    assert_eq!(session["authority"], first.ready["authority"]);
    assert!(!session.to_string().contains(first.capability()));
    let auth = format!("X-WB-Desktop: {}\r\n", first.capability());
    let (status, headers, bytes) = request_with_headers(
        first.port(),
        "GET",
        "/api/media?path=Audio/test.wav",
        &auth,
        b"",
    );
    assert_eq!(status, 200);
    assert!(headers.contains("Content-Length: 65536"), "{headers}");
    assert!(!headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked"));
    assert_eq!(bytes, vec![0u8; 65_536]);
    let (status, headers, bytes) = request_with_headers(
        first.port(),
        "GET",
        "/api/media?path=Audio/test.wav",
        &format!("{auth}Range: bytes=0-\r\n"),
        b"",
    );
    assert_eq!(status, 206);
    assert!(headers.contains("Content-Length: 65536"), "{headers}");
    assert!(
        headers.contains("Content-Range: bytes 0-65535/65536"),
        "{headers}"
    );
    assert!(!headers
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked"));
    assert_eq!(bytes, vec![0u8; 65_536]);
    let view = json_body(first.request("GET", "/api/view", &Value::Null));
    let command = CorpusCommand {
        schema: 1,
        project: "test".into(),
        command_id: "desktop-response-loss-retry".into(),
        base_revision: view["revision"]["id"].as_i64().unwrap(),
        preimage_hash: view["revision"]["snapshot_hash"].as_str().unwrap().into(),
        config_version: 1,
        label: "Synthetic desktop correction".into(),
        operations: vec![Operation::SetToken {
            document: "xmlfiles/test.xml".into(),
            token: "w-1".into(),
            fields: BTreeMap::from([("nform".into(), "corrected".into())]),
        }],
    };
    let command = serde_json::to_value(command).unwrap();
    let saved = json_body(first.request("POST", "/api/command", &command));
    let export = json_body(first.request("POST", "/api/export", &json!({"revision":saved["id"]})));
    let download = first.request("GET", export["download"].as_str().unwrap(), &Value::Null);
    assert_eq!(download.0, 200);
    assert!(download.1.starts_with(b"PK"));
    let upload = json_body(first.request("POST", "/api/return/start", &json!({"project":"test","revision":saved["id"],"snapshot_hash":saved["snapshot_hash"],"files":[{"path":"xmlfiles/test.xml","bytes":8}]})));
    let runtime = PathBuf::from(first.ready["runtime"].as_str().unwrap());
    assert!(runtime
        .join("return-uploads")
        .join(upload["upload"].as_str().unwrap())
        .is_dir());
    assert!(runtime.join("exports").is_dir());
    let lineage = first.ready["authority"].clone();
    let old_capability = first.capability().to_string();
    first.stop(true);
    assert_eq!(
        fs::read_to_string(case.runtime.join("preserved.txt")).unwrap(),
        "other session data"
    );
    let mut second = case.start();
    assert_eq!(second.ready["authority"], lineage);
    assert_ne!(second.capability(), old_capability);
    assert_eq!(
        json_body(second.request("POST", "/api/command", &command)),
        saved
    );
    second.stop(false); // stdin EOF after an unexpected parent exit also cleans up.
    let store = Store::open(&case.authority).unwrap();
    assert_eq!(store.history("test").unwrap().len(), 2);
    assert_eq!(
        store.view("test", None).unwrap().documents[0].tokens[0]
            .corrected
            .as_deref(),
        Some("corrected")
    );
}

#[test]
fn failed_sidecar_start_does_not_publish_capability_or_delete_other_runtime_files() {
    let case = Case::new();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["serve", "--store"])
        .arg(&case.authority)
        .args(["--project", "test", "--ui"])
        .arg(&case.ui)
        .args([
            "--desktop",
            "yes",
            "--port",
            &listener.local_addr().unwrap().port().to_string(),
            "--runtime-dir",
        ])
        .arg(&case.runtime)
        .current_dir(&case.cwd)
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(!case.runtime.join("sessions").exists());
    assert_eq!(
        fs::read_to_string(case.runtime.join("preserved.txt")).unwrap(),
        "other session data"
    );
    fs::remove_file(case.ui.join("index.html")).unwrap();
    let result = case.command().stdin(Stdio::null()).output().unwrap();
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
    assert!(String::from_utf8_lossy(&result.stderr).contains("build the TypeScript UI"));
    assert!(!case.cwd.join(".runtime").exists());
}

#[test]
fn projects_discovery_is_readonly_and_rejects_unknown_directories_and_schemas() {
    let case = Case::new();
    let result = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["projects", "--store"])
        .arg(&case.authority)
        .output()
        .unwrap();
    assert!(result.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&result.stdout).unwrap(),
        json!({"projects":["test"]})
    );
    let unknown = case.cwd.join("unknown");
    let result = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["projects", "--store"])
        .arg(&unknown)
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!unknown.exists());
    let ledger = case.authority.join("ledger.sqlite");
    let conn = rusqlite::Connection::open(&ledger).unwrap();
    conn.pragma_update(None, "user_version", 99).unwrap();
    drop(conn);
    let before = fs::read(&ledger).unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["projects", "--store"])
        .arg(&case.authority)
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert_eq!(fs::read(&ledger).unwrap(), before);
}
