# Packaged TEITOK reader milestone

Version 0.2.0-dev.4 extends the reviewed structural baseline c1c5ebd265fb6b2056c659b729bafb9157cb1b51. The immutable published preview and existing running sessions are unchanged.

## Usable behavior

Definitions offers an exact-revision preview and installation of the finite `teitok-workbench-reader/1` profile. Installation commits both `Resources/settings.xml` and `Annotations/review_def.xml` as one native revision, increments configuration version, invalidates prior approval and supports ordinary history/restore. The profile exposes original, corrected and optional normalized readings, inline relation fields and review span metadata in a separately installed TEITOK runtime. The synthetic structural generator includes these same byte-exact assets.

Only empty packaged settings and absent or already identical definition files qualify. Supplied custom settings, custom definitions, file/directory case aliases, unsupported annotation families, noncanonical or ambiguous sidecar paths and exhausted configuration versions block installation without staging. The fixed profile never interprets arbitrary executable configuration. Its literal schema keys remain literal even when a token has the same ID. Structural preview requires the exact paired profile and canonical `Annotations/review_{transcript basename}` paths with one owner; unknown packages remain preserved and outside the closed mutation grammar.

## Verification

- Formatting, Clippy with warnings denied and 124 native tests pass on Windows x86-64. Ten reader contracts cover exact installation/restore, approval invalidation, read-only preview, collisions/custom data, actor/stale/idempotency/hash bindings, standalone commit, three crash boundaries, literal keys, exported profile preservation and unsupported reader scope.
- TypeScript check and Vite build pass. Fourteen isolated Chrome/Playwright flows pass, including reader installation, reviewed R1 becoming unreviewed R2, supported split, complete export/reimport, and held success/error responses during document navigation.
- A fresh synthetic R3 export was mounted read-only in TEITOK pinned at `57d864b57fa3ed9f0a660a7781533ce7fa09ae2b`. Native Chrome displayed four expected token IDs and three independent Unicode readings; native span listing displayed the discontinuous annotation. The actual XML and stand-off downloads were byte equal. All 20 exported artifacts retained their hashes and downloaded XML reimported into a fresh native authority.
- That reopen used settings and an annotation definition already inside the export, with unchanged stock shared settings. Standard hosting adapters supplied a PHP entry point, shared-template asset locations and temporary caches; no supplemental project settings or definition were created. The temporary container/browser were removed afterwards, with zero browser errors or external request attempts.
- Independent review demonstrated fixes for case-collision overwrite, stale asynchronous Definitions navigation, undeclared families and overly permissive reader-path recognition. Concurrent SQLite barriers independently verified exact versus changed installation retries.

No TEITOK edits were saved during the reader check. This verifies the finite reader subset, not arbitrary schemas, CWB/CQP indices, native character-anchor semantics, or general parity. Compiler identities and existing lineage remain unchanged. Exact-commit Linux/ARM64 CI and physical Pi validation remain distinct gates.

## Continuing work

The next authoring milestone adds corpus/source navigation, useful search/status, clearer comparisons/review, recoverable in-tab drafts, keyboard access and typed view/schema boundaries. The container milestone adds pinned multi-stage builds, Compose workflows, non-root persistent storage, readiness, verified backup/restore, upgrade/rollback and architecture-specific CI. Publication remains a separate gate; neither milestone may include private corpora, credentials or model caches in public history or images.
