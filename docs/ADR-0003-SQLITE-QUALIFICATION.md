# ADR 0003: qualify the bundled SQLite update explicitly

Status: adopted for local release qualification, 2026-10-04.

The image scanner recognizes Cargo.lock and the Rust wrapper, but not SQLite C
statically linked by libsqlite3-sys. Dev.6 uses rusqlite 0.32.1 / libsqlite3-sys
0.30.1 / SQLite 3.46.0. A zero Cargo advisory count therefore does not qualify
that engine. SQLite's own CVE notes describe newer fixes, including malicious
SQL/FTS inputs. The authoring API supplies fixed parameterized SQL, but native
backup verification does open supplied database files. No application exploit
has been demonstrated by this qualification.

Update the official wrapper to exact rusqlite 0.40.2 and locked libsqlite3-sys
0.38.2, bundling SQLite 3.53.2. Retain SQLite public-domain text and report the
engine as a separate linked component in the image inventory. CLI `check` reports
the compiled engine version; a native contract compares both its C API and SQL
`sqlite_version()` with 3.53.2. This catches mistaken system linkage and future
bundle drift. No database schema, artifact hash or evidence interpretation change
is intended; the authority remains schema 2.

Maintenance/reliability/security: follow the maintained upstream wrapper rather
than hand-patching an old C amalgamation. Cargo/npm audits, full Windows/Linux
contracts, browser acceptance and exact old/new backup compatibility are required
after the update. Older image/pre-upgrade backup pairs stay available; compatible
reopen evidence applies only to the tested pair, never arbitrary future formats.
The published upstream SQLite fixes are not a whole-system security clearance.

Licensing/ecosystem: official crates.io checksums, MIT wrapper and SQLite's retained
public-domain notice; no new database service or duplicate ledger. Target-specific
unused WASM dependencies remain distinguishable from the actually built native
graph. Inventory data rights and TEITOK GPLv3+ obligations remain separate.

Compatibility/cost: keep Rust 1.90.0 and bundled compilation on Windows and Linux,
including the configured native ARM64 runner. No paid service, model download or
Pi deployment. Native ARM64/CM5 validation remains a gate. This is a bounded
dependency update to the existing authority, with rollback qualification, not a
storage/framework replacement.

Primary evidence: [rusqlite 0.40.2 metadata](https://crates.io/api/v1/crates/rusqlite/0.40.2),
[libsqlite3-sys 0.38.2 metadata](https://crates.io/api/v1/crates/libsqlite3-sys/0.38.2),
[SQLite CVE analysis and fixes](https://sqlite.org/cves.html),
[SQLite 3.53.2](https://sqlite.org/releaselog/3_53_2.html).
