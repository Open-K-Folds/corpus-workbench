# Local container workflow

The container uses the same native SQLite authority, immutable artifacts and
TypeScript UI as the Windows workbench. Schema remains version 2. It does not
introduce a second ledger, external database, public service or speech model.
Official Rust 1.90.0, Node 24.18.0 and Debian Bookworm base manifests are pinned in
Dockerfile; compiler packages use signed Debian snapshot indexes dated 2026-09-18.
Cargo/npm locks fix application dependencies. Builds use the existing Docker
engine/BuildKit, without a privileged builder or Docker socket mount in the app.
Pinned inputs and recorded artifact checksums are provided; bit-identical builds
across compilers, platforms or separate builds have not been established.

## Build and run

Docker with Compose, Python 3.11+ and Git are required. From a clean commit:

```sh
python scripts/build-containers.py
```

Use the exact image tag printed by the helper as `WB_IMAGE`. It tests the native
build stage before building the runtime, supplies the actual source commit, and
never publishes anything. Its Docker context is an isolated `git archive HEAD`,
so ignored/untracked files cannot enter an exact-commit image. Direct `docker build`
or Compose builds are development working-tree builds, labeled working-tree;
they are not the exact-source/publication path. Set environment variables with your shell's syntax;
PowerShell example:

```powershell
$env:WB_IMAGE='corpus-workbench:<version>-<commit12>-amd64'
$env:WB_PORT='18920'
docker compose -p my-synthetic-workbench run --rm tools init-demo
docker compose -p my-synthetic-workbench up -d --no-build authoring
docker compose -p my-synthetic-workbench exec -T authoring cat /data/.runtime/Open-Workbench.html
```

Open the protected link from that HTML locally. Its session capability is private;
do not place it in issue reports, public logs or a repository. The readiness URL
is `http://127.0.0.1:18920/health/ready` and returns only ready/unavailable status.
The default port can change through `WB_PORT`; the same port is used inside and
outside the container so Origin/session checks remain exact. Compose publishes
only to 127.0.0.1. Native host mode still binds only to loopback; the explicit
container flag requires Linux/container markers and an unprivileged port.

`init-demo` is explicit, synthetic and refuses an existing authority. Normal
startup requires a previously imported project and never recreates a demo. Each
Compose project has separate persistent authority, runtime and backup volumes.
The authority volume holds ledger.sqlite, WAL and all immutable objects together;
runtime contains private session launchers and exports. New volumes initialize
from image-owned UID/GID 10001 directories. Existing bind mounts require that
owner and restrictive permissions; this workflow never silently chowns user data.
Do not use `down -v`, `volume prune`, shared authority volumes across servers, or
automated data cleanup. Stop this project with `docker compose -p NAME stop`.

