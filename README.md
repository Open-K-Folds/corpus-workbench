# Corpus workbench

Native Rust and TypeScript corpus authoring for the Open-K-Folds research-intelligence evidence domain. **0.1.0-preview.1 is an engineering preview.** Source development is now **0.2.0-dev.10**, including [annotation editing](docs/ANNOTATION-MILESTONE.md), the [reference inventory foundation](docs/REFERENCE-INVENTORY-MILESTONE.md), [bounded split/merge](docs/RETOKENIZATION-MILESTONE.md), a [packaged TEITOK reader](docs/TEITOK-READER-MILESTONE.md), the [detailed authoring experience](docs/AUTHORING-EXPERIENCE.md), a tested [local container workflow](docs/CONTAINERS.md), [dependency/upgrade qualification](docs/RELEASE-QUALIFICATION.md), [one qualified local Trixie runtime](docs/TRIXIE-RUNTIME-MILESTONE.md) and [reviewed TEITOK copy returns](docs/EDITED-PACKAGE-MILESTONE.md) and [bounded corpus concordance](docs/CORPUS-SEARCH-MILESTONE.md). The full approved migration is still in progress; the published preview stays immutable.

Import a complete TEITOK directory, listen to its media, correct tokens, maintain custom language values, create and edit discontinuous spans and relations, compare/undo/restore named revisions, review an exact revision, and export the complete package. SQLite transactions own revisions and review; immutable objects preserve source artifacts. Optional native Semantica generations are derived from approved exact snapshots and excluded from current queries after correction or review rejection.

## Try the synthetic workbench

Requirements: Rust 1.90.0 (Cargo/rustfmt/Clippy), Node 24.18.0 with npm, Python 3.10+, and a modern browser. Windows source builds need Visual Studio C++ build tools. Linux needs a C compiler. SQLite is bundled. No cloud account, paid service or model is required.

```sh
cargo build --locked
npm ci --prefix ui
npm run build --prefix ui
python scripts/prepare-synthetic.py --out .private/demo-package
```

On Linux/macOS, first restrict local storage, then import and serve:

```sh
mkdir -p .private .runtime
chmod 700 .private .runtime
./target/debug/corpus-workbench import --store .private/demo-authority --project synthetic --package .private/demo-package
./target/debug/corpus-workbench serve --store .private/demo-authority --project synthetic --ui ui/dist --port 18910
```

On Windows, `powershell -File scripts/start-workbench.ps1` protects `.private` and `.runtime` for the current owner and SYSTEM, imports the prepared synthetic package if the demo authority does not exist, and starts the built binary. It refuses to reuse an occupied port. Run from the checkout; this launcher is for the synthetic demo, with a separate authority from research data.

Open the generated local `.runtime/Open-Workbench.html` in your browser and click its link. The listener is **127.0.0.1 only**. That file and `.runtime/session-code` contain the temporary session capability; keep them private. A fresh server start changes the capability. CLI and API options are listed by `corpus-workbench help`. From a Mac, open an existing Windows preview through your authorized private remote desktop; see [private preview access](docs/PRIVATE-PREVIEW.md).

## Use an authorized project

Copy the **entire** TEITOK project (settings, XML, schemas, sidecars and referenced media), then import that copy into a new protected authority using `--package`, `--store` and `--project`. Never point tests or demo scripts at originals. Absolute/external media dependencies must be brought into the package; missing dependencies block approval/export. Original XML, unknown attributes/elements, whitespace, token IDs and stand-off files remain byte-preserved until a supported explicit edit changes its lexical range. Raw ASR remains distinct from human corrections and optional normalized forms. Chunk bounds do not become invented word timings.

`export --out NEW_DIRECTORY` refuses to overwrite an existing directory and adds revision metadata in a fresh `Workbench/exports/<UUID>/` namespace. No-op original package files remain byte-identical. ZIP downloads include the complete exported package. Reimport validates receipts, snapshots, definitions, history and derived objects. To bring supported token edits back from a separate TEITOK export copy, open **Return copy**, choose its complete folder, preview changes, resolve conflicts and save a named revision. The original importer remains strict. See the [reconciliation scope and evidence](docs/EDITED-PACKAGE-MILESTONE.md). Existing TEITOK remains a compatibility fallback; its runtime is separately installed and pinned, not bundled here.

## Check the implementation

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
npm run build --prefix ui
npm exec --prefix ui -- playwright install chromium
npm run test:e2e --prefix ui
python -m unittest discover -s tests -p 'test_cqp_literal_adapter.py' -v
npm audit --prefix ui --audit-level=low
```

The suite contains 175 Rust contract/recovery tests, 29 actual host browser flows and an additional container browser/persistence journey. Browser QA uses a fresh synthetic package and isolated browser on port 18912; it tests playback, Unicode correction, spans/relations, review, export, conflict, diff, undo/redo/restore and project/session boundaries. Set `WB_CHROME` to an installed browser executable if necessary. CI is configured for Windows x86-64, Linux x86-64 and Linux ARM64 plus browser/container QA; configuring it does not prove the new hosted checks ran. ARM64 CI is not Raspberry Pi validation. See [milestones](MILESTONES.md) and [release policy](docs/RELEASE-POLICY.md) for exact validation evidence and limits.

## Scope and data rights

Retokenization supports only the closed, proved text dialect documented above. Arbitrary token restructuring, deletion, automatic alignment, original TEITOK CWB/CQP index rebuilding and full query parity, multi-user roles, production deployment and model-based linguistic inference are deferred. Existing byte-offset CWB indexes can become stale after XML edits; do not use them without rebuilding through the retained tool adapter. Nested token structures are readable but not editable. Unknown layers are preserved, not claimed to be fully interpreted. Crash tests exercise abrupt process exit and transaction stages; they do not simulate physical power loss. Native Semantica is an optional locally supplied compiler boundary documented in [SEMANTIC-HANDOFF.md](docs/SEMANTIC-HANDOFF.md); the base workbench is standalone.

All public fixtures and public screenshots must be synthetic. Corpus rights and software licensing are separate; this license grants no rights to recordings, creator data or research transcripts. No actual corpus content, identifying pilot measurements, private compiler code or private history is published here.

GPL-3.0-or-later; see [LICENSE](LICENSE), [NOTICE](NOTICE), [dependency inventory](evidence/dependency-inventory.json) and [provenance](docs/PROVENANCE.md). TEITOK notices are retained. LaBB-CAT supplied capability inspiration without AGPL source reuse. This is a licensing inventory, not a claim of legal clearance.
