# Transcript authoring milestone

Version: `0.2.0-dev.11`. Branch: `feature/transcript-editor`, based on `8066aa7`.
The approved migration remains in progress. Public fixtures use synthetic text
and generated tones; original research projects remain separate.

- [x] Read the full current approved plan and accepted correction/timeline design.
- [x] Read-only native lexical projection with exact revision/artifact binding.
- [x] Ten Rust projection tests: adjacency, separators/entities/CDATA, unknown
  wrappers, form/body distinction, nested content, real anchors, duplicate IDs,
  headers, Unicode, multiple bodies and actual section metadata.
- [x] Native text selection, correction drafts, Undo/Accept and recorded edit history.
- [x] Resizable/collapsible side and recording panes, actual document tabs,
  source-line/flowing layouts, optional interlinear display, themes and mobile focus.
- [x] Exact-command recovery, stale comparison/reapply and late-response guards.
- [x] Existing native annotation, language, review and complete export flows retained.
- [x] Local native/browser verification and independent defect review/repair.
- [x] Rendered desktop/mobile, light/dark screenshot QA and direct launcher checks.
- [ ] Exact final local commit review binding.
- [ ] Publish authorized branch/draft PR and verify exact-head hosted CI.
- [ ] Physical Pi, production and remaining full migration gates.

## Data and revision contracts

`GET /api/reading` derives lexical runs from immutable XML at an explicit revision.
It binds project, revision, snapshot, document and artifact hashes, retaining
decoded separators/punctuation, actual source IDs, fallback token anchors and
actual stable section metadata. It does not reserialize XML, invent canonical
IDs, duplicate the revision ledger or change the frozen Semantica/export DTO.
Settings, schemas, sidecars, media and unknown content remain package-owned.

Selections use Unicode code-point coordinates and refuse split grapheme/surrogate
boundaries. Backward ranges remain backward. Native input drafts and muted old
text ghosts stay noncanonical until explicit Accept succeeds. IME candidate Enter
does not commit. Raw source, corrected and optional normalized forms stay distinct.
Character annotations use the native anchor operation; a correction can mark an
old anchor unresolved, surfaced by native validation for explicit repair.

Accept binds one complete command and ID to the selected exact revision. An
uncertain response retains it and disables dependent authoring/review until the
same command is reconciled. Stale reapply requires comparison; proposal editing
invalidates that comparison. The same recovery covers properties and restore.
Late projection, history or navigation cannot replace drafts or create controls
during a pending save. Ctrl/Command deselection derives correction coordinates
from the remaining token. Saved markers use actual revision changes through
unrelated edits and reload; decoration scans 64 revisions, with complete History
still available. Imported correction fields do not create invented edit markers.

## Workspace and recording

The shell exposes one actual project's navigation, real open-document tabs,
dominant transcript, contextual properties and bottom recording. Separators
support pointer/touch drag and keyboard arrows/Home/End. Mobile uses one focused
pane with correct first-tap and accessible expanded state. No collaboration or
project-creation control is implied.

Tabs preserve in-memory selection, scroll and playback position; switching
documents explicitly pauses playback. An unfinished inline draft blocks switching.
Properties retain the existing guarded draft panels. Text-only commits keep the
unchanged recording's hash-bound source, playhead and speed. Resize keeps the same
audio element. The waveform uses real decoded samples with a 32 MiB visualization
cap; larger files remain playable. Lanes show supplied complete intervals only,
stacking overlap. Hollow correction spans mean utterance association, never exact
word timing. Unresolved anchors occupy a text-only tray. Ambiguous media or
`xml:base` disables automatic resolution conservatively.

Layout changes remain presentation-only. Go-to uses actual source/section/token
IDs. Copy link binds project/revision/document/anchor without a capability; old
revision links ask for explicit historical inspection. A range citation currently
focuses its first anchor. Interlinear metadata, controls and the old-text ghost
are excluded from logical transcript copying. The Windows helper checks the
protected launcher's loopback readiness and opens the authenticated editor
directly; Mac users use their existing authorized Windows remote desktop.

## Local verification

Windows x86-64, Rust 1.90.0, Node 24.18.0, isolated installed Chrome:

```powershell
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
cargo build --locked --release
npm run build --prefix ui
cd ui
npx playwright test
cd ..
python -m unittest discover -s tests -p 'test_cqp_literal_adapter.py' -v
```

Native verification passed 185 tests. The full browser suite has 48 scenarios,
including final selection/pending-save and actual theme/viewport checks; exact
results are bound to the implementation commit in the handoff. The derived CQP boundary passed
14 Python tests. No dependency was added; locked versions/license inventory remain.
These results do not establish new hosted CI, container qualification or Pi support.

The private synthetic preview journey imported R1, corrected R2, repaired its
character anchor at R3, defined a custom language at R4, assigned it at R5,
reviewed R5 and downloaded/reopened its complete export. All five canonical
artifact hashes, source token IDs, readings, spans and definitions matched the
reimport. Project-qualified internal identities correctly differ in a new
project. Original recording bytes remained unchanged. The final eight screenshots
retain approved R5 after an additional draft was explicitly undone; desktop
1440x1000/mobile 390x844, zero page/console errors and fully visible collapsed
playback controls. Launcher QA mocked exactly one direct URL launch without
opening the user's browser. Windows PowerShell 7 (`pwsh`) ran these helper checks.

Browser checks exercise actual playback, correction, spans/relations, language,
review, history/undo/restore and complete export/reimport. New falsifiers cover
Unicode/native range and IME events, missing times, source identity, stale drafts,
exact-command response loss, failed refresh, late optional history, pending restore,
copying, media/projection isolation, playback continuity, mobile and deselection.

## Remaining gates

Arbitrary multi-token replacement/deletion stays disabled until explicit mapping
and reference repair are proven. Existing finite split/merge proofs remain in
Tokenize. Discontinuous selections support annotation/structural tools; correction
preview needs a native range or one complete token. Nested tokens stay read-only.

Unsaved drafts are in memory with a before-unload guard; refresh/crash draft
persistence is not implemented. OS-level IME, assistive technology, large
recording/corpus performance, arbitrary XML/media dialects, physical Pi and
physical power loss remain unverified. Configured Windows/Linux x86-64/Linux
ARM64 CI must run against the published commit before hosted validation claims.

GPL-3.0-or-later notices and source accounting remain intact. LaBB-CAT informed
capabilities; no AGPL source was copied. Corpus rights are separate.
