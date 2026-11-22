# Workbench redesign goals

Use these goals in a Codex session working on the transcript workspace. Start
from the normal desktop launch with a fresh synthetic practice copy. Keep each
goal in a reviewable commit. Run independent pieces in separate worktrees and
integrate them on main. Record the build and observations used to close a goal.

| Goal | What to implement | Acceptance exercise |
| --- | --- | --- |
| G1 · Window and navigation | Give the desktop one continuous window frame, native window controls, and a narrow activity rail using locally bundled Material Symbols. Provide accessible names and active states. | Maximize and restore the Windows app. Move between library, transcript, search, analysis, history and review using the rail and keyboard. Reopen a project from the library. |
| G2 · Reading and steering | Make ordinary reading the center of the app. Put source turns in a navigable text field, with a persistent steering control for position and scale. Keep source selection, correction and recording attached. | From a fresh workspace, move one turn, scrub to the end, scale the text, select words with the pointer, replay a timed passage and reopen a saved correction. Verify a text-only document as well. |
| G3 · Human and model readings | Keep the selected evidence visible while choosing a lens, entering an independent first reading, inspecting the prompt and assessing the reply. Give review, recording, welcome and other tool surfaces the same visual language. | Run the noticeboard exercise. Verify the independent reading stays outside the prompt, check an exact quotation and reopen a reviewed annotation. Switch to another tool and back with a draft intact. |
| G4 · Whole-app qualification | Integrate the window, rail, stage, steering controls and panels. Retain a useful light appearance alongside the dark studio. | At desktop and narrow widths, check keyboard focus, panel toggles, text selection, native window buttons and horizontal overflow. Run the relevant native, renderer and packaged desktop tests. Open the exact build and capture its normal first screen. |
| G5 · Collect training examples | Label one saved passage or compare two passages in a named collection. Offer discovery by meaning, wording and potential contrasts, with a text search and researcher judgment. | From the transcript, use the steering gesture and keyboard controls. Collect a passage classification, a paraphrase and a difficult negative. Inspect source context, reload the collection and verify its JSONL against the reviewed words and source anchors. |
| G6 · Word-to-word passage handling | Match Spaceship’s compact text measure and word focus while preserving source identity and character-level editing. | Drag forward, backward and across a wrapped line on a long unsegmented transcript. Move a pinned passage with a mouse and the arrow keys. Open it in an analysis tool and verify the newly targeted source IDs. |
| G7 · Listen along | Follow the recording on the transcript at the precision of its supplied timing. Preserve an independent reading position while browsing or selecting text. | Play a voiced passage with word times, seek into a turn with only chunk times, pause in a gap, then scroll away and rejoin playback. Check a real recording against its verified source boundaries. |

## Design references

Chuanqi Sun’s *Spaceship IDE* places the text between a small set of persistent
instruments. The Workbench adapts phrase locking to selecting evidence, the
wheel to moving through saved turns, and directional steering to choosing an
analytical question. The Codex window reference supplies the compact vertical
rail, grouped actions and clear active icon. [Spaceship IDE and author’s citation](https://github.com/chuanqisun/spaceship) · [Interactive simulator](https://chuanqisun.github.io/spaceship/)

## Acceptance record · 22 November 2026

| Goal | Exercise and observation |
| --- | --- |
| G1 | On Windows, the welcome screen and open editor both expose a native drag region. The project name opens the library. UI Automation invoked the native minimize, maximize, restore and close controls. F10 and the File, Edit, View and Help shortcuts opened their Windows menus. |
| G2 | In the ordinary workspace and focus mode, a pointer drag moved the numbered handle between source turns. Home, End and the arrow keys moved the same reading position. Dragging across words preserved native selection. Browser checks covered 320 and 390 CSS pixels. At 1000 × 700 and 125% desktop zoom, expanding the recording left 240 CSS pixels of readable transcript height. |
| G3 | In packaged builds `5a4c774` and `73857ee`, the local Qwen2.5-0.5B-Instruct model received the previewed question and 12 tokens from the second and third noticeboard turns. The private first reading was absent from both outgoing requests. Qwen misread “only” as a count of listeners. In the practice researcher role, Codex recorded **Partly supported** and cited the relevant words. The resulting R2 annotations reopened after package export and reimport. The source XML remained byte-identical. |
| G4 | The clean Windows build from `73857ee` opened the synthetic noticeboard transcript. All 142 browser journeys passed against its packaged UI and Rust binary, including the HTML-in-canvas and ordinary HTML recording-label paths. All 13 applicable packaged Electron journeys passed. Two additional journeys require a separately installed Semantica runtime and compatible compiler and were skipped. The Rust suite passed 216 tests, the desktop unit suite passed 68, and the audio-analysis suite passed nine. |
| G5 | On Windows, the double-press-and-drag fan retained the six selected noticeboard tokens. The browser exercises saved a reviewed paraphrase, a difficult negative, an uncertain relationship and a single-passage label. A source-linked recording reopened at its original revision and stopped at the supplied word boundary. The packaged live-Qwen exercise saved **Different** and **Reported experience**, restarted the app, and exported both records with their original and corrected token readings. The full integration run passed 150 browser and 14 applicable desktop journeys; two optional Semantica journeys skipped. The final package from `8cd8010` passed all nine training browser journeys and the live-model desktop relaunch/export exercise. |
| G6 | The Windows package from `72b3c1b` passed the mouse and keyboard passage exercise. Dragging inside a prior selection now starts a fresh range, including across wrapped lines in a 1,400-word synthetic transcript. Moving a pin, cancelling a move, and opening its tools preserved the intended source IDs. A separate local check on a 384-token transcript moved a four-word pin and verified all four IDs in co-analysis at the same saved revision. Thirty-six browser exercises covered selection, Unicode correction, the reading canvas, training and co-analysis. |

To repeat the browser exercises, build the UI and Rust binary, then run
`npm run test:e2e --prefix ui`. The fresh-stage cases create a separate local
authority per exercise. To repeat the Windows exercises, build and package the
desktop app, set `WB_ELECTRON_EXECUTABLE` to its full path, and run
`npm run test:electron`. Follow the [noticeboard walkthrough](CO-ANALYSIS.md)
for the real model exercise.
