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

## Design references

Chuanqi Sun’s *Spaceship IDE* places the text between a small set of persistent
instruments. The Workbench adapts phrase locking to selecting evidence, the
wheel to moving through saved turns, and directional steering to choosing an
analytical question. The Codex window reference supplies the compact vertical
rail, grouped actions and clear active icon. [Spaceship IDE and author’s citation](https://github.com/chuanqisun/spaceship) · [Interactive simulator](https://chuanqisun.github.io/spaceship/)
