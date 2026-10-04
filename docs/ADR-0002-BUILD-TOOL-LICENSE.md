# ADR 0002: temporary exact Rollup pin with complete notices

Status: adopted for local release qualification, 2026-10-04.

The previously resolved Rollup 4.64.0 adds optional build-only
`@napi-rs/lzma-linux-x64-gnu@1.5.1`. Its official npm tarball declares MIT but
contains no license text. The exact upstream gitHead
`f164df92d83e095f195d628b1a68a141ae2eb638` has no license/copying/notice file
anywhere in its recursive tree. We cannot invent the missing copyright or grant.
The old dev.6 image retains that limitation and stays immutable.

Pin official native Rollup 4.62.2 through npm overrides. Vite 7.3.6 declares
`^4.43.0`, which includes this version. The exact registry integrity is locked;
upstream gitHead is `8faa18777374582bb813d54ce3623f4acf1f9e0b`. This version
avoids that optional tool and supplies the Rollup MIT license plus bundled
third-party notices. Inventory/packaging now handle npm's nested install paths,
use actual package names and reject missing or ambiguous parent notices. There
is no metadata-only license exception in new container builds.

Maintenance/reliability: retain the existing Vite/native Rollup ecosystem and
official platform packages; no bundler rewrite, patched third-party package or
custom downloader. The temporary pin postpones later tree-shaking, CRLF, import
attribute, CLI-log and watch-mode fixes. Revisit it when a later release has
complete license evidence. Fresh Windows output has the same JS/CSS hashes as
dev.6 and all eighteen actual browser flows pass before the SQLite update;
final exact-image checks are recorded separately.

Security/licensing: the exact new npm lock audit reports zero known advisories
on 2026-10-04. This is not proof of no vulnerabilities or legal clearance.
Application GPLv3+, TEITOK attribution and corpus rights remain unchanged.

Compatibility/cost: native packages exist for Linux ARM64 and Windows x86-64.
Windows and Linux amd64 are qualified locally; native ARM64/Pi remain gates.
This uses free official dependencies, introduces no runtime Node process and
does not change the native authority, data format, UI framework or export contract.
Switching to WASM or omitting every optional dependency was rejected here because
it adds binary-install/maintenance changes without a demonstrated user benefit.

Primary evidence: [Rollup 4.62.2 registry metadata](https://registry.npmjs.org/rollup/4.62.2),
[Rollup exact source](https://github.com/rollup/rollup/tree/8faa18777374582bb813d54ce3623f4acf1f9e0b),
[omitted tool metadata](https://registry.npmjs.org/@napi-rs/lzma-linux-x64-gnu/1.5.1),
[omitted tool exact tree](https://github.com/Brooooooklyn/lzma/tree/f164df92d83e095f195d628b1a68a141ae2eb638),
[4.63.3 fixes](https://github.com/rollup/rollup/releases/tag/v4.63.3),
[4.63.4 fixes](https://github.com/rollup/rollup/releases/tag/v4.63.4),
[4.63.5 fixes](https://github.com/rollup/rollup/releases/tag/v4.63.5),
[4.64.0 fixes](https://github.com/rollup/rollup/releases/tag/v4.64.0).
