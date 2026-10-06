# Workbench control polish

Focused UI feature stacked on draft recovery `296b462`, with the editor, search
and returned-copy features retained. This pass preserves the existing flat,
neutral workbench and native evidence authority.

## Controls and symbols

The two transcript layouts are native grouped radios (Tab, arrows and Space).
Interlinear and selection looping are native checkboxes with switch semantics.
Small corpus navigation choices expose pressed state and arrow/Home/End actions.
Reading layers, token filters, speed and evidence/revision/schema choice sets
retain selects. Labels, compact fields and actions have consistent sizing and
focus, disabled and invalid treatments. Buttons size to their content; bounded
authoring forms retain usable input widths.

Google Material Symbols Outlined supplement navigation and action text, with
independent accessible names on icon-only actions. The local 24-symbol WOFF2
subset uses optical size 20, weight 400, fill 0–1, and grade 0 in light / -25 in
dark appearance. No ligature text reaches accessible names or copied transcript
text. The complete Apache license, upstream response, retrieval instructions and
digest ship with built UI and preview packages. See
[retained provenance](../ui/public/third-party/material-symbols/README.md).

Pane scrollbars use stable gutters and subtle native thumbs. Fine-pointer idle
thumbs recede, then appear on hover, focus and scrolling. Touch/coarse-pointer
indicators stay visible. Forced colors and increased contrast restore system
scrollbars; reduced motion removes switch transitions. Native wheel, touch and
keyboard overflow remain available. No global content clipping was introduced.

## Recording

The HTML audio element remains the playback engine. Visible native media chrome
is replaced by compact workbench controls: play/pause/restart, native seek and
volume ranges, elapsed/duration, mute and supported speed choices. Playback only
starts after an existing explicit user action. Loading, buffering, media errors
and end state are named; unavailable controls disable. The waveform/timeline and
custom controls share one recording pane. Layout changes neither replace the
audio source nor reset the active playhead.

Selection listening still uses observed complete word intervals or the existing
whole-utterance fallback; no word timing is inferred. Search playback uses the
same control component and retains its exact historical/current basis. Changing
or rerunning a search clears the prior media source, range stop and displayed
basis, so empty/new results cannot replay the old hit through retained controls.

Actual remaining recording space is measured after wrapped controls/status and
pane resizing. Timeline lanes keep native nested scrolling in that space. Mobile
and transient states reserve enough room for their controls and explanations.

## Qualification

The implementation commit `1b7f929` passed the complete 75-scenario installed
Chrome/Playwright suite, with no failed, skipped or flaky results. Eight focused
contracts were added. A final timeline-space repair passed the ten relevant
control/resize/playhead contracts. TypeScript/Vite build and pinned Rust 1.90
formatting, Clippy with warnings denied, native tests and native build passed.
The service test verifies local WOFF2/text MIME types without relaxing API auth.

Browser QA inspected light/dark desktop 1440×1000, tablet widths and mobile
390×844 / 320×844. Recorded checks include actual playback/seek/rate/volume/end
events, native radio/switch keys, persistent reading preferences, unchanged
source/playhead under resizing, nested overflow, no-media/error/loading,
forced-colors/reduced-motion/increased-contrast behavior and cleared stale search
audio. Native selection, Unicode/IME, inline ghost/Undo/Accept, draft recovery,
history/review/references and lossless export/reimport remain covered by the full
regression suite. No runtime external request, framework overlay, page error,
console error/warning or horizontal overflow was observed in visual QA.

Independent read-only review found prior-search audio reuse, clipped collapsed
status and clipped expanded timelines under transient status. Each was repaired
and independently reproduced as passing at widths 320–1440. No outstanding
P1/P2 finding remained in that scope. See
[review record](../evidence/controls-review.json). Hosted results belong to the
exact PR head; terminal readback is retained with the local handoff rather than
claiming a prior head's CI success for a later commit.

Screenshots and local QA logs use fresh synthetic authorities and are kept
outside public source. Other browser engines, screen-reader applications and
physical touch hardware were not directly qualified. Existing corpus data,
preview authorities and the separate ASR/compiler projects were untouched.
