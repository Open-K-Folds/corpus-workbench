# ADR 0004: bounded Debian 13 runtime qualification

Status: one local candidate selected for qualification; production signoff and
publication remain gated. This updates the runtime compatibility choice in
[ADR 0001](ADR-0001-CONTAINER-RUNTIME.md), retaining native Rust, TypeScript,
SQLite 3.53.2, all application contracts and the single revision authority.

## Evidence and choice

The exact dev.7 Bookworm image has 234 Debian package/advisory pairs representing
105 advisory IDs, not 234 proven authoring-service exploits. The dated Trivy
0.75.0 assessment found no remaining fixed Bookworm versions. Debian 13 Trixie is
the [current stable release](https://www.debian.org/releases/); full Bookworm
support ended 2026-07-11 with LTS continuing to 2028-06-30. Trixie full support
runs to 2028-08-09. At the qualification baseline Debian's tracker resolves 28 of
the current 105 source-advisory groups in Trixie repositories. This comparison is
not a scan or total-finding prediction for the candidate image.

Choose one official `debian:trixie-slim` runtime index:
`sha256:a99cfc517144bc59b1978475ec53b46ecabec7e43635402ee5b77cc54cd1b20a`.
Its inspected amd64 manifest is
`sha256:7792b1f7702a86946cd518db72b6a407302c3e9bc1635634368b878189e8221c`;
the arm64 manifest is
`sha256:da496358bd6934d2bd6a563a33176a2e50eff5490c54b4ac6fb051b69fef4071`.
Neither an ARM64 manifest nor emulation proves native ARM64/Pi validation.
Keep the Rust 1.90.0 and Node 24.18.0 Bookworm builder digests and dependency pins
unchanged. Update the runtime from signed, immutable 2026-10-04 snapshot indexes
for Trixie, Trixie updates and Trixie security; inventory every installed exact
Debian version rather than retain Bookworm-specific package-version pins.
The upgrade allows required new dependencies without removing installed packages;
the build rejects any remaining upgraded/new/removed/held package actions in a
post-update simulation against those same signed snapshot indexes.

Remove unused setuid/setgid mode bits from runtime-base programs. The native
authoring, health and backup commands do not need those privilege transitions.
This is file-permission hardening, not a patch or suppression of a package CVE.
Do not remove essential packages. UID 10001, read-only root, capability drops,
no-new-privileges, resource limits, session/CSRF behavior and existing host-loopback
publication remain unchanged. No daemon, network policy, production service,
registry upload, paid service, GPU worker or model installation is introduced.

## Required qualification and retained limits

Run the existing Windows native suite and Bookworm-built native Linux suite.
Also execute the same compiled test executables/core debug CLI in a separate
Trixie `runtime-contracts` image, nonroot/read-only/networkless with a temporary
filesystem. Preserve absolute embedded recovery-CLI paths. These test binaries
and their runner are absent from the production image. No application test is
changed to accommodate the base replacement.

Run TypeScript/build and all eighteen isolated host browser flows, actual
candidate-container playback/edit/diff/undo/review/export, persistent storage,
and exact dev.7-to-candidate upgrade/closed-backup clone/old-image reopen/rollback.
Keep every prior image, named volume, original corpus and existing session.
Record inspected immutable image IDs, exact Git source, actual runtime linker and
SQLite version, package census, corresponding source, notices and checksums.

Scan the actual candidate archive offline with the same pinned Trivy/database
used for dev.7. Compare binary-package pairs, unique advisory IDs, severity,
available fixes, new/removed source packages and advisory applicability. Verify
final dpkg inventory against SPDX, including renamed/t64 packages and retained
notices, plus privacy/source-history checks and independent review.

Known hypotheses remain explicit: Bookworm Perl CVE-2026-13221 and zlib
CVE-2026-85091 have version-table/introduction conflicts; Trixie may still report
unfixed infocmp and privileged-tool flaws. Reconcile actual critical evidence or
retain an explicit production decision blocker. Do not claim legal clearance,
whole-program exploit proof, builder/host/model coverage or complete migration.
Do not switch again to an unrelated base merely to lower a count. Stop after this
one candidate result and its bounded remaining decision.
