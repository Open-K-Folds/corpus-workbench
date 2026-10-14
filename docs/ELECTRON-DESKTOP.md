# Electron desktop migration

The Windows desktop preview adds native ownership of the existing Rust corpus
authority and TypeScript transcript editor. The migration starts from main
`a33f4d6` (PRs 1–11); the immutable published `v0.2.0-dev.11` preview is retained.
There is no new corpus schema, destructive conversion or parallel authoring store.

## Run and build

The local portable Windows package runs by opening `Open-K-Folds Workbench.exe`.
Keep the complete package folder together. No server, Python, Docker, Node or
Rust installation is required to run the package. This preview is unsigned.

For source development, install the existing Rust/MSVC and Node toolchains, then:

```powershell
npm ci
npm ci --prefix ui
npm run build:desktop
npm run desktop
npm run test:desktop
npm run package:windows
npm run test:electron
```

`WB_CARGO` can name a Cargo executable; `CARGO_TARGET_DIR` is respected. The build
creates a release sidecar, a compiled UI and a generated eight-second synthetic
practice recording. Packaging is local; it never uploads files or signs up for
a signing service. The output is under `release/desktop/`.

To build a separate review package while keeping a running preview intact, use:

```powershell
npm.cmd run package:windows -- --out release/desktop-review
```

The alternate output must stay beneath this checkout's `release/` folder.
Packaging rejects linked output directories and paths outside that folder before
replacing a build. Keep the running preview in `release/desktop/` and launch the
review build from `release/desktop-review/` with a separate QA profile.

## Desktop workflows

First launch offers **Import TEITOK package**, **Open existing workbench** and
**Try a synthetic corpus**. Import the complete package folder, including settings,
XML, sidecars and media. Import creates a fresh managed authority and preserves
the source folder. Open chooses an existing authority containing `ledger.sqlite`
and immutable objects; Rust discovers its project IDs read-only. Opening a
recent project uses an opaque registry ID; corpus documents remain in the sidebar.

Accepted corrections and property edits save named SQLite revisions immediately.
`Ctrl+S` accepts an eligible inline correction or submits the active properties
form. The standard native Edit menu supports copying and pasting. `Ctrl+F` opens
corpus search; `Ctrl+H` opens revision history. `Ctrl+Shift+I` toggles the inspector
and `Ctrl+Shift+A` cycles recording detail. `Ctrl+O` opens an authority;
`Ctrl+Shift+O` imports a package. Complete export (`Ctrl+Shift+S`) saves an exact
revision ZIP through the native Save dialog. The project menu also saves a
verified authority backup to a fresh destination.

Transcript tabs, faithful flowing/source-line readings and references, selection,
correction previews/history, custom audio/waveform, annotation and token safety,
revision-bound search, returned-copy reconciliation and exact review use the
existing domain implementation. **Return copy** chooses the complete exported
folder and retains its preview/conflict/commit sequence. Approved Semantica
contracts remain available from Review; the optional separately supplied compiler
and its CLI integration remain documented in [SEMANTIC-HANDOFF.md](SEMANTIC-HANDOFF.md).

## Processes and persistence

Electron main owns native dialogs, the recent-project registry and one Rust
sidecar. The sidecar binds only `127.0.0.1` on an assigned free port, flushes a
validated readiness handshake, and accepts a capability header supplied only by
main. Renderer requests use the fixed secure origin `workbench://app/` in a
persistent Chromium partition, so backend port changes do not strand local drafts.

```mermaid
flowchart LR
    UI[Sandboxed transcript editor] -->|Bounded API requests| MAIN[Electron main]
    UI -->|Validated desktop actions| PRE[Isolated preload]
    PRE --> MAIN
    MAIN -->|Private capability| RUST[Rust sidecar]
    MAIN -->|Native dialogs| FILE[Package import, export and backup]
    MAIN -->|Synchronized draft journal| PROFILE[Desktop profile]
    RUST --> AUTH[Existing SQLite and immutable objects]
```

The default Electron user-data folder contains `desktop-projects.json`, managed
`projects/`, the Chromium profile and `runtime/`. Selected existing authorities
stay in their original locations. SQLite WAL and immutable object storage remain
the sole corpus authority. Install/ASAR resources contain code and synthetic data;
backend, UI and demo resources are real files. The server never writes beneath
the installation folder. For isolated QA, use absolute `WB_DESKTOP_USER_DATA`,
`WB_DESKTOP_BACKEND` and optional `WB_DESKTOP_STORE`/`WB_DESKTOP_PROJECT` overrides.

