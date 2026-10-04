# Local Trixie runtime qualification 0.2.0-dev.8

The one authorized Debian 13 runtime candidate passes bounded local amd64
qualification. Application contracts, source/tests/assets, UI source, dependency
graphs, LICENSE/NOTICE and Compose settings remain unchanged from dev.7. Only the
application version metadata changes alongside container build/qualification
support. Production acceptance, publication and native ARM64/Pi remain gates.

## Exact candidate and package inventory

Tested implementation source: `de99c29675512f0149a7e8ef0aed8a6939b27e55`.
Retained local tag: `corpus-workbench:0.2.0-dev.8-de99c2967551-amd64`.
Immutable local OCI index/image ID:
`sha256:0618e2084e0425f82f92a8f1568b30b54476f2f7c4acf815edae39c4d2e3e7d1`.
Its amd64 manifest is
`sha256:6180f8d11214a4539dcb0fc057386558cdc2cf6d5d148dc549a878ba31ec6549`;
runtime config is
`sha256:bc14e2e05be1ef66f470fe8aee040eaf3d0be1837484dfc3ff9b304d065cee64`.
Documentation added after qualification records this candidate; it does not
retag it or substitute a later source commit for the tested source.

[ADR 0004](ADR-0004-TRIXIE-RUNTIME.md) records the official pinned base index,
architecture manifests and signed snapshot choice. The runtime base is
`debian:trixie-slim@sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a`.
Rust 1.90.0/Node 24.18.0 Bookworm builder pins remain unchanged. Against the signed
2026-10-04 snapshot, APT upgraded exactly three installed packages, added none,
removed none and held none:

- `libpcre2-8-0 10.46-1~deb13u3`
- `libssl3t64 3.5.7-1~deb13u3`
- `openssl-provider-legacy 3.5.7-1~deb13u3`

The final [78-package inventory](../evidence/trixie-runtime-packages.tsv) records
complete binary/source versions, including epochs, Debian revisions and t64
renames. It matches the actual final dpkg census and packaged SPDX inventory.
The dev.7 inventory has 88 packages; distribution composition changed, without
forcing removal of essential packages. The native executable dynamically links
only libc, libm, libgcc_s and the Trixie loader. Its bundled SQLite remains the
explicitly inventoried and tested 3.53.2.

## Completed checks

- [x] Windows native: Rustfmt, Clippy with warnings denied, 134 contracts; isolated
  build directory preserves the active native service.
- [x] Native Linux amd64 Bookworm build/test: same formatting/lint gates and 134
  contracts, locked dependencies.
- [x] Actual Trixie loader: same 134 compiled contracts and debug recovery CLI,
  nonroot/read-only/networkless runtime-contracts image. Independent rerun: 134/134.
  Compiler, Node, Python, test executables and runner are absent from production.
- [x] TypeScript/build and eighteen isolated host Chrome flows: 18 expected, zero
  failures/skips/flaky results. Compiled UI bytes independently match dev.7.
- [x] Additional exact production-container browser journey: playback, edit,
  diff/undo, review/export and mobile interaction; exact artifact/audio hashes,
  session/origin guards, persistence, closed backup/restore and recreation.
- [x] Dev.7 -> candidate on fresh synthetic authority/backup clones: all eight
  upgrade/rollback checks pass, independently repeated on a separate port. Exact
  R2/history/review survives, R3 is authored/reviewed, receipts remain idempotent,
  stale edits reject and restart rotates the session. The old image reopens a
  post-upgrade schema-2 clone; conservative rollback restores its R2 checkpoint.
  Both closed backup sources remain byte-identical. Each run retains ten volumes.
- [x] Exact-lock audits: cargo-audit 0.22.2 against the retained 1,290-advisory
  RustSec snapshot: zero vulnerabilities/warnings; npm registry audit: zero.
  Complete lock comparisons differ only in application version metadata.
- [x] Image/source/license audit: 316 checksummed files, 87 byte-exact corresponding
  source files, 153 notice components and 154 SPDX packages. All 78 available
  OS copyright texts are retained byte-for-byte; SQLite dedication retained,
  zero metadata-only license exceptions. GPL notices remain unchanged.
- [x] Source/history privacy: 98 tracked UTF-8 files, 247 reachable blobs across
  16 commits, zero protected-fixture filename markers, noreply-only authors.
  Offline Gitleaks source/history scans report zero findings. Protected originals
  and fixture copies remain unchanged; only synthetic data enters containers.
- [x] Independent image/source/scan/native/upgrade review: bounded PASS for the
  exact source and immutable image above; no demonstrated correctness blocker.

Initial concurrent upgrade attempts stopped because Docker's default address
pools were exhausted. Only eighteen exact, known completed workbench QA networks
were removed, after checking their Compose owners and zero container attachments.
No daemon/network-security setting changed; every volume, prior image, user
network and existing service was preserved. Fresh unchanged harness reruns pass.

## Actual comparative scan

Both archives were scanned offline using
`aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa`.
Same database:updated `2026-10-04T14:28:15.152965452Z`, SHA256
`56541703ce09940d1c86efc66a3f5abcf459c3f3bd405974f56b4611462aaae5`.
Candidate archive SHA256:
`a607cdb878d73d964214bb3120607438ed392d947e0d2f0acff7985c62337136`;
candidate raw report SHA256:
`ef9fdf7407acc6be416ff1ce4e60b1a7701ca839d6853b69ddfb667353ff3f77`.
The report binds the actual runtime config and exact source labels above.

