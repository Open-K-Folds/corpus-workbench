# Version and preview release policy

Versions use SemVer. While versions are below 1.0, schema/API compatibility may change only with documented migration or explicit rejection, never silent evidence reinterpretation. The first candidate is `0.1.0-preview.1`; tags are `v<VERSION>`. Engineering previews are marked GitHub prerelease and do not claim production readiness.

A preview requires an independently reviewed exact commit, locked Rust and TypeScript builds, format/strict Clippy/contract tests, actual browser acceptance, dependency audit and an audited package. CI verifies Windows x86-64, Ubuntu x86-64 and Ubuntu ARM64. Native Raspberry Pi validation remains separate. A package is published only for a target actually built and tested; passing cross-platform contracts does not imply binaries exist for every target.

Packages contain the native executable, compiled UI, synthetic fixture generator/fixtures, launch instructions, full GPL notices and retained third-party license files. Corresponding source is the exact public source tag and a source archive. No session codes, authorities, real corpus fixtures, developer paths, credentials, private compiler source or private screenshots are allowed. A package smoke must create a new synthetic authority, start on loopback, play audio, edit/review/export and verify reopen.

The Windows preview package helper requires Python 3.11+ (`tomllib`). It copies documentation/fixtures from Git-tracked paths only and accepts exactly the generated HTML, JavaScript and CSS UI outputs. Build the binary with stripped symbols and remapped developer paths; audit the final archive independently, including retained dependency notices.

Release assets include `release-manifest.json` and `SHA256SUMS`. The manifest identifies the exact source commit/tag, package SHA-256, compiler/linker/Node/npm/Python versions, actual target platform, lockfile hashes, validation commands and counts, advisory audit result, CI run URLs, license material and remaining gates. Generated artifacts are excluded from Git to avoid circular source-commit claims.

Releases do not deploy a service, change network policy, create credentials or upload corpus data. Source-only publication is valid when packaging or exact-commit checks are incomplete; the missing gate must be stated explicitly.
