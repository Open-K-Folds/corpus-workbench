# Transcript editor milestone

Implementation branch: `feature/transcript-editor`, based on `8066aa7`.
All browser fixtures, recording waveforms and screenshots for this milestone are synthetic.
The approved migration remains in progress.

- [x] Independent contract review before implementation.
- [x] Read-only native lexical reading projection, exact revision/artifact binding.
- [x] Eight Rust projection tests covering adjacency, separators/entities/CDATA, unknown wrappers,
  source form versus body, nested content, explicit anchors, duplicate IDs, headers and Unicode.
- [x] Direct Windows launcher through the existing loopback session fragment.
- [ ] Integrated selection/draft/layout/location/document-tab UI.
- [ ] Resizable recording and side panes, light/dark and interlinear display.
- [ ] Focused browser falsifiers, existing regression flows, independent concrete review.
- [ ] Exact-head CI, screenshots, usable private preview and publication evidence.

The new `/api/reading` projection is derived from immutable XML at an explicit revision.
It retains decoded lexical separators, punctuation and literal mixed content and exposes
actual source IDs separately from fallback token anchors. It adds no canonical ledger,
does not reserialize XML and does not change the frozen Semantica/export document DTO.
Visual paragraph wrapping and display ordinals do not create corpus structure or IDs.

Current foundation evidence: `cargo test --locked reading::tests --lib` — 8 passed;
`cargo build --locked` — passed on Windows x86-64. Browser and launcher interaction
verification are pending; source implementation alone does not establish those claims.
