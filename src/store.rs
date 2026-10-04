use crate::{
    model::*,
    package::{self, Objects},
    xml,
};
use anyhow::{ensure, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Fault {
    None,
    AfterStage,
    BeforeCommit,
    AfterCommit,
}
pub(crate) fn injected_failure(message: &str) -> Result<()> {
    if std::env::var("WORKBENCH_TEST_HARD_CRASH").as_deref() == Ok("yes") {
        std::process::exit(73);
    }
    anyhow::bail!("{message}")
}
pub struct Store {
    pub conn: Connection,
    pub objects: Objects,
    pub root: PathBuf,
}
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let conn = Connection::open(root.join("ledger.sqlite"))?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        ensure!(
            version <= 2,
            "unsupported database schema; refusing to open"
        );
        conn.execute_batch("CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, head INTEGER, FOREIGN KEY(head) REFERENCES revisions(id));
            CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), parent INTEGER REFERENCES revisions(id), snapshot_hash TEXT NOT NULL, actor TEXT NOT NULL, label TEXT NOT NULL, command_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            CREATE TABLE IF NOT EXISTS commands(project TEXT NOT NULL, actor TEXT NOT NULL, command_id TEXT NOT NULL, request_hash TEXT NOT NULL, revision INTEGER NOT NULL REFERENCES revisions(id), PRIMARY KEY(project,actor,command_id));
            CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL REFERENCES revisions(id), snapshot_hash TEXT NOT NULL, actor TEXT NOT NULL, decision TEXT NOT NULL, scope TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            CREATE TABLE IF NOT EXISTS derived_generations(id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL REFERENCES revisions(id), snapshot_hash TEXT NOT NULL, recipe_hash TEXT NOT NULL, receipt_hash TEXT NOT NULL, graph_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
            PRAGMA user_version=2;")?;
        let store = Self {
            conn,
            objects: Objects::new(&root.join("objects"))?,
            root: root.into(),
        };
        // Opening an authority fails loudly if a committed reference is corrupt.
        for revision in store.all_revisions()? {
            store.snapshot(&revision)?;
        }
        for hash in store.generation_objects()? {
            store.objects.read_hash(&hash)?;
        }
        Ok(store)
    }
    pub fn import(&mut self, directory: &Path, project: &str) -> Result<Revision> {
        ensure!(!self.project_exists(project)?, "project already imported");
        let snapshot = package::import(&self.objects, directory, project)?;
        let artifact = self
            .objects
            .put(&serde_json::to_vec(&snapshot)?, "revision-snapshot")?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO projects(id) VALUES(?)", [project])?;
        tx.execute(
            "INSERT INTO revisions(project,snapshot_hash,actor,label,command_id) VALUES(?,?,?,?,?)",
            params![
                project,
                artifact.sha256,
                "local-owner",
                "Imported protected package",
                format!("import-{}", uuid::Uuid::new_v4())
            ],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "UPDATE projects SET head=? WHERE id=?",
            params![id, project],
        )?;
        tx.commit()?;
        self.revision(project, id)
    }
    pub fn project_exists(&self, project: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM projects WHERE id=?", [project], |_| Ok(true))
            .optional()?
            .unwrap_or(false))
    }
    pub fn projects(&self) -> Result<Vec<String>> {
        Ok(self
            .conn
            .prepare("SELECT id FROM projects ORDER BY id")?
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?)
    }
    fn row_revision(row: &rusqlite::Row<'_>) -> rusqlite::Result<Revision> {
        Ok(Revision {
            id: row.get(0)?,
            parent: row.get(1)?,
            snapshot_hash: row.get(2)?,
            actor: row.get(3)?,
            label: row.get(4)?,
            created_at: row.get(5)?,
            command_id: row.get(6)?,
        })
    }
    pub fn revision(&self, project: &str, id: i64) -> Result<Revision> {
        self.conn.query_row("SELECT id,parent,snapshot_hash,actor,label,created_at,command_id FROM revisions WHERE project=? AND id=?", params![project,id], Self::row_revision).context("revision not in project")
    }
    pub fn history(&self, project: &str) -> Result<Vec<Revision>> {
        ensure!(self.project_exists(project)?, "project not found");
        Ok(self.conn.prepare("SELECT id,parent,snapshot_hash,actor,label,created_at,command_id FROM revisions WHERE project=? ORDER BY id DESC")?.query_map([project], Self::row_revision)?.collect::<rusqlite::Result<_>>()?)
    }
    pub fn all_revisions(&self) -> Result<Vec<Revision>> {
        Ok(self.conn.prepare("SELECT id,parent,snapshot_hash,actor,label,created_at,command_id FROM revisions ORDER BY id")?.query_map([], Self::row_revision)?.collect::<rusqlite::Result<_>>()?)
    }
    pub fn head(&self, project: &str) -> Result<Revision> {
        let id: i64 = self
            .conn
            .query_row("SELECT head FROM projects WHERE id=?", [project], |r| {
                r.get(0)
            })
            .context("project not found")?;
        self.revision(project, id)
    }
    pub fn snapshot(&self, revision: &Revision) -> Result<Snapshot> {
        let snapshot: Snapshot =
            serde_json::from_slice(&self.objects.read_hash(&revision.snapshot_hash)?)?;
        package::validate(&self.objects, &snapshot)?;
        Ok(snapshot)
    }
    pub fn approved(&self, project: &str, revision: &Revision) -> Result<bool> {
        let decision: Option<String> = self.conn.query_row("SELECT decision FROM reviews WHERE project=? AND revision=? AND snapshot_hash=? AND scope='full' ORDER BY id DESC LIMIT 1", params![project,revision.id,revision.snapshot_hash], |r| r.get(0)).optional()?;
        Ok(decision.as_deref() == Some("approved"))
    }
    pub fn view(&self, project: &str, revision: Option<i64>) -> Result<View> {
        let rev = match revision {
            Some(id) => self.revision(project, id)?,
            None => self.head(project)?,
        };
        let snapshot = self.snapshot(&rev)?;
        Ok(View {
            api_version: 1,
            documents: package::documents(&self.objects, &snapshot)?,
            issues: package::validate(&self.objects, &snapshot)?,
            approved: self.approved(project, &rev)?,
            revision: rev,
            snapshot,
        })
    }
    pub fn apply(&mut self, actor: &str, command: &Command, fault: Fault) -> Result<Revision> {
        ensure!(actor == "local-owner", "actor not authorized");
        ensure!(
            command.schema == SCHEMA
                && xml::valid_name(&command.command_id)
                && !command.label.trim().is_empty()
                && command.label.len() <= 512
                && !command.operations.is_empty()
                && command.operations.len() <= 100,
            "invalid command contract"
        );
        let request_hash = package::hash(&serde_json::to_vec(command)?);
        let previous: Option<(String,i64)> = self.conn.query_row("SELECT request_hash,revision FROM commands WHERE project=? AND actor=? AND command_id=?", params![command.project,actor,command.command_id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((hash, id)) = previous {
            ensure!(
                hash == request_hash,
                "idempotency key bound to different payload"
            );
            return self.revision(&command.project, id);
        }
        let head = self.head(&command.project)?;
        ensure!(
            head.id == command.base_revision && head.snapshot_hash == command.preimage_hash,
            "stale revision/preimage conflict; current head {}",
            head.id
        );
        let mut snapshot = self.snapshot(&head)?;
        ensure!(
            snapshot.config.version == command.config_version,
            "stale configuration"
        );
        for op in &command.operations {
            match op {
                Operation::SetToken {
                    document,
                    token,
                    fields,
                } => package::token_fields(&self.objects, &mut snapshot, document, token, fields)?,
                Operation::DefineLanguage { value, description } => {
                    ensure!(
                        !value.trim().is_empty() && value.len() <= 128 && description.len() <= 2048,
                        "invalid language definition"
                    );
                    snapshot
                        .config
                        .language_values
                        .insert(value.clone(), description.clone());
                    snapshot.config.version += 1;
                }
                Operation::SetLanguageDefault { value } => {
                    if let Some(value) = value {
                        ensure!(
                            snapshot.config.language_values.contains_key(value),
                            "undefined language default"
                        );
                    }
                    snapshot.config.language_default = value.clone();
                    snapshot.config.version += 1;
                }
                Operation::AddSpan {
                    document,
                    id,
                    token_ids,
                    fields,
                    character,
                } => package::add_span(
                    &self.objects,
                    &mut snapshot,
                    document,
                    id,
                    token_ids,
                    fields,
                    character,
                )?,
                Operation::AddRelation {
                    document,
                    from,
                    to,
                    relation_type,
                    note,
                } => {
                    ensure!(
                        !relation_type.trim().is_empty() && from != to,
                        "invalid relation"
                    );
                    package::token_fields(
                        &self.objects,
                        &mut snapshot,
                        document,
                        from,
                        &BTreeMap::from([
                            ("relation_target".into(), to.clone()),
                            ("relation_type".into(), relation_type.clone()),
                            ("note".into(), note.clone()),
                        ]),
                    )?;
                }
                Operation::Restore { revision } => {
                    ensure!(
                        command.operations.len() == 1,
                        "restore must be its own operation group"
                    );
                    snapshot = self.snapshot(&self.revision(&command.project, *revision)?)?;
                    snapshot.index_status = "stale after restore; rebuild required".into();
                }
            }
        }
        package::validate(&self.objects, &snapshot)?;
        let artifact = self
            .objects
            .put(&serde_json::to_vec(&snapshot)?, "revision-snapshot")?;
        if fault == Fault::AfterStage {
            injected_failure("injected crash after blob staging")?;
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Another identical request can commit while this request stages files
        // or waits for the writer lock. Recheck the payload binding under that
        // lock before rejecting its now-old base revision.
        let committed: Option<(String, i64)> = tx.query_row("SELECT request_hash,revision FROM commands WHERE project=? AND actor=? AND command_id=?", params![command.project,actor,command.command_id], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((hash, id)) = committed {
            ensure!(
                hash == request_hash,
                "idempotency key bound to different payload"
            );
            drop(tx);
            return self.revision(&command.project, id);
        }
        let actual: i64 = tx.query_row(
            "SELECT head FROM projects WHERE id=?",
            [&command.project],
            |r| r.get(0),
        )?;
        ensure!(actual == head.id, "stale revision conflict at commit");
        tx.execute("INSERT INTO revisions(project,parent,snapshot_hash,actor,label,command_id) VALUES(?,?,?,?,?,?)",params![command.project,head.id,artifact.sha256,actor,command.label,command.command_id])?;
        let id = tx.last_insert_rowid();
        tx.execute("INSERT INTO commands(project,actor,command_id,request_hash,revision) VALUES(?,?,?,?,?)",params![command.project,actor,command.command_id,request_hash,id])?;
        let changed = tx.execute(
            "UPDATE projects SET head=? WHERE id=? AND head=?",
            params![id, command.project, head.id],
        )?;
        ensure!(changed == 1, "conditional head update failed");
        if fault == Fault::BeforeCommit {
            injected_failure("injected crash before commit")?;
        }
        tx.commit()?;
        if fault == Fault::AfterCommit {
            injected_failure("injected response loss after commit")?;
        }
        self.revision(&command.project, id)
    }
    pub fn review(
        &mut self,
        actor: &str,
        project: &str,
        revision: i64,
        hash: &str,
        decision: &str,
        note: &str,
    ) -> Result<Value> {
        ensure!(actor == "local-owner", "reviewer not authorized");
        ensure!(
            ["approved", "rejected", "needs-adjudication"].contains(&decision)
                && note.len() <= 8192,
            "invalid review"
        );
        let view = self.view(project, Some(revision))?;
        ensure!(
            view.revision.snapshot_hash == hash,
            "review snapshot mismatch"
        );
        if decision == "approved" {
            ensure!(
                !view.issues.iter().any(|i| i.blocking),
                "unresolved issues block approval"
            );
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let head: i64 = tx.query_row("SELECT head FROM projects WHERE id=?", [project], |r| {
            r.get(0)
        })?;
        ensure!(head == revision, "review requires current exact revision");
        tx.execute("INSERT INTO reviews(project,revision,snapshot_hash,actor,decision,scope,note) VALUES(?,?,?,?,?,'full',?)",params![project,revision,hash,actor,decision,note])?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(
            json!({"review_id":id,"revision":revision,"snapshot_hash":hash,"decision":decision,"scope":"full","self_review":true}),
        )
    }
    pub fn diff(&self, project: &str, from: i64, to: i64) -> Result<Value> {
        let a = self.view(project, Some(from))?;
        let b = self.view(project, Some(to))?;
        let mut changes = Vec::new();
        for doc in &b.documents {
            if let Some(old) = a.documents.iter().find(|d| d.path == doc.path) {
                for t in &doc.tokens {
                    if let Some(before) = old.tokens.iter().find(|v| v.id == t.id) {
                        let keys: std::collections::BTreeSet<_> =
                            before.attrs.keys().chain(t.attrs.keys()).collect();
                        for key in keys {
                            if before.attrs.get(key) != t.attrs.get(key) {
                                changes.push(json!({"document":doc.path,"target":t.id,"field":key,"before":before.attrs.get(key),"after":t.attrs.get(key)}));
                            }
                        }
                    }
                }
                let ids: std::collections::BTreeSet<_> = old
                    .spans
                    .iter()
                    .chain(doc.spans.iter())
                    .map(|s| s.id.as_str())
                    .collect();
                for id in ids {
                    let before = old
                        .spans
                        .iter()
                        .find(|s| s.id == id)
                        .map(|s| {
                            serde_json::to_string(&json!({"anchors":s.token_ids,"fields":s.fields}))
                        })
                        .transpose()?;
                    let after = doc
                        .spans
                        .iter()
                        .find(|s| s.id == id)
                        .map(|s| {
                            serde_json::to_string(&json!({"anchors":s.token_ids,"fields":s.fields}))
                        })
                        .transpose()?;
                    if before != after {
                        changes.push(json!({"document":doc.path,"target":id,"field":"span","before":before,"after":after}));
                    }
                }
            }
        }
        let paths: std::collections::BTreeSet<_> = a
            .snapshot
            .files
            .keys()
            .chain(b.snapshot.files.keys())
            .collect();
        let files: Vec<_> = paths.into_iter().filter(|p| a.snapshot.files.get(*p) != b.snapshot.files.get(*p)).map(|p| json!({"path":p,"before":a.snapshot.files.get(p),"after":b.snapshot.files.get(p)})).collect();
        Ok(
            json!({"from":from,"to":to,"changes":changes,"files":files,"config_before":a.snapshot.config,"config_after":b.snapshot.config}),
        )
    }
    pub fn receipt(&self, project: &str, revision: i64) -> Result<Value> {
        let view = self.view(project, Some(revision))?;
        let reviews: Vec<Value> = self.conn.prepare("SELECT revision,snapshot_hash,actor,decision,scope,note,created_at FROM reviews WHERE project=? AND revision<=? ORDER BY id")?.query_map(params![project,revision], |row| Ok(json!({"revision":row.get::<_,i64>(0)?,"snapshot_hash":row.get::<_,String>(1)?,"actor":row.get::<_,String>(2)?,"decision":row.get::<_,String>(3)?,"scope":row.get::<_,String>(4)?,"note":row.get::<_,String>(5)?,"created_at":row.get::<_,String>(6)?,"self_review":true})))?.collect::<rusqlite::Result<_>>()?;
        Ok(
            json!({"package_manifest_version":1,"exporter":concat!("corpus-workbench/",env!("CARGO_PKG_VERSION")),"authority":"research-intelligence","revision":view.revision,"snapshot":view.snapshot,"approved":view.approved,"completeness":"all included artifacts and resolved media; TEITOK runtime is a separately pinned dependency; executable dependencies inert until explicitly enabled","external_id_map":view.documents.iter().map(|d|json!({"document":d.path,"tokens":d.tokens.iter().map(|t|json!({"external":t.id,"internal":t.internal_id})).collect::<Vec<_>>()})).collect::<Vec<_>>(),"issues":view.issues,"history":self.history(project)?.into_iter().filter(|r|r.id<=revision).collect::<Vec<_>>(),"reviews":reviews,"derived_generations":self.generations(project,true)?.into_iter().filter(|g| g["revision"].as_i64().is_some_and(|r| r<=revision)).collect::<Vec<_>>()}),
        )
    }
    pub fn export(&self, project: &str, revision: i64, dir: &Path) -> Result<()> {
        let view = self.view(project, Some(revision))?;
        // Export immutable lineage objects as well as current package data. Reopen
        // in TEITOK uses the current files; history is separately inspectable.
        let mut history = BTreeMap::new();
        for rev in self
            .history(project)?
            .into_iter()
            .filter(|r| r.id <= revision)
        {
            let snapshot = self.snapshot(&rev)?;
            let bytes = self.objects.read_hash(&rev.snapshot_hash)?;
            history.insert(rev.snapshot_hash.clone(), bytes);
            for artifact in snapshot.files.values() {
                if !history.contains_key(&artifact.sha256) {
                    history.insert(artifact.sha256.clone(), self.objects.read(artifact)?);
                }
            }
        }
        let receipt = self.receipt(project, revision)?;
        for generation in receipt["derived_generations"]
            .as_array()
            .context("generation manifest")?
        {
            for field in ["receipt_hash", "graph_hash"] {
                let hash = generation[field]
                    .as_str()
                    .context("generation object hash")?;
                history.insert(hash.into(), self.objects.read_hash(hash)?);
            }
            let hash = generation["receipt_hash"].as_str().unwrap();
            let completion: crate::handoff::Completion =
                serde_json::from_slice(&self.objects.read_hash(hash)?)?;
            let hash = completion.binding.contract_hash;
            history.insert(hash.clone(), self.objects.read_hash(&hash)?);
        }
        package::export_directory_with_history(
            &self.objects,
            &view.snapshot,
            dir,
            &receipt,
            &history,
        )
    }
    pub fn approved_contract(&self, project: &str, revision: i64) -> Result<Value> {
        let view = self.view(project, Some(revision))?;
        ensure!(
            self.head(project)?.id == revision && view.approved,
            "current approved revision required for default compiler export"
        );
        Ok(
            json!({"contract_version":1,"authority":"research-intelligence","project_id":project,"revision":view.revision,"bundle_hash":view.revision.snapshot_hash,"config_hash":package::hash(&serde_json::to_vec(&view.snapshot.config)?),"definition_version":view.snapshot.config.version,"definitions":view.snapshot.config,"artifact_manifest":view.snapshot.files,"rights":view.snapshot.config.rights,"access_policy":"local-only; public/model-training permission not implied","documents":view.documents,"review":self.receipt(project,revision)?["reviews"].as_array().context("review records")?.last().context("approved review")?,"ingestion_status":"not tested; no Semantica dispatch performed by this contract endpoint"}),
        )
    }
    pub fn backup(&self, destination: &Path) -> Result<()> {
        ensure!(!destination.exists(), "backup destination exists");
        fs::create_dir_all(destination)?;
        let mut target = Connection::open(destination.join("ledger.sqlite"))?;
        let backup = rusqlite::backup::Backup::new(&self.conn, &mut target)?;
        backup.run_to_completion(16, std::time::Duration::from_millis(10), None)?;
        drop(backup);
        drop(target);
        fs::create_dir(destination.join("objects"))?;
        // Preserve all verified committed objects, including historical states.
        let mut hashes = std::collections::BTreeSet::new();
        hashes.extend(self.generation_objects()?);
        for rev in self.all_revisions()? {
            hashes.insert(rev.snapshot_hash.clone());
            for f in self.snapshot(&rev)?.files.values() {
                hashes.insert(f.sha256.clone());
            }
        }
        for hash in hashes {
            fs::write(
                destination.join("objects").join(&hash),
                self.objects.read_hash(&hash)?,
            )?;
        }
        Store::open(destination)?;
        Ok(())
    }
    fn generation_objects(&self) -> Result<Vec<String>> {
        let mut hashes = Vec::new();
        for item in self
            .conn
            .prepare("SELECT receipt_hash,graph_hash FROM derived_generations")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        {
            let (receipt, graph) = item?;
            let completion: crate::handoff::Completion =
                serde_json::from_slice(&self.objects.read_hash(&receipt)?)?;
            hashes.push(completion.binding.contract_hash);
            hashes.extend([receipt, graph]);
        }
        Ok(hashes)
    }
}
