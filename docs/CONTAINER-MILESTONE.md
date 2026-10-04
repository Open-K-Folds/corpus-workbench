# Container milestone 0.2.0-dev.6

This local engineering increment follows reader `5e8bcda` and independently
reviewed frontend `f9fb8b1`. It packages the existing native evidence authority,
without changing corpus interpretation, token IDs, artifact preservation or
compiler lineage. [CONTAINERS.md](CONTAINERS.md) provides the runnable workflow,
backup/clone restore and controlled upgrade/rollback instructions.

## Completed and tested locally

- Version/digest-pinned official Rust/Node/Debian stages and signed date-pinned
  build packages; locked Cargo/npm dependencies and architecture metadata.
- Clean exact-source helper and CI build from isolated Git archive contexts.
  An independent adversarial probe placed an ignored file beneath src: it entered
  an ordinary working-tree Docker context, but was excluded by the repaired exact
  archive helper. Root private/runtime/Git/caches are excluded as well.
- UID/GID 10001, read-only root, dropped capabilities, no-new-privileges, bounded
  resources and only host-loopback port publication. New persistent named volumes
  initialize with native-writable restrictive ownership. No socket/host networking.
- Explicit synthetic initialization, refusal of demo resets, ordinary serving of
  existing authorities and minimal readiness that checks current artifact hashes.
- Immediate transactional schema DDL/version changes, restart after abrupt exits,
  concurrent migration, and future-version refusal without journal/byte changes.
- Opt-in closed-backup read-only SQLite, URI-safe paths and schema/sidecar/object
  checks. Verified native backup/restore preserves source bytes and exact history.
- Actual Linux amd64 Compose service and isolated Chrome: generated audio plays;
  lexical correction, diff, undo, exact review and complete download work; mobile
  fits; no page errors/external requests. Every exported artifact hash matches the
  saved snapshot. A fresh cloned-volume restore and server recreation preserve
  exact revision/hash, with a new session and no silent reset.
- Full 133-test native suites on Windows x86-64 and Docker Desktop's Linux amd64
  engine, Rustfmt/Clippy, TypeScript/Vite and all eighteen host browser flows.
  Nine new native tests cover migration, readiness and closed backups.
- Packaged application corresponding source, notices, scoped SPDX2.3 component
  inventory and per-file SHA256SUMS. The first local working image has 164 component
  entries (165 SPDX packages including the application) and 322 checksummed files;
  later exact-source manifests record their own identities/counts.

Independent review repaired six demonstrated boundary issues: immutable package
permissions, writing to read-only backup sources, restored-store selection,
corresponding-source omissions, ignored build-context disclosure and future-schema
journal changes. Actual runtime verification follows those repairs. Evidence is
kept in private local JSON files; public docs contain synthetic-only facts.

## Remaining gates

The image has been built and tested locally, not published. Source push approval
is unresolved; container publication cannot bypass that blocker. Native ARM64
GitHub CI is configured but has not run, and Pi/CM5 hardware/resource/physical
power-loss checks have not run. No multi-platform or production deployment claim
is made. Same-version recreation and verified clone restore are proven; real
cross-version upgrades/downgrades require separate tests and retained image/data
pairs. A comprehensive external image vulnerability scan is also a release gate.

One optional Linux x64 Rollup build tool omits upstream license text. Its declared
MIT metadata is retained with an explicit status, and its code/binary is absent
from the runtime; license review remains a publication gate. The inventory is not
legal clearance. TEITOK GPLv3+ notices and attribution remain; no AGPL LaBB-CAT code
is copied and corpus rights remain separate. Omnilingual/GPU/model/aligner worker
images stay resource-gated and separate pending their durable native job contract.

Broader format/schema editing, shared roles, durable drafts/jobs, CWB/CQP parity and
the remaining approved migration backlog remain ongoing work.
