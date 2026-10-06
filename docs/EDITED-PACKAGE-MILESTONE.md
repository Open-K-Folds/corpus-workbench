# Edited-package authoring milestone — dev.9

A complete workbench export edited in a separate TEITOK copy can return through
**Return copy** as a reviewed proposal to the existing native revision authority.
This completes a bounded B16/B08/B21 slice of the approved migration plan.

- [x] Complete directory freezing and exact exported-baseline proof.
- [x] Three-way token-field preview and explicit saved/external conflict choices.
- [x] One atomic, named revision with existing diff, undo, review and retry behavior.
- [x] Exact returned XML and TEITOK daily backups retained as immutable lineage.
- [x] Browser directory upload and supported return/edit/export/reopen journey.
- [x] Independent falsifications and real TEITOK Save/reopen with synthetic evidence.
- [ ] Full CWB/CQP query parity, arbitrary-schema return adapters and production operations.

The ordinary importer remains strict. `return-stage --package DIRECTORY` freezes
an explicit local copy; `return-preview --request FILE` binds it to the project,
current revision and snapshot hash. The browser uploads declared safe files into
a session-owned quarantine, then freezes them through the same native adapter.
JSON control requests keep their existing 1 MiB limit. Binary file uploads allow
64 MiB per file and 256 MiB total, at most four unfinished sessions. Quarantine is
under private `.runtime/return-uploads`, outside authority objects; completed or
explicitly cancelled uploads are removed. Aborted-process quarantine and frozen
proposal stages remain private evidence; managed retention is a later operations
feature. Existing volumes and active sessions are preserved.

Supported deltas are the existing editable, unqualified leaf-token attributes:
`nform`, `wb_normalized`, `variety`, `annotation`, `review`, `note`, `lemma`, `pos`,
`msd`, `relation_target`, `relation_type`. Batches have at most 100 changed fields.
Each field is compared with the exported baseline and current saved revision.
Conflicts require an explicit choice. Normalization made against a different
chosen correction blocks; correction changes invalidate retained normalization
and character anchors. Absent and explicitly empty attributes remain distinct.

An ordered XML signature preserves original text, IDs, timing, namespaced
attributes, unknown elements, comments and processing instructions. XML
namespace/local-name collisions cannot invent editable deltas. XML declaration,
quote/entity spelling and attribute order may differ after TEITOK serialization.
Accepted changes patch the native original XML. Exact changed source XML and new
`backups/*.xml` files are retained in hash-named `Resources/reconciliation` JSON;
its entire source manifest and export receipt remain inspectable evidence.
Historical references stay historical in subsequent proved split/merge. Lineage
uses the established path-role classifier for complete export/reimport.

Every incoming artifact is accounted for. Missing originals, modified media/raw
ASR/settings, unknown additions, active structures, IDs or timing block. The new
export namespace must contain exactly declared, locally canonical history and
source objects. Returned approvals/generations are never adopted as current
approval. New revisions require fresh review; no word timings are inferred.
Existing CWB byte-offset indexes become stale after edits; compatibility export
remains blocked until an adapter rebuild.
Frozen source bytes and commit preview/choices are rechecked inside the existing
native command and atomic revision path. A stale head requires a fresh preview;
the browser keeps the proposal until explicit discard/reload.

Validation for the working implementation:

- `cargo fmt --all --check`; `cargo clippy --locked --all-targets -- -D warnings`.
- 155 locked native tests: 134 existing contracts plus 21 independent return
  contracts. Coverage includes full source preservation, hidden original-body
  mutations, qualified attributes, unsupported artifacts, explicit conflicts,
  normalized/Unicode character dependencies, stale proof and stage tampering,
  approval invalidation, strict receipt metadata, historical compiler currentness,
  namespace-safe status projection, prior-projection graph eligibility,
  payload-bound retries, abrupt process exit at all three
  commit boundaries, complete reimport and subsequent proved retokenization.