Inline correction recovery retains its original authority lineage, actor, project,
revision, artifact and exact command ID. Recovery still requires an exact matching
basis; stale drafts are preserved for inspection and explicit discard. Imported
copies are distinct authorities. Existing browser-origin drafts stay in their old
browser profile; they are not silently adopted by Electron.

Electron additionally retains a private bounded `drafts/correction-journal.json`. Main validates
the journal, writes and synchronizes a fresh file, then atomically replaces the
previous journal. The renderer waits for acknowledgement under its existing browser
lock before sending an inline correction command. Relaunch hydrates from this file,
preserving divergent unflushed browser records rather than evicting them. The journal
must hydrate successfully before the desktop editor opens. If storage fails, recovery
offers an explicit retry and retains the canonical file. New desktop correction
commands also wait for a successful journal write before dispatch. The journal
retains the existing limits of 20 drafts, 64 KiB per record and 1 MiB total. This
protects abrupt-process recovery; it is not physical power-loss qualification.

Properties, annotations and structural forms are memory-only. Native close,
reload and project switch ask before discarding them. A pending save blocks leaving
until its original command is resolved. Backend interruption leaves the active
editor and pending commands in place; Reconnect restarts the same authority. Quit
sends a shutdown command and waits for the sidecar; parent-pipe EOF also stops it.
The sidecar removes its own temporary exports and partial return uploads.

Pane resizing stays in the renderer. Splitters measure the visible CSS size at
the start of each drag, use pointer capture, and restore the starting size if
capture is interrupted. The side handles sit outside scrolling pane content.
Window fitting preserves preferred widths for later expansion; dragging and
keyboard resizing keep the selected pane stable after release. Recording detail
and custom heights persist with the existing browser preferences, while the
expanded recording panel reserves space for the transcript. Resizing keeps the
same audio element and editor session alive.

Scrollbars retain native scrolling and keyboard behavior. Light and dark themes
use slim thumbs across panes, editors and dialogs; forced colors and increased
contrast restore native styling. These preferences do not change corpus data or
the native correction journal.

## Security boundary

The renderer has context isolation, Chromium sandboxing and no Node integration.
A frozen preload exposes specific desktop actions, never generic file access,
shell execution or arbitrary IPC. Main validates the sender's window, main frame,
origin and argument types. File paths come from native dialogs and stay in main.
The scheme proxy allowlists backend routes and methods, validates payload bounds,
and removes authentication headers and cookies from renderer responses. Corpus
configuration continues to supply data, never executable UI code.

The content security policy prohibits remote scripts, frames and object content.
Remote/file/network requests and webviews are blocked. External navigation is
limited to explicit HTTPS documentation hosts and uses the operating-system
browser. The existing browser cookie/CSRF contract is preserved separately.

