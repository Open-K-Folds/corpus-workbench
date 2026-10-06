use anyhow::{ensure, Context, Result};
use corpus_workbench::{
    handoff::Completion,
    model::Command,
    package,
    store::{Fault, Store},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

fn option(args: &[String], name: &str, fallback: &str) -> String {
    args.iter()
        .position(|v| v == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_else(|| fallback.into())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UploadFile {
    path: String,
    bytes: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UploadStart {
    project: String,
    revision: i64,
    snapshot_hash: String,
    files: Vec<UploadFile>,
}
struct Upload {
    directory: PathBuf,
    basis: UploadStart,
    received: std::collections::BTreeSet<String>,
    last_activity: Instant,
}
const UPLOAD_IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);

fn prune_uploads(
    uploads: &mut std::collections::BTreeMap<String, Upload>,
    now: Instant,
    revision: i64,
    snapshot_hash: &str,
) -> Result<()> {
    let expired: Vec<_> = uploads
        .iter()
        .filter(|(_, upload)| {
            now.saturating_duration_since(upload.last_activity) >= UPLOAD_IDLE_LIMIT
                || upload.basis.revision != revision
                || upload.basis.snapshot_hash != snapshot_hash
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in expired {
        let directory = &uploads[&id].directory;
        if directory.exists() {
            fs::remove_dir_all(directory)?;
        }
        uploads.remove(&id);
    }
    Ok(())
}
fn verification_store(root: &Path, args: &[String]) -> Result<Store> {
    if option(args, "--readonly-backup", "no") == "yes" {
        Store::open_backup_readonly(root)
    } else {
        Store::open(root)
    }
}
fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("help");
    let root = PathBuf::from(option(&args, "--store", ".private/authority"));
    let project = option(&args, "--project", "pilot");
    match mode {
        "import" => { let mut s=Store::open(&root)?; let r=s.import(Path::new(&option(&args,"--package","")),&project)?; println!("{}",serde_json::to_string(&r)?); }
        "view" => println!("{}",serde_json::to_string(&verification_store(&root,&args)?.view(&project,None)?)?),
        "export" => { let s=Store::open(&root)?; let revision=option(&args,"--revision",&s.head(&project)?.id.to_string()).parse()?; s.export(&project,revision,Path::new(&option(&args,"--out","")))?; println!("Exported exact revision {revision}"); }
        "backup" => { verification_store(&root,&args)?.backup(Path::new(&option(&args,"--out","")))?; println!("Verified backup and clean restore"); }
        "check" => { ensure!(root.join("ledger.sqlite").is_file(),"existing authority required"); let s=verification_store(&root,&args)?; ensure!(!s.projects()?.is_empty(),"no imported projects"); println!("{}",json!({"status":"verified","projects":s.projects()?.len(),"revisions":s.all_revisions()?.len(),"schema":2,"sqlite_version":rusqlite::version()})); }
        "health" => health(option(&args,"--port","18910").parse()?)?,
        "review" => { let mut s=Store::open(&root)?; let revision:i64=option(&args,"--revision","").parse()?; let r=s.revision(&project,revision)?; println!("{}",s.review("local-owner",&project,revision,&r.snapshot_hash,&option(&args,"--decision",""),&option(&args,"--note",""))?); }
        "inventory" => {let s=Store::open(&root)?;let revision=option(&args,"--revision",&s.head(&project)?.id.to_string()).parse()?;println!("{}",serde_json::to_string(&s.reference_inventory(&project,revision)?)?);}
        "preflight" => {let s=Store::open(&root)?;let request:corpus_workbench::inventory::Preflight=serde_json::from_slice(&fs::read(option(&args,"--request",""))?)?;ensure!(request.project==project,"project scope denied");println!("{}",s.reference_preflight(&request)?);}
        "teitok-reader-preview" => {let s=Store::open(&root)?;let revision=option(&args,"--revision",&s.head(&project)?.id.to_string()).parse()?;println!("{}",serde_json::to_string(&s.teitok_reader_preview(&project,revision)?)?);}
        "retokenize-preview" => {let s=Store::open(&root)?;let request:corpus_workbench::retokenize::RetokenizeRequest=serde_json::from_slice(&fs::read(option(&args,"--request",""))?)?;ensure!(request.project==project,"project scope denied");let preview=s.retokenization_preview(&request)?;println!("{}",json!({"preview_hash":corpus_workbench::handoff::digest(&preview)?,"preview":preview}));}
        "return-stage" => {let s=Store::open(&root)?;println!("{}",json!({"stage":s.stage_return(Path::new(&option(&args,"--package","")),&project)?}));}
        "return-preview" => {let s=Store::open(&root)?;let request:corpus_workbench::reconcile::Request=serde_json::from_slice(&fs::read(option(&args,"--request",""))?)?;ensure!(request.project==project,"project scope denied");println!("{}",s.reconciliation_preview(&request)?);}
        "contract" => { let s=Store::open(&root)?; let revision=option(&args,"--revision","").parse()?; println!("{}",s.approved_contract_for_mapping(&project,revision,&option(&args,"--mapping-version","corpus-evidence/1"))?); }
        "accept-generation" => { let mut s=Store::open(&root)?; let bytes=fs::read(option(&args,"--receipt",""))?; ensure!(bytes.len()<=1_048_576,"completion size limit"); let c:Completion=serde_json::from_slice(&bytes)?; ensure!(c.binding.project==project,"project scope denied"); let graph=fs::read(option(&args,"--graph",""))?; println!("{}",s.accept_generation(&c,&graph,Fault::None)?); }
        "generations" => println!("{}",serde_json::to_string(&Store::open(&root)?.generations(&project,option(&args,"--historical","no")=="yes")?)?),
        "generation" => println!("{}",Store::open(&root)?.generation(&project,&option(&args,"--id",""),option(&args,"--historical","no")=="yes")?),
        "apply" => { let mut s=Store::open(&root)?; let c:Command=serde_json::from_slice(&fs::read(option(&args,"--command",""))?)?; let fault=match option(&args,"--fault","none").as_str() { "after-stage"=>Fault::AfterStage,"before-commit"=>Fault::BeforeCommit,"after-commit"=>Fault::AfterCommit,_=>Fault::None }; let r=s.apply("local-owner",&c,fault)?; println!("{}",serde_json::to_string(&r)?); }
        "serve" => serve(Store::open(&root)?,&project,&PathBuf::from(option(&args,"--ui","ui/dist")),option(&args,"--port","18910").parse()?, option(&args,"--container-network","no")=="yes")?,
        _ => println!("corpus-workbench import|serve|view|export|backup|check|health|apply|review|inventory|preflight|retokenize-preview|teitok-reader-preview|return-stage|return-preview|contract|accept-generation|generations|generation --store PATH --project ID\nImport: --package DIRECTORY. Export/backup: --out NEW_DIRECTORY. Serve: --port 18910 --ui ui/dist. View/check/backup: --readonly-backup yes requires a closed schema-2 backup. Health: --port PORT. Container serving: --container-network yes. Review/contract require --revision ID. Compiler completion: --receipt FILE --graph FILE. Generation: --id HASH; --historical yes is explicit stale access. No remote or archive imports.")
    }
    Ok(())
}
fn health(port: u16) -> Result<()> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_secs(3),
    )?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    write!(
        stream,
        "GET /health/ready HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )?;
    let mut bytes = Vec::new();
    stream.take(4096).read_to_end(&mut bytes)?;
    ensure!(
        bytes.starts_with(b"HTTP/1.1 200 ") || bytes.starts_with(b"HTTP/1.0 200 "),
        "workbench is not ready"
    );
    println!("ready");
    Ok(())
}
fn bind_address(port: u16, container_network: bool) -> Result<String> {
    if container_network {
        ensure!(
            cfg!(target_os = "linux")
                && (Path::new("/.dockerenv").is_file()
                    || Path::new("/run/.containerenv").is_file()),
            "container network requires a Linux container"
        );
        ensure!(port >= 1024, "container port must be unprivileged");
        Ok(format!("0.0.0.0:{port}"))
    } else {
        Ok(format!("127.0.0.1:{port}"))
    }
}
fn h(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).unwrap()
}
fn status_for(error: &str) -> u16 {
    if error.contains("unauthorized")
        || error.contains("CSRF")
        || error.contains("origin")
        || error.contains("project scope")
    {
        403
    } else if error.contains("stale") || error.contains("conflict") || error.contains("idempotency")
    {
        409
    } else {
        422
    }
}
fn header(request: &Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str().into())
}
fn body(request: &mut Request) -> Result<Value> {
    ensure!(
        request.body_length().unwrap_or(0) <= 1_048_576,
        "request size limit"
    );
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take(1_048_577)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 1_048_576, "request size limit");
    Ok(serde_json::from_slice(&bytes)?)
}
fn respond(request: Request, status: u16, bytes: Vec<u8>, mime: &str, extra: Vec<Header>) {
    let mut response = Response::from_data(bytes)
        .with_status_code(StatusCode(status))
        .with_header(h("Content-Type", mime));
    for hdr in [h("Cache-Control","no-store"),h("X-Content-Type-Options","nosniff"),h("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")] { response.add_header(hdr); }
    for hdr in extra {
        response.add_header(hdr);
    }
    let _ = request.respond(response);
}
fn serve(
    mut store: Store,
    project: &str,
    ui: &Path,
    port: u16,
    container_network: bool,
) -> Result<()> {
    ensure!(store.project_exists(project)?, "project not imported");
    ensure!(
        ui.join("index.html").exists(),
        "build the TypeScript UI first"
    );
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    // Bind before publishing a capability. A failed second launch must not
    // replace the working session's launcher with an unusable new code.
    let server =
        Server::http(bind_address(port, container_network)?).map_err(|e| anyhow::anyhow!("{e}"))?;
    fs::create_dir_all(".runtime")?;
    fs::write(".runtime/session-code", &token)?;
    let url = format!("http://127.0.0.1:{port}/");
    fs::write(".runtime/Open-Workbench.html",format!("<!doctype html><meta charset=\"utf-8\"><title>Open corpus workbench</title><h1>Corpus workbench</h1><p>Private local research copy.</p><a href=\"{url}#session={token}\">Open protected workbench</a>"))?;
    println!("Usable local workbench: {url} (open .runtime/Open-Workbench.html for its protected session)");
    // A download belongs to this server's authenticated project session. Files
    // left by another server/project in a shared cwd confer no access.
    let mut downloads = std::collections::BTreeMap::<String, PathBuf>::new();
    let upload_root =
        PathBuf::from(".runtime/return-uploads").join(format!("session-{}", uuid::Uuid::new_v4()));
    let mut uploads = std::collections::BTreeMap::<String, Upload>::new();
    for mut request in server.incoming_requests() {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        let method = request.method().clone();
        if path == "/health/ready" {
            let ready = method == Method::Get
                && ui.join("index.html").is_file()
                && store
                    .head(project)
                    .and_then(|revision| store.snapshot(&revision))
                    .is_ok();
            respond(
                request,
                if method != Method::Get {
                    405
                } else if ready {
                    200
                } else {
                    503
                },
                serde_json::to_vec(&json!({"status":if ready {"ready"} else {"unavailable"}}))?,
                "application/json",
                vec![],
            );
            continue;
        }
        let is_api = path.starts_with("/api/");
        let session = header(&request, "Cookie")
            .unwrap_or_default()
            .split(';')
            .map(str::trim)
            .any(|v| v == format!("wb_session={token}"));
        if path == "/api/session" && method == Method::Post {
            let result = (|| -> Result<Value> {
                ensure!(
                    header(&request, "Origin").as_deref() == Some(url.trim_end_matches('/')),
                    "origin denied"
                );
                let data = body(&mut request)?;
                ensure!(
                    data["code"].as_str() == Some(&token),
                    "unauthorized session"
                );
                Ok(
                    json!({"actor":"local-owner","project":project,"roles":["reader","editor","reviewer"],"csrf":token}),
                )
            })();
            match result {
                Ok(data) => respond(
                    request,
                    200,
                    serde_json::to_vec(&data)?,
                    "application/json",
                    vec![h(
                        "Set-Cookie",
                        &format!("wb_session={token}; HttpOnly; SameSite=Strict; Path=/"),
                    )],
                ),
                Err(e) => respond(
                    request,
                    403,
                    serde_json::to_vec(&json!({"error":e.to_string()}))?,
                    "application/json",
                    vec![],
                ),
            }
            continue;
        }
        if is_api && !session {
            respond(
                request,
                403,
                b"{\"error\":\"unauthorized session\"}".to_vec(),
                "application/json",
                vec![],
            );
            continue;
        }
        if is_api
            && method == Method::Post
            && (header(&request, "X-WB-CSRF").as_deref() != Some(&token)
                || header(&request, "Origin").as_deref() != Some(url.trim_end_matches('/')))
        {
            respond(
                request,
                403,
                b"{\"error\":\"CSRF/origin denied\"}".to_vec(),
                "application/json",
                vec![],
            );
            continue;
        }
        if path == "/api/media" && method == Method::Get {
            let result = (|| -> Result<(PathBuf, u64, String)> {
                let path = query(&request, "path").context("media path")?;
                package::safe_relative(&path)?;
                let snapshot = store.snapshot(&store.head(project)?)?;
                let artifact = snapshot.files.get(&path).context("media not in project")?;
                ensure!(
                    artifact.role == "source-media",
                    "project scope: media role required"
                );
                store.objects.read(artifact)?;
                let mime = if path.ends_with(".wav") {
                    "audio/wav"
                } else if path.ends_with(".m4a") {
                    "audio/mp4"
                } else if path.ends_with(".mp3") {
                    "audio/mpeg"
                } else {
                    "application/octet-stream"
                };
                Ok((
                    store.objects.root.join(&artifact.sha256),
                    artifact.bytes,
                    mime.into(),
                ))
            })();
            match result {
                Ok((path, len, mime)) => {
                    let range = header(&request, "Range");
                    let (start, end, status) = match range
                        .as_deref()
                        .and_then(|s| s.strip_prefix("bytes="))
                        .and_then(|s| s.split_once('-'))
                    {
                        Some((a, b)) => {
                            let start = a.parse::<u64>().unwrap_or(len);
                            let end = if b.is_empty() {
                                len.saturating_sub(1)
                            } else {
                                b.parse::<u64>().unwrap_or(len)
                            };
                            (start, end.min(len.saturating_sub(1)), 206)
                        }
                        None => (0, len.saturating_sub(1), 200),
                    };
                    if len == 0 || start > end || start >= len {
                        respond(
                            request,
                            416,
                            vec![],
                            &mime,
                            vec![h("Content-Range", &format!("bytes */{len}"))],
                        );
                        continue;
                    }
                    use std::io::{Seek, SeekFrom};
                    let mut f = fs::File::open(path)?;
                    f.seek(SeekFrom::Start(start))?;
                    let mut response = Response::new(
                        StatusCode(status),
                        vec![
                            h("Content-Type", &mime),
                            h("Accept-Ranges", "bytes"),
                            h("Cache-Control", "no-store"),
                            h("X-Content-Type-Options", "nosniff"),
                        ],
                        f.take(end - start + 1),
                        Some((end - start + 1) as usize),
                        None,
                    );
                    if status == 206 {
                        response
                            .add_header(h("Content-Range", &format!("bytes {start}-{end}/{len}")));
                    }
                    let _ = request.respond(response);
                }
                Err(e) => {
                    let error = e.to_string();
                    respond(
                        request,
                        status_for(&error),
                        serde_json::to_vec(&json!({"error":error}))?,
                        "application/json",
                        vec![],
                    )
                }
            }
            continue;
        }
        if is_api {
            let result = (|| -> Result<Value> {
                if path.starts_with("/api/return/") {
                    let head = store.head(project)?;
                    prune_uploads(&mut uploads, Instant::now(), head.id, &head.snapshot_hash)?;
                }
                match (method, path.as_str()) {
                    (Method::Get, "/api/session") => Ok(
                        json!({"actor":"local-owner","project":project,"roles":["reader","editor","reviewer"],"csrf":token}),
                    ),
                    (Method::Get, "/api/inventory") => {
                        let inventory = store.reference_inventory(
                            project,
                            query(&request, "revision")
                                .map(|r| r.parse())
                                .transpose()?
                                .unwrap_or(store.head(project)?.id),
                        )?;
                        Ok(
                            json!({"inventory_hash":corpus_workbench::handoff::digest(&inventory)?,"inventory":inventory}),
                        )
                    }
                    (Method::Get, "/api/teitok-reader") => {
                        let revision = query(&request, "revision")
                            .map(|value| value.parse())
                            .transpose()?
                            .unwrap_or(store.head(project)?.id);
                        Ok(serde_json::to_value(
                            store.teitok_reader_preview(project, revision)?,
                        )?)
                    }
                    (Method::Post, "/api/preflight") => {
                        let request: corpus_workbench::inventory::Preflight =
                            serde_json::from_value(body(&mut request)?)?;
                        ensure!(request.project == project, "project scope denied");
                        store.reference_preflight(&request)
                    }
                    (Method::Post, "/api/retokenize-preview") => {
                        let r: corpus_workbench::retokenize::RetokenizeRequest =
                            serde_json::from_value(body(&mut request)?)?;
                        ensure!(r.project == project, "project scope denied");
                        let preview = store.retokenization_preview(&r)?;
                        Ok(
                            json!({"preview_hash":corpus_workbench::handoff::digest(&preview)?,"preview":preview}),
                        )
                    }
                    (Method::Get, "/api/view") => store
                        .view(
                            project,
                            query(&request, "revision").map(|s| s.parse()).transpose()?,
                        )
                        .map(|v| serde_json::to_value(v).unwrap()),
                    (Method::Get, "/api/history") => {
                        Ok(serde_json::to_value(store.history(project)?)?)
                    }
                    (Method::Get, "/api/generations") => {
                        Ok(serde_json::to_value(store.generations(project, false)?)?)
                    }
                    (Method::Get, "/api/generation") => store.generation(
                        project,
                        &query(&request, "id").context("generation id")?,
                        false,
                    ),
                    (Method::Get, "/api/diff") => store.diff(
                        project,
                        query(&request, "from").context("from")?.parse()?,
                        query(&request, "to").context("to")?.parse()?,
                    ),
                    (Method::Get, "/api/xml") => {
                        let path = query(&request, "path").context("XML path")?;
                        let revision = query(&request, "revision")
                            .map(|value| value.parse())
                            .transpose()?
                            .unwrap_or(store.head(project)?.id);
                        let snapshot = store.snapshot(&store.revision(project, revision)?)?;
                        ensure!(path.ends_with(".xml"), "XML inspection only");
                        let artifact = snapshot
                            .files
                            .get(&path)
                            .context("source not in exact snapshot")?;
                        Ok(
                            json!({"path":path,"revision":revision,"artifact_hash":artifact.sha256,"xml":store.objects.text(&snapshot,&path)?}),
                        )
                    }
                    (Method::Get, "/api/contract") => {
                        store.approved_contract(project, store.head(project)?.id)
                    }
                    (Method::Post, "/api/command") => {
                        let c: Command = serde_json::from_value(body(&mut request)?)?;
                        ensure!(c.project == project, "project scope denied");
                        Ok(serde_json::to_value(store.apply(
                            "local-owner",
                            &c,
                            Fault::None,
                        )?)?)
                    }
                    (Method::Post, "/api/return/start") => {
                        let start: UploadStart = serde_json::from_value(body(&mut request)?)?;
                        ensure!(start.project == project, "project scope denied");
                        let head = store.head(project)?;
                        ensure!(
                            start.revision == head.id && start.snapshot_hash == head.snapshot_hash,
                            "stale upload basis"
                        );
                        ensure!(
                            uploads.len() < 4
                                && !start.files.is_empty()
                                && start.files.len() <= package::MAX_ENTRIES,
                            "return upload count limit"
                        );
                        let mut paths = std::collections::BTreeSet::new();
                        let mut total = 0u64;
                        for file in &start.files {
                            package::safe_package_path(&file.path)?;
                            ensure!(
                                paths.insert(file.path.to_lowercase()),
                                "case-colliding upload path"
                            );
                            total = total
                                .checked_add(file.bytes)
                                .context("return size overflow")?;
                            ensure!(
                                file.bytes <= package::MAX_FILE_BYTES
                                    && total <= package::MAX_PACKAGE_BYTES,
                                "return package limits exceeded"
                            );
                        }
                        let id = uuid::Uuid::new_v4().to_string();
                        let directory = upload_root.join(&id);
                        fs::create_dir_all(&directory)?;
                        uploads.insert(
                            id.clone(),
                            Upload {
                                directory,
                                basis: start,
                                received: Default::default(),
                                last_activity: Instant::now(),
                            },
                        );
                        Ok(json!({"upload":id}))
                    }
                    (Method::Post, "/api/return/file") => {
                        let id = query(&request, "upload").context("upload id")?;
                        let path = query(&request, "path").context("upload path")?;
                        let upload = uploads
                            .get_mut(&id)
                            .context("upload does not belong to this session")?;
                        let expected = upload
                            .basis
                            .files
                            .iter()
                            .find(|file| file.path == path)
                            .context("undeclared upload file")?
                            .bytes;
                        ensure!(
                            !upload.received.contains(&path),
                            "upload file already received"
                        );
                        if let Some(length) = request.body_length() {
                            ensure!(length as u64 == expected, "upload length mismatch");
                        }
                        let target = upload.directory.join(&path);
                        fs::create_dir_all(target.parent().context("upload parent")?)?;
                        let result = (|| -> Result<()> {
                            let mut file = fs::OpenOptions::new()
                                .write(true)
                                .create_new(true)
                                .open(&target)?;
                            let count = std::io::copy(
                                &mut request.as_reader().take(expected + 1),
                                &mut file,
                            )?;
                            ensure!(count == expected, "upload length mismatch");
                            file.sync_all()?;
                            Ok(())
                        })();
                        if result.is_err() {
                            let _ = fs::remove_file(&target);
                        }
                        result?;
                        upload.received.insert(path);
                        upload.last_activity = Instant::now();
                        Ok(
                            json!({"received":upload.received.len(),"files":upload.basis.files.len()}),
                        )
                    }
                    (Method::Post, "/api/return/finish") => {
                        let data = body(&mut request)?;
                        let id = data["upload"].as_str().context("upload id")?;
                        let upload = uploads
                            .get(id)
                            .context("upload does not belong to this session")?;
                        ensure!(
                            upload.received.len() == upload.basis.files.len(),
                            "return package incomplete"
                        );
                        let head = store.head(project)?;
                        ensure!(
                            upload.basis.revision == head.id
                                && upload.basis.snapshot_hash == head.snapshot_hash,
                            "stale upload basis"
                        );
                        let stage = store.stage_return(&upload.directory, project)?;
                        let upload = uploads.remove(id).unwrap();
                        fs::remove_dir_all(upload.directory)?;
                        Ok(json!({"stage":stage}))
                    }
                    (Method::Post, "/api/return/cancel") => {
                        let data = body(&mut request)?;
                        if let Some(upload) =
                            uploads.remove(data["upload"].as_str().context("upload id")?)
                        {
                            fs::remove_dir_all(upload.directory)?;
                        }
                        Ok(json!({"cancelled":true}))
                    }
                    (Method::Post, "/api/return/preview") => {
                        let proposal: corpus_workbench::reconcile::Request =
                            serde_json::from_value(body(&mut request)?)?;
                        ensure!(proposal.project == project, "project scope denied");
                        store.reconciliation_preview(&proposal)
                    }
                    (Method::Post, "/api/review") => {
                        let data = body(&mut request)?;
                        store.review(
                            "local-owner",
                            project,
                            data["revision"].as_i64().context("revision")?,
                            data["snapshot_hash"].as_str().context("hash")?,
                            data["decision"].as_str().context("decision")?,
                            data["note"].as_str().unwrap_or(""),
                        )
                    }
                    (Method::Post, "/api/export") => {
                        let data = body(&mut request)?;
                        let revision = data["revision"].as_i64().context("revision")?;
                        let job_id = format!("export-{}", uuid::Uuid::new_v4());
                        let dir = PathBuf::from(".runtime/exports").join(&job_id);
                        store.export(project, revision, &dir)?;
                        package::zip_directory(&dir, &dir.with_extension("zip"))?;
                        downloads.insert(job_id.clone(), dir.with_extension("zip"));
                        Ok(
                            json!({"job_id":job_id,"state":"complete","revision":revision,"download":format!("/api/download?id={job_id}")}),
                        )
                    }
                    (Method::Get, "/api/download") => {
                        anyhow::bail!("project scope denied for download")
                    }
                    _ => anyhow::bail!("unsupported API route"),
                }
            })();
            if path == "/api/download" {
                if let Some(id) = query(&request, "id").filter(|id| {
                    id.starts_with("export-")
                        && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                }) {
                    if let Some(file) = downloads
                        .get(&id)
                        .and_then(|path| fs::File::open(path).ok())
                    {
                        let response = Response::from_file(file)
                            .with_header(h("Content-Type", "application/zip"))
                            .with_header(h("Cache-Control", "no-store"))
                            .with_header(h(
                                "Content-Disposition",
                                &format!("attachment; filename=\"{id}.zip\""),
                            ));
                        let _ = request.respond(response);
                        continue;
                    }
                }
            }
            match result {
                Ok(data) => respond(
                    request,
                    200,
                    serde_json::to_vec(&data)?,
                    "application/json",
                    vec![],
                ),
                Err(e) => {
                    let error = e.to_string();
                    respond(
                        request,
                        status_for(&error),
                        serde_json::to_vec(&json!({"error":error}))?,
                        "application/json",
                        vec![],
                    );
                }
            }
        } else if method == Method::Get {
            let rel = if path == "/" {
                "index.html"
            } else {
                path.trim_start_matches('/')
            };
            let file = if package::safe_relative(rel).is_ok() {
                ui.join(rel)
            } else {
                PathBuf::new()
            };
            let mime = if rel.ends_with(".js") {
                "text/javascript"
            } else if rel.ends_with(".css") {
                "text/css"
            } else {
                "text/html; charset=utf-8"
            };
            match fs::read(file) {
                Ok(bytes) => respond(request, 200, bytes, mime, vec![]),
                Err(_) => respond(request, 404, b"Not found".to_vec(), "text/plain", vec![]),
            }
        } else {
            respond(request, 405, vec![], "text/plain", vec![]);
        }
    }
    Ok(())
}
fn query(request: &Request, key: &str) -> Option<String> {
    request
        .url()
        .split_once('?')?
        .1
        .split('&')
        .find_map(|part| {
            let (k, v) = part.split_once('=')?;
            if k == key {
                decode(v)
            } else {
                None
            }
        })
}
fn decode(s: &str) -> Option<String> {
    let mut bytes = Vec::new();
    let input = s.as_bytes();
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'%' {
            bytes.push(
                u8::from_str_radix(std::str::from_utf8(input.get(i + 1..i + 3)?).ok()?, 16).ok()?,
            );
            i += 3;
        } else {
            bytes.push(if input[i] == b'+' { b' ' } else { input[i] });
            i += 1;
        }
    }
    String::from_utf8(bytes).ok()
}

