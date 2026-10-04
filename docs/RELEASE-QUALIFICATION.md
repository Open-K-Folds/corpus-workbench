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
- [ ] Full exact-source tests/review and new image assessment.
- [ ] Synthetic dev.6 -> dev.7 upgrade, new edits/reviews/restart, compatible old
  reopen on a clone, retained old-image/pre-upgrade-backup rollback.
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
contain no known advisories. The image scan detects only the UI root package, so
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