The scheme/storage and isolation choices follow the official
[Electron protocol documentation](https://www.electronjs.org/docs/latest/api/protocol)
and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

## Qualification and limits

Actual Windows build, package, tests and screenshots are recorded in the local
delivery evidence. The focused desktop tests use fresh synthetic packages and
profiles. They do not open research data. No macOS or Linux desktop package has
been tested; optional compiler/CQP and production deployment qualification are
separate. The existing domain limitations, including bounded retokenization and
preserved unknown layers, remain in README and the milestone documents.

The native authority chooser currently lists up to 12 project IDs. Larger
authorities receive an explicit refusal and can still use the existing CLI.
Opening an authority requires the current schema 2; this preview does not
convert older authorities. Only inline correction proposals have automatic
draft recovery; the other forms use the departure prompts described above.
## B28 packaged Windows qualification - 14 October 2026

The per-term language increment is qualified in an actual unsigned Windows
x86-64 package with Electron 44.7.0, pinned Node 24.18.0 build tooling and the
release Rust 1.90.0 sidecar. The first package manifest identifies clean runtime
source `bcf4d96e1d28c59dc0222b0b78538693fd5d5c27`. The follow-up changes tests and
milestone evidence; the renderer, authority, dependencies and desktop bridge are
unchanged. Final clean-package runtime hashes are checked against the tested
package, so qualification does not substitute a development backend.

`node desktop/build.cjs` builds the release sidecar and TypeScript/Vite assets.
`node desktop/package.cjs --out release/desktop-b28-20261014` uses a fresh local
output. Existing pinned desktop dependencies and the Electron archive were
reused; its SHA-256 matched the installed pinned dependency checksum. Neither
lockfile nor release version changed. The cached archive's observed SHA-256 is
`eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c`.

Managed sandboxed-tool execution failed Electron's Windows sandbox-readable
installation ACL check. A byte-identical package was staged under a fresh
writable temporary directory and tested through native execution outside the
tool sandbox. No ACL, access setting, Electron sandbox, context-isolation or
web-security setting was changed. Sandboxed-tool access can trigger this check
even for a temporary copy; qualification applies to the tested native staging
location and execution route.

The packaged tests run with `WB_ELECTRON_EXECUTABLE` pointing at that package,
`WB_BINARY` at the same package's CLI backend, and `WB_DESKTOP_BACKEND` unset.
`WB_EVIDENCE_DIR` names a fresh synthetic evidence directory outside the source
checkout. The command is:

```powershell
node node_modules/@playwright/test/cli.js test --config desktop/playwright.config.mjs
```

All nine native Electron journeys pass in 67.1 seconds, with no skipped,
unexpected or flaky results. The seven earlier journeys cover import/open,
correction/review/export/reopen, process interruption and exact draft recovery,
audio, startup retry, native journal acknowledgement, pane fitting/persistence,
interrupted drags and native/nested scrolling. Two new B28 journeys add:

- Real default/Any/exact language-transition queries through `workbench://app/`,
  literal Unicode/spaces and term order, collapsed required-value validation and
  retained controls across inspector tabs.
- A completed Chromium Blob download with the complete exact JSON envelope,
  native complete ZIP export with unchanged XML/audio/opaque artifact hashes,
  observed audio and unchanged saved evidence.
- Eight long literal terms and forty real results at a 260-pixel inspector,
  the native 1000 x 700 minimum window at 125% zoom, independent nested textarea
  and inspector scrolling, reachable scrollbar edges, audio through side and
  recording-pane drags, and exact pagination.
- Persisted dark theme, preferred pane sizes and acknowledged native inline
  correction journal across normal shutdown/relaunch. Explicit recovery renews
  only the draft UUID/timestamp while preserving every bound content field.

Search queries are session-only: tokens, global filter and override rows reset on
restart. Query changes use the existing native unsaved-state departure prompt;
tests choose Leave explicitly. Inline correction drafts have durable recovery;
search fields do not gain a persistence promise. Original saved corpus evidence
is unchanged throughout the B28 journeys.

Native screenshots cover ordinary two-term synthetic isiXhosa/isiZulu queries in
light/dark appearance at 1440 x 1000, the eight-term minimum/zoom case and draft
relaunch. Page identity, meaningful content, overlay absence, relevant console
health, interaction and visual inspection pass. The Browser plugin was absent;
QA uses the existing Playwright 1.56.1 Electron route. `npm run test:desktop`
also passes all seventeen unit tests; syntax and whitespace checks pass. An
additional focused presentation run passes in 12.4 seconds after explicitly
scrolling to the selected synthetic greeting tokens for the ordinary screenshots;
it does not imply automatic transcript viewport retention when switching tabs.

The tested runtime hashes are:

| Artifact | SHA-256 |
| --- | --- |
| Windows executable | `b6761e0675053b65155a019c383ff9af4df6bb4dcf0e2158475c256d2daa95c1` |
| `resources/app.asar` | `49957e26ea5287b650ac3c20f74ff55e9019fd7fb60a4a0857c90e8a6d4508a4` |
| Packaged release backend | `f2e356e796fc4d4153f6b5ffb7f21a654faebf1453a1f8899046ef05261a33ac` |

This is synthetic local Windows qualification. macOS/Linux desktop packages,
private corpus accuracy, physical Pi/power-loss, original CWB interoperability,
signing and production operations remain separate gates. Hosted checks and draft
PR status are reported for the exact remote head in the scoped pull request.
No binary release, merge or deployment is performed, and the retained dev.8
release branch/worktrees/profiles remain intact.

Locally supplied original Omnilingual examples are separate from the public
practice package. Use a fresh complete-package copy with the full byte-preserved
ASR artifact under `Raw/`, verified in-package audio and explicit unreviewed
machine provenance. An existing TEITOK transcript is preferred; otherwise any
wrapper must be a separately identified, lossless full-text projection. Missing
timestamps, speaker labels, translations and accuracy measurements stay absent.
The existing importer preserves raw machine bytes and stores human corrections
in separate fields. Actual transcript/audio, private provenance and screenshots
are excluded from public commits, PR evidence and external design services.
