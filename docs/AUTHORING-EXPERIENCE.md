# Authoring experience milestone

Version 0.2.0-dev.5 continues the approved GitHub/GitLab level authoring direction from reader checkpoint `5e8bcdaffc5124c742f00913ea9117f63067d670`. This is a usable authoring increment, not feature parity with a repository hosting platform or completion of the migration plan.

## Workflow and design target

The current protected project remains the navigation boundary. A corpus rail switches between searchable documents and preserved source artifacts, with document paths, token/span counts and source roles. The central transcript supports search across actual readings/IDs/varieties, original/corrected/normalized-fallback views, complete-word-timing and correction/attention filters, next-match selection and keyboard focus. The inspector keeps lexical corrections, annotations, structural proof, schema definitions, history, review and raw evidence in one coherent workspace.

History provides searchable named revisions and an exact comparison with filterable evidence/field rows, distinct before/after values and changed package files. Review names the exact revision/hash, package scope and native validation counts. Technical provenance is progressively disclosed where it affects inspection or approval; no fake collaboration, remote jobs or inferred alignments are presented.

The visual target extends the existing teal/slate identity with a compact project header, flat corpus rail, readable transcript and white inspector. Code-native controls and typography use one local design system; no remote fonts, imagery or third-party runtime UI dependency are needed. Desktop target is 1440×1000, mobile 390×844. Functional density, stable selection and clear state take priority over decorative cards.

## Drafts and exact source reads

Token drafts now remain in memory across tokens, documents and inspector tabs, alongside existing annotation/structural drafts. Unsaved state survives navigation; another dirty form blocks a competing commit, review or reload. Reset explicitly removes the intended lexical delta. Beforeunload warns about dirty forms. Successful saves still create native revisions; the browser does not become a second evidence ledger.

Conflict reapply binds the captured form values before controls are disabled. Editing or resetting that form invalidates the action; the current draft remains intact and requires fresh submission. Reapply can then use a freshly fetched native head while preserving a competing writer's unrelated edits. Unsaved browser memory is not durable crash storage and is never persisted as transcript text in localStorage.

Source/XML reads support an explicit project-scoped revision. Responses include the artifact hash and revision, and the source inspector verifies both against its captured snapshot. Late source/history/reader responses cannot replace a newer document inspector; current errors remain visible and stale errors are discarded.

## Extensibility boundary

`workspace.ts` exposes typed reading preferences and a compiled inspector-view registry. Feature modules own source inspection, history, annotations, structural proof and the fixed TEITOK profile; the shell coordinates native revisions and drafts. Corpus values and schemas remain typed data. Imported XML/scripts, labels and source paths are escaped or rendered with textContent. No arbitrary plugin JavaScript, package-supplied renderer, remote code or replacement canonical database is executed.

Broader configurable schema editing, shared roles, workspace-wide multi-project search, durable jobs and remote integrations remain native-contract work. A new UI field or view does not authorize a new mutation decoder.

## Acceptance

Native formatting, Clippy and the 124 preservation/revision/recovery tests pass. TypeScript and Vite checks pass. Browser acceptance covers the prior playback/edit/annotation/proof/review/export workflows plus navigation/layers/keyboard, partial timing, token draft retention/reset/conflicts, exact historical source bytes, late source/history success/error and obsolete conflict actions. Actual desktop/mobile screenshots are synthetic and local; no private corpus image is published.

Independent review falsified and prompted fixes for obsolete conflict payloads after edit/reset, incomplete timing filters and unhandled late history errors. Visual QA corrected the sticky media offset that covered transcript filter labels. Exact test totals and commit-specific evidence are recorded in MILESTONES.md and ignored local acceptance artifacts; hosted CI and Pi measurements remain separate.
