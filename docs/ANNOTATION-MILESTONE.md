# Existing annotation editing milestone

Source version: **0.2.0-dev.1**, unreleased. This extends the approved plan's B13/B15/B16 authoring and reference-preservation foundations. It does not complete B19 conversion or B20 retokenization. The published 0.1.0-preview.1 tag, assets and active sessions remain unchanged.

## Authoring behavior

Saved spans can change label, language/variety and note, keep their existing anchors, explicitly replace ordered/discontinuous token anchors, or repair a Unicode subtoken judgment. Commands identify a span by document, sidecar and stable ID. Reanchoring preserves its authored mixed XML content; it never guesses whether that content is a label or excerpt. Whole-token conversion explicitly removes the six supported character-coordinate/status attributes. Field-only edits retain unresolved coordinates and cannot unlock approval.

Saved inline relations can change target, type and an explicitly supplied note. Clearing removes only relation target/type, retaining token identity, original text, unknown attributes and notes. Missing, dangling, empty or self-referential edits fail without changing the revision authority. Unsupported/nested XML structures and namespace collisions remain read-only.

The UI exposes sidecar scope, unsaved annotation state and explicit discard. Open editors retain drafts across tab, selection and document navigation. Other commits wait until competing annotation drafts are saved or discarded. Drafts are in memory; reload/close warns before discarding them. No additional canonical ledger or browser persistence is introduced.

## Review findings and repairs

Independent review reproduced shared sidecar aliasing between equally named transcripts, collapsed compiler span identities across separate sidecars, hidden scope in UI/diffs, false saved state and several draft-loss paths. The repaired contracts reject ambiguous edits and compiler handoffs, qualify diffs/listings, retain already-open editors, track individual dirty forms and block competing commits. A genuine mapping-v1 collapsed graph fixture proves that an existing head/approved generation becomes historical-only while its contract, graph and receipt remain unchanged.

Mapping `corpus-evidence/1` stays compatible. Packages with equal span IDs across sidecars remain lossless for authoring/export, but compiler handoff requires a future qualified mapping. Sidecars that match multiple transcript filenames require an explicit association before editing or compiler use. Historical graph access stays explicit. This is currentness enforcement, not permanent rights withdrawal or erasure.

## Validation evidence

All mutations use synthetic fixtures in isolated stores. No pilot transcript, real recording, original trial project or active-session authority participates.

| Check | Local result |
|---|---|
| Rust contracts/recovery | 74 passed: 36 core, 19 annotation, 6 export, 7 generation, 3 abrupt-process, 3 review |
| Formatting / strict Clippy | Passed with Rust 1.90.0 and locked dependencies |
| TypeScript / Vite | Passed with Node 24.18.0; isolated `dist-next` |
| Actual Playwright flows | 5 passed, Chrome, desktop 1440×1000 and mobile 390×844 |
| UI identity/render/overlay/console | Correct title and rendered native evidence; no framework overlay or page errors |
| Annotation interaction | R10→R21: edit/reload/diff/undo/restore, explicit coordinate repair, blocked unresolved review, relation edit/clear/undo/redo, exact review/export/reimport |
| Competing drafts | Repeated Edit retains input; tab navigation retains it; competing form commit blocked; explicit discard leaves native head unchanged; a stale annotation draft compares/reapplies R21→R23 |
| Optional native Semantica 0.6.8 | Five exact generations: eight nodes, 13/13/13/13/12 edges; span repair and relation changes stale prior current results; clearing removes authored edge |

Key commands from the isolated milestone workspace:

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets --target-dir target/annotation-editing -- -D warnings
cargo test --locked --target-dir target/annotation-editing
tsc --noEmit
vite build --outDir dist-next
# WB_BINARY and WB_UI select that isolated native target and UI build.
npm run test:e2e --prefix ui
npm audit --prefix ui --audit-level=low
cargo audit --db .runtime/rustsec-db --no-fetch --deny warnings
python scripts/verify-semantic-handoff.py --binary ISOLATED_BINARY --compiler-root SUPPLIED_COMPILER --evidence PRIVATE_REPORT
```

The Browser plugin was unavailable; QA used the repository's Playwright setup and a separate browser session on loopback port 18912. Synthetic screenshots show the desktop sidecar identity/editor and mobile layout without horizontal overflow. Browser reports, screenshots, local compiler identity and private paths stay outside tracked source. Public CI runs the native suite on Windows x86-64, Linux x86-64 and Linux ARM64 and the browser suite on Linux. The optional local compiler runtime is not installed or claimed verified by CI.

## Remaining gates

Arbitrary TEITOK schema and external export reconciliation, explicit sidecar association and qualified compiler identity, complete reference inventory/converters, safe token split/merge and CWB adapter rebuild remain dependencies for retokenization. Span/body deletion and generic relation schemas are deferred. Currentness filtering preserves historical evidence; permanent rights withdrawal needs an approved retention/tombstone/backup policy. Durable workers, shared assertions, optional alignment resources, human linguistic review, Pi hardware and production operations remain later milestones.

No new binary release accompanies this source milestone. GPL notices, dependency pins and separate corpus rights remain in force.