#[cfg(test)]
mod upload_tests {
    use super::*;

    fn upload(root: &Path, id: &str, activity: Instant, revision: i64, hash: &str) -> Upload {
        let directory = root.join(id);
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("received.bin"), b"synthetic upload").unwrap();
        Upload {
            directory,
            basis: UploadStart {
                project: "synthetic".into(),
                revision,
                snapshot_hash: hash.into(),
                files: vec![UploadFile {
                    path: "received.bin".into(),
                    bytes: 16,
                }],
            },
            received: std::collections::BTreeSet::from(["received.bin".into()]),
            last_activity: activity,
        }
    }

    #[test]
    fn idle_uploads_release_all_four_slots_and_only_their_files() {
        let root = tempfile::TempDir::new().unwrap();
        let now = Instant::now();
        let sentinel = root.path().join("preserved-authority.bin");
        fs::write(&sentinel, b"preserved").unwrap();
        let mut uploads: std::collections::BTreeMap<_, _> = (0..4)
            .map(|n| {
                let id = n.to_string();
                (id.clone(), upload(root.path(), &id, now, 7, "saved"))
            })
            .collect();
        prune_uploads(
            &mut uploads,
            now + UPLOAD_IDLE_LIMIT - Duration::from_secs(1),
            7,
            "saved",
        )
        .unwrap();
        assert_eq!(uploads.len(), 4);
        prune_uploads(&mut uploads, now + UPLOAD_IDLE_LIMIT, 7, "saved").unwrap();
        assert!(uploads.is_empty());
        for n in 0..4 {
            assert!(!root.path().join(n.to_string()).exists());
        }
        assert_eq!(fs::read(sentinel).unwrap(), b"preserved");
    }

    #[test]
    fn recent_progress_preserves_active_uploads_and_superseded_bases_are_reaped() {
        let root = tempfile::TempDir::new().unwrap();
        let now = Instant::now();
        let mut uploads = std::collections::BTreeMap::from([
            (
                "active".into(),
                upload(
                    root.path(),
                    "active",
                    now + UPLOAD_IDLE_LIMIT - Duration::from_secs(1),
                    7,
                    "saved",
                ),
            ),
            (
                "old-revision".into(),
                upload(root.path(), "old-revision", now, 6, "saved"),
            ),
            (
                "old-hash".into(),
                upload(root.path(), "old-hash", now, 7, "other"),
            ),
        ]);
        prune_uploads(&mut uploads, now + UPLOAD_IDLE_LIMIT, 7, "saved").unwrap();
        assert_eq!(
            uploads.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["active"]
        );
        assert_eq!(
            fs::read(root.path().join("active/received.bin")).unwrap(),
            b"synthetic upload"
        );
        assert!(!root.path().join("old-revision").exists());
        assert!(!root.path().join("old-hash").exists());
    }
}
