# Local release qualification 0.2.0-dev.7

This bounded follow-on qualifies dependency/license, image assessment and
synthetic upgrade/rollback gates. It does not finish the migration plan or publish
a source branch, container or production service.

## Checklist

- [x] Inspect the exact omitted-tool source/tree; choose a documented official pin
  instead of inventing license text: [ADR 0002](ADR-0002-BUILD-TOOL-LICENSE.md).
- [x] Scan immutable dev.6 image archive with Trivy 0.75.0 and a dated local database,
  offline, without Docker socket, credentials or artifact uploads.
- [x] Install exact available Debian fixes from signed 2026-10-04 snapshot indexes:
  PCRE2 `10.42-1+deb12u2`, timezone data `2026c-0+deb12u1`.
- [x] Identify old statically bundled SQLite outside scanner coverage; update and
  inventory SQLite 3.53.2 explicitly: [ADR 0003](ADR-0003-SQLITE-QUALIFICATION.md).
- [x] Full Windows/Linux amd64 native suites (134), Rustfmt/Clippy, all eighteen
  host Chrome flows and an additional exact-container browser/persistence journey.
  Independent native rerun and Windows nested-notice packaging probe pass.
- [x] New image assessment with the same pinned scanner/database; both available
  fixes disappear, while remaining findings stay visible.
- [x] Synthetic dev.6 -> dev.7 upgrade, new edits/reviews/restart, compatible old
  reopen on a clone, retained old-image/pre-upgrade-backup rollback. Both backup
  sources remain byte-identical; ten named volumes are retained.
- [ ] Trusted direct source/container publication approval.
- [ ] Hosted native ARM64 and CM5 hardware/resource/power-loss qualification.

## Scan evidence and limits

Pinned scanner: `aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa`.
Database updated 2026-10-04 14:28:15 UTC, downloaded 17:51:16 UTC;
SHA256 `56541703ce09940d1c86efc66a3f5abcf459c3f3bd405974f56b4611462aaae5`.
The initial archive identifies image config `75b4ac4e...`, 88 Debian packages and
73 Cargo packages. It reports 236 Debian package/advisory pairs: 4 critical,
53 high, 102 medium, 75 low and 2 unknown. These repeat source advisories across
binary packages; they are not 236 independently proven application exploits.
Two entries have available Bookworm fixes, now pinned above. Initial Cargo results
contain no known advisories. After the fixes, 234 Debian package/advisory pairs
remain (105 unique advisories): 4 critical, 52 high, 102 medium, 75 low and 1 unknown.
There are zero entries with an available fixed Bookworm version in this database
snapshot. This does not waive the remaining 180 affected, 40 deferred and 14
will-not-fix pairs. The new Cargo lock scan identifies 76 packages with no known
advisories, and the exact-lock Cargo/npm audits report zero vulnerabilities.
The image scan detects only the UI root package, so
the separate exact-lock npm audit is necessary for build dependencies.

No finding is silently suppressed. Debian's [zlib CVE notes](https://security-tracker.debian.org/tracker/CVE-2023-45853)
explain that vulnerable contrib/minizip is not built into these Bookworm binaries.
The [ncurses finding](https://security-tracker.debian.org/tracker/CVE-2025-69720)
refers to the included infocmp CLI; it remains an unresolved package finding.
The native authoring binary links only libc, libm and libgcc_s; this is evidence
about linkage, not proof that every other package is unreachable. Deferred/unfixed
Debian findings remain visible and require continued operational review. The
[PCRE2 vendor tracker](https://security-tracker.debian.org/tracker/CVE-2026-103111)
and [timezone update](https://security-tracker.debian.org/tracker/DLA-4792-1)
support the two applied fixes.

This scans known advisories from one database snapshot, not unknown vulnerabilities,
application logic, host kernel/Docker/Chrome, optional Python workers/models or
physical hardware. Statically bundled C, Rust standard library, UI build tools and
actual feature reachability require separate evidence. No blanket security or
legal clearance follows from a completed scan.

## Exact tested behavior and review repairs

Functional source `94d1a99ea2e848ed263a2bdf6e409c8463fb7c00` produces local
dev.7 amd64 image `e9f31c095a283b3e4bd05c44fddd3e7a093a8448be62a1fde0ff416e844ed8f5`.
A later documentation-only image records its own source/digest in local evidence.
The upgrade uses immutable inspected image IDs throughout. The test retains the
old dev.6 image/config and closed pre-upgrade checkpoint, restores a fresh dev.7
clone, compares exact R2/history/review, commits R3, rejects a stale edit and
restarts with a new session. An old-image post-upgrade clone preserves exact R3;
conservative rollback restores R2 and verifies the original old authority. Every
exported artifact and served synthetic audio hash matches the exact snapshot.

Independent review repaired mutable tag execution and a reproduced Windows
cp1252 manifest-decoding failure. The isolated notice probe now copies all eighteen
installed npm packages, including exact parent Rollup grants for nested platform
packages. A first harness run found a CookieJar/helper name collision before any
edit; the repair passes the complete fresh-volume journey. Failed-run volumes are
retained as well. The final image/source inventory is reviewed separately; no
preview service, original corpus, user session or earlier QA volume is replaced.

The Docker Desktop engine is amd64. Existing emulation support is not native
ARM64 hardware, so this qualification makes no native ARM64/Pi claim and installs
no emulator or new privileged builder. Native runner CI is configured but blocked
from hosted execution by pending source publication authorization. Continued OS
finding triage, native hardware/resource/power-loss evidence and explicit source/
registry publication approval remain gates.

## Repeat the compatible-version test

```sh
python scripts/container-upgrade-smoke.py --old-image OLD_LOCAL_IMAGE --new-image NEW_LOCAL_IMAGE --port 18922 --out .runtime/fresh-upgrade.local.json
```

The harness requires distinct exact-source version labels and an unused loopback
port. It creates only fresh synthetic Compose projects; clones closed verified
backups into new volumes, compares exact revisions/snapshots/history/reviews,
checks idempotent receipts, stale rejection, media/export hashes and session
rotation. It hashes both backup sources before and after cloning. It stops only
its own containers and retains every named volume. Rollback selects the retained
old image/pre-upgrade data pair. Compatible old-engine reopen uses a separate
post-upgrade clone; this is no promise of arbitrary future-schema downgrade.
