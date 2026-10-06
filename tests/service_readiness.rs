use corpus_workbench::store::Store;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    time::Duration,
};
use tempfile::TempDir;
struct Running(Child);
impl Drop for Running {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn request(port: u16, method: &str, path: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").unwrap();
    let mut result = String::new();
    stream.read_to_string(&mut result).unwrap();
    result
}
#[test]
fn readiness_is_minimal_read_only_and_fails_on_committed_object_corruption() {
    let temp = TempDir::new().unwrap();
    let package = temp.path().join("package");
    fs::create_dir_all(package.join("xmlfiles")).unwrap();
    fs::create_dir_all(package.join("Resources")).unwrap();
    fs::write(package.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        package.join("xmlfiles/test.xml"),
        "<TEI><text><tok id='w-1'>synthetic</tok></text></TEI>",
    )
    .unwrap();
    let authority = temp.path().join("authority");
    let mut store = Store::open(&authority).unwrap();
    let revision = store.import(&package, "test").unwrap();
    let artifact = store.snapshot(&revision).unwrap().files["xmlfiles/test.xml"]
        .sha256
        .clone();
    drop(store);
    let ui = temp.path().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(
        ui.join("index.html"),
        "<!doctype html><title>synthetic</title>",
    )
    .unwrap();
    fs::write(ui.join("symbols.woff2"), "wOF2-synthetic").unwrap();
    fs::write(ui.join("LICENSE.txt"), "synthetic notice").unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let _running = Running(
        Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
            .args(["serve", "--store"])
            .arg(&authority)
            .args(["--project", "test", "--ui"])
            .arg(&ui)
            .args(["--port", &port.to_string()])
            .current_dir(temp.path())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    for _ in 0..100 {
        if temp.path().join(".runtime/session-code").exists() {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let response = request(port, "GET", "/health/ready");
    assert!(response.starts_with("HTTP/1.1 200"));
    assert_eq!(
        response.split("\r\n\r\n").nth(1).unwrap(),
        "{\"status\":\"ready\"}"
    );
    assert!(request(port, "POST", "/health/ready").starts_with("HTTP/1.1 405"));
    assert!(request(port, "GET", "/api/view").starts_with("HTTP/1.1 403"));
    let font = request(port, "GET", "/symbols.woff2");
    assert!(font.starts_with("HTTP/1.1 200"));
    assert!(font.contains("Content-Type: font/woff2"));
    assert!(font.ends_with("wOF2-synthetic"));
    assert!(request(port, "GET", "/LICENSE.txt").contains("Content-Type: text/plain"));
    assert!(Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["health", "--port", &port.to_string()])
        .output()
        .unwrap()
        .status
        .success());
    fs::write(authority.join("objects").join(artifact), "tampered").unwrap();
    assert!(request(port, "GET", "/health/ready").starts_with("HTTP/1.1 503"));
    assert!(!Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["health", "--port", &port.to_string()])
        .output()
        .unwrap()
        .status
        .success());
}
#[test]
fn container_network_flag_cannot_enable_a_host_listener() {
    // Linux container execution tests the positive path through Compose.
    if cfg!(target_os = "linux") && std::path::Path::new("/.dockerenv").is_file() {
        return;
    }
    let temp = TempDir::new().unwrap();
    let source = temp.path().join("package");
    fs::create_dir(&source).unwrap();
    fs::create_dir(source.join("Resources")).unwrap();
    fs::create_dir(source.join("xmlfiles")).unwrap();
    fs::write(source.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        source.join("xmlfiles/test.xml"),
        "<TEI><text><tok id='w-1'>synthetic</tok></text></TEI>",
    )
    .unwrap();
    let root = temp.path().join("authority");
    Store::open(&root).unwrap().import(&source, "test").unwrap();
    let ui = temp.path().join("ui");
    fs::create_dir(&ui).unwrap();
    fs::write(ui.join("index.html"), "synthetic").unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_corpus-workbench"))
        .args(["serve", "--store"])
        .arg(root)
        .args(["--project", "test", "--ui"])
        .arg(ui)
        .args(["--container-network", "yes"])
        .current_dir(temp.path())
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("Linux container"));
    assert!(!temp.path().join(".runtime/session-code").exists());
}