- TypeScript/Vite build and five new isolated Chrome journeys: a complete folder
  including audio over 1 MiB; conflict/commit/diff/undo/export/reopen; blocked
  media/body mutations without authority writes; concurrent-head rejection;
  upload limits/path/secret checks; delayed inspector response and draft guards.
- Independent TEITOK `57d864b57fa3ed9f0a660a7781533ce7fa09ae2b` native Save
  rewrote synthetic XML and created a daily backup. Return reconciliation retained
  both exact files, invalidated approval and patched only the correction in the
  native source. Its complete export reopened in native TEITOK with Unicode
  readings and span listing, byte-equal XML download, and fresh native reimport.
- Read-only verification confirms all 28 authorized original/protected-copy
  baseline hashes match. No real corpus/media enters public source or builds.

Hosted/container exact-source results are reported with their commit and run IDs
when available. The dev.8 source baseline `3be85c7` already passed native
amd64/ARM64 container contracts; its multi-architecture version manifests were
published at `sha256:b636f47d7ec273378e502e2e91ea7eb4a3cf1a72e7cfe19ffcd2791a0149ee95`.
The final anonymous inspection failed with HTTP 401; authenticated GHCR pulls
are an accepted deployment choice. No registry visibility or credential change
was made. Physical Pi/resource/power-loss qualification remains a deployment
step and does not block application development. No physical-device result is
claimed, and this milestone does not complete the full approved migration.

## Exact-source qualification record

Implementation `c6f3d9a6e863f5ffd96e5b885654024efebe38d2` is pushed on
`feature/edited-package-reconciliation` in [draft PR #1](https://github.com/Open-K-Folds/corpus-workbench/pull/1).
[Hosted contracts run 37315589536](https://github.com/Open-K-Folds/corpus-workbench/actions/runs/37315589536)
passes native 155 contracts/release builds on Windows, Linux amd64 and native
ARM64, the 23 browser journeys and locked dependency audits.
[Container run 37315589490](https://github.com/Open-K-Folds/corpus-workbench/actions/runs/37315589490)
passes exact-source build, actual runtime-loader contracts, browser and persistent
restart on native amd64 and ARM64 runners. This is architecture evidence, not
physical CM5 validation.

The local native-Linux-engine amd64 image
`corpus-workbench:0.2.0-dev.9-c6f3d9a-amd64` has inspected immutable image ID
`sha256:b6a12e291154534cc3207ea628c9d8bb51eb5218e9cde08f501e7fcc002e8e58`;
its actual-loader contract image is
`sha256:e07574d9414500ea544c036212c7b03792fa6ac893a6cb2de5cd6e6b3099cc27`.
Its application/label/build-record version is dev.9, source is c6f3d9a, and runtime
UID is 10001. The included Trixie package table is byte-equal to the immutable Git
blob (SHA256 `a4d5780b25933bb7b9b6facc790633bc71b579fb1c3cb53e41fe0cbe5730bf65`).
Windows checkout newline conversion is distinct from corpus byte preservation.
A subsequent packaging-only commit updates Dockerfile default version arguments
to dev.9; explicit-version qualified builds already used dev.9. No deployment or
new registry publication is implied.

An isolated, protected synthetic preview runs at `http://127.0.0.1:18938/`.
Its generated private launcher opens an authenticated session; session capability
values are not published. Headless Chrome verified a complete copied-folder
upload, ready preview, desktop 1440 and mobile 390 rendering, with no page errors
and no committed demo edit. Existing trial projects and research originals were
not used as mutation fixtures.

A separate fresh non-root local-container return used 9 files totaling 83,891,352
bytes, beyond its 64 MiB temporary filesystem. Complete-folder binary upload,
frozen preview, atomic commit, exact idempotent retry, unchanged media hash and
container restart persistence all passed with 1 GiB memory/2 CPU limits. Upload
quarantine used the persistent runtime volume. Only the test container was
stopped/removed; both fresh named volumes were retained. These are bounded
synthetic runtime results, not a CM5 resource benchmark.
