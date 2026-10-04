# ADR 0001: retain native core and use pinned Debian runtime containers

Status: adopted for the local container milestone. No language, canonical storage
or UI framework replacement is adopted. The current Rust/TypeScript/SQLite design
already passes revision, Unicode, unknown-byte and browser contracts; replacement
would require equivalent evidence before changing that authority.

The container packages the native core with a Bookworm glibc base matching the
pinned Rust builder and embeds only the compiled UI. This minimizes runtime
dependencies and avoids an additional Node server, dynamic plugin execution or
database service. Linux/ARM64 manifests exist for the pinned official bases;
Windows uses Docker Desktop's Linux engine while retaining native Windows checks.
Native ARM64 CI and real Pi hardware evidence remain explicitly separate.

Maintenance/reliability: three official version/digest-pinned images, locked
registries, signed date-pinned build packages, no extra orchestrator. Persistent
data stays in one native authority; schema transitions are transactional and
backup/clone restoration is verifiable. Updating a digest requires fresh tests
and an inventory refresh. Old image/data pairs stay available for rollback.

Security/operations: non-root UID, read-only root, dropped capabilities, bounded
resources, minimal health response and host-loopback publication. These reduce
exposure and are checked locally; they are not a comprehensive security claim.
Application session/CSRF checks remain intact. No Docker socket, host networking,
GPU dependency, daemon change, production deployment or paid hosting is required.

Licensing/ecosystem: official Debian/Rust/Node supply chains; application
GPL-3.0-or-later and pinned TEITOK attribution retained. No AGPL LaBB-CAT source is
copied. Corresponding application source, notices, dependency scopes and OS
inventory accompany the image. OS/license clearance and external vulnerability
scanner qualifications are separate release gates.

Cost/compatibility: local Docker plus ordinary native CI; no paid registry/build
service or model download. Containers preserve the same complete package, review,
export and artifact hashes; they do not reinterpret TEITOK or introduce D1. The
extra Linux userland/image space is accepted for compatibility and inspection.
Scratch/Alpine and a new frontend framework are deferred because their portability
or workflow benefit has not been demonstrated against this tested slice.