For an authorized real package, use a separate Compose project/authority and a
read-only bind mount at `/input`, then run the image's native `import --store
/data/authority --project ID --package /input`. Set `WB_PROJECT=ID` when serving.
Use a private full package copy, including settings, schema, sidecars and media.
Never include that mount in a Docker build context or publish it. Corpus rights
remain separate from the GPL software license.

## Check, backup and restore

```sh
docker compose -p NAME run --rm tools check --store /data/authority
docker compose -p NAME run --rm tools backup --store /data/authority --out /backups/NEW-NAME
docker compose -p NAME run --rm tools check --store /backups/NEW-NAME
```

Backup uses SQLite's backup API, copies all referenced historical artifacts and
checks a clean restore. Destination must be fresh. A direct copy of a live WAL
database is insufficient. Stop writers when preparing a controlled upgrade.
Retain the old immutable image ID/digest, old authority and verified backup.
Restore to a fresh isolated volume by mounting backups read-only and running the
native `backup --readonly-backup yes --store /backups/NEW-NAME --out /data/authority/restored`; select
that fresh subdirectory with `WB_STORE=/data/authority/restored`. Use a separate
runtime volume/port for validation, compare exact head/hash/history, then choose
the new project deliberately. Do not mutate the old volume for upgrade testing.

Schema DDL and its version marker commit in one immediate transaction. Concurrent
startup rereads the version under the writer lock; abrupt process exit before
commit rolls the migration back. Unknown future schema versions are refused.
Process-crash recovery is tested; physical power loss is a separate gate.
Rollback selects the retained old image and untouched old volume. An old binary
must never open a newer migrated volume unless a separately proven compatible
migration supports it. The dev.6 milestone verifies same-version image recreation and clone restoration.
Dev.7 adds the bounded two-version harness described in release qualification;
it does not promise arbitrary future-schema downgrade or production cutover.

## Contracts and artifacts

```sh
python scripts/container-smoke.py --image IMAGE --port 18920 --out .runtime/fresh-container.local.json --browser
```

Install the pinned UI dependencies (`npm ci --prefix ui`) and Chromium through
Playwright for this isolated browser probe. On Windows `WB_CHROME` can name an
installed Chrome executable. The probe creates a fresh synthetic Compose project,
checks UID/root filesystem/loopback/capability boundaries, plays generated audio,
edits, compares, undoes, reviews and downloads a complete hash-verified export. It
checks verified backup/clone restore and recreates the server without losing the
saved revision. It stops only its own containers and retains named volumes.

The image includes `/opt/workbench/BUILD.json`, `SBOM.spdx.json`, `SHA256SUMS`,
license notices and complete application corresponding source. The SPDX inventory
includes the resolved Cargo graph, installed npm build/test dependencies, Rust
standard library and Debian runtime package list, with scope comments; absent
optional platform npm tools are excluded. OS declared licenses use NOASSERTION
and retain base-image copyright texts where available. This is an inventory,
not legal clearance. Dev.7 pins official Rollup 4.62.2 to remove the optional tool
with omitted upstream license text; complete retained notices are required.
See [ADR 0002](ADR-0002-BUILD-TOOL-LICENSE.md) for the temporary pin and tradeoffs,
and [release qualification](RELEASE-QUALIFICATION.md) for offline image assessment,
SQLite engine evidence and the bounded cross-version harness. The image excludes Git history,
credentials, private fixtures, real recordings/transcripts, model caches and
compiler/Node/Python runtimes. The generated synthetic tone is clearly marked.

`container-contracts` CI config tests Linux amd64 and ARM64 on separate native
GitHub runners, including actual browser/persistence checks. Local amd64 execution
and any ARM64 emulation are reported separately. Configuring CI does not prove it
ran. Windows native tests remain in the existing CI matrix. Raspberry Pi/CM5
hardware, 4 GB resource qualification and production operations remain gates.
The tested cross-version pair is recorded in release qualification.

The explicit read-only backup opener requires schema 2 and a complete, closed
checkpoint with no WAL/SHM files. It verifies committed artifact hashes and uses
immutable/read-only SQLite without migrating or creating source-side files. Do
not use this mode on a live authority; a schema-1 backup must first be copied to a
writable isolated clone for migration.

Omnilingual remains a separate Python Khan worker with GPU FP32/default CPU
fallback. This image contains no CUDA, speech model, alignment toolkit or worker.
A GPU worker image/profile is deferred until its pinned image, model/license,
resource budget and durable native job/outbox contract are established; no large
ASR image is pulled or worker rebuilt by this workflow.

Publication target, when source authorization is resolved, is
`ghcr.io/open-k-folds/corpus-workbench`. No local helper pushes images. Before any
publication, require accepted source-push authorization, exact-head review/tests,
platform evidence, private-data/license inventory, unique version/commit tags,
OCI revision/license metadata, immutable manifest digests and retained SBOM/
checksums. Publishing a single architecture must not be described as a complete
multi-platform release. Original v0.1.0-preview.1 assets and tags remain immutable.

Docker's documented [multi-platform build strategies](https://docs.docker.com/build/building/multi-platform/),
[digest pinning guidance](https://docs.docker.com/build/building/best-practices/) and
[Compose port syntax](https://docs.docker.com/reference/compose-file/services/#ports)
inform this workflow; actual validation is recorded separately.