| Measure | Exact dev.7 | Exact Trixie candidate |
| --- | ---: | ---: |
| Package/advisory pairs | 234 | 164 |
| Unique advisory IDs | 105 | 73 |
| Critical pairs / unique IDs | 4 / 4 | 0 / 0 |
| High pairs / unique IDs | 52 / 14 | 43 / 8 |
| Medium pairs / unique IDs | 102 / 46 | 60 / 31 |
| Low pairs / unique IDs | 75 / 40 | 59 / 32 |
| Unknown pairs / unique IDs | 1 / 1 | 2 / 2 |
| Available fixed-version entries | 0 | 0 |

Thirty-seven old IDs disappear and five new IDs appear. Binary-pair delta is
93 removed and 23 added; renamed packages are distinct from resolved advisories.
Current status is 162 affected and two deferred pairs. All raw findings and the
complete 73-ID matrix remain in local evidence, without suppressions. These are
package/source matches rather than 164 proven authoring-service exploits. Cargo
image results identify 76 packages with zero findings. Node detection covers
only the UI root; the separate exact-lock npm audit covers build dependencies.

All four prior critical IDs are absent. Actual dpkg comparisons verify the full
installed Debian versions meet the vendor fixes:

| Advisory | Installed source version | Debian fixed version |
| --- | --- | --- |
| [CVE-2026-13221](https://security-tracker.debian.org/tracker/CVE-2026-13221) | perl `5.40.1-6+deb13u1` | `5.40.1-6+deb13u1` |
| [CVE-2026-42496](https://security-tracker.debian.org/tracker/CVE-2026-42496) | perl `5.40.1-6+deb13u1` | `5.40.1-6+deb13u1` |
| [CVE-2026-8376](https://security-tracker.debian.org/tracker/CVE-2026-8376) | perl `5.40.1-6+deb13u1` | `5.40.1-6+deb13u1` |
| [CVE-2023-45853](https://security-tracker.debian.org/tracker/CVE-2023-45853) | zlib `1:1.3.dfsg+really1.3.1-1` | `1:1.3.dfsg-2` |

This resolves the candidate's prior critical version gate through Debian fix
evidence, rather than assuming that upstream version numbers account for Debian
backports or waiving Bookworm's contradictory Perl introduction table.

Four new IDs concern shipped OS `libsqlite3-0 3.46.1-7+deb13u2`:medium
CVE-2026-50812/50813 and low CVE-2021-45346/CVE-2025-70873. They remain visible,
even though this library is not the native workbench's linked SQLite 3.53.2 and
does not appear in its dynamic linkage. The fifth new ID is xz-utils/liblzma5
`TEMP-1147318-639065`, unknown severity. No component is removed to hide findings.

## Remaining decision and stopping point

The eight current high IDs cover infocmp, ACL, systemd-homed, Archive::Tar and
four util-linux conditions. Actual image probes retain included infocmp/mount/
nsenter findings; homed and Archive::Tar are absent, Perl word size is 64-bit and
all runtime setuid/setgid program bits are gone. These conditions inform
applicability; they neither patch included libraries/tools nor suppress raw
source-expanded findings. Capability drops and no-new-privileges remain enabled.

[CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091)
still has a vendor-table/introduction conflict: the notes identify an introduction
in zlib 1.3.1.2, while Trixie's 1.3.1 source version is marked vulnerable. Keep
the raw medium finding open pending exact-source/backport reconciliation.

An operational owner must still decide the intended production profile's
acceptance/mitigation and patch-refresh policy for the remaining findings.
There is no automatic blanket waiver from zero critical findings. Native ARM64
CI and actual CM5 4-GB resource/power-loss testing have not run. Publication awaits
trusted direct authorization; no source/registry upload or deployment occurred.
The builder OS, host/kernel/Docker/Chrome, optional workers/models and unknown
vulnerabilities are outside this runtime scan. License inventory is not legal
clearance; corpus rights remain separate. The full migration backlog remains open.

Stop here with this one tested local candidate and retained dev.7 rollback
image/data; no second base or unrelated technology replacement is selected.

## Reproduce on fresh synthetic data

```sh
python scripts/build-containers.py --platform linux/amd64
python scripts/container-smoke.py --image IMMUTABLE_CANDIDATE_ID --port 18928 --out .runtime/fresh-trixie-browser.local.json --browser
python scripts/container-upgrade-smoke.py --old-image IMMUTABLE_DEV7_ID --new-image IMMUTABLE_CANDIDATE_ID --port 18930 --out .runtime/fresh-trixie-upgrade.local.json
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
npm run build --prefix ui
npm run test:e2e --prefix ui
cargo audit --db .runtime/rustsec-db --no-fetch --deny warnings
npm audit --prefix ui --audit-level=low
```

Use unused loopback ports and fresh evidence output paths. A new source commit
produces its own source-labelled image; it does not inherit this digest's proof.
Build support, database/reports, test logs and independent review are checksummed
in the ignored local milestone evidence.
