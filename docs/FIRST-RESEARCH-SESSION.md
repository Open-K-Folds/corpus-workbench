# First research session

This walkthrough takes an existing recording and supplied transcript through a
saved correction, exact-revision review and optional local Semantica export.
Start with synthetic material to learn the controls. Actual language judgments,
listening quality and research acceptance require a person.

## Open the installed workbench

Open the supplied Windows handoff launcher, `Start-Corpus-Research-Handoff.cmd`,
keeping its `.ps1` and pinned `.zip` alongside it. This separately supplied local
delivery verifies its archive and product files before opening the application;
it is not an installer in this repository. `-VerifyOnly` checks those files
without opening a research project. A missing program cache can be extracted
again from the archive; keep research authorities and profiles intact.

Alternatively, open `Open-K-Folds Workbench.exe` in an existing complete desktop
package. Base authoring needs no build or Docker. The optional Semantica runtime
is separate. Source-build instructions remain in
[ELECTRON-DESKTOP.md](ELECTRON-DESKTOP.md).

## Import an unreviewed copy

1. Choose **Recording + transcript**. Explicitly select **Plain text - UTF-8**
   or **Omnilingual JSON**, then **Choose recording and transcript**. Select a
   copy of the recording and its existing transcript, keeping originals safe.
2. Inspect the literal preview, file hashes, token count and timing warnings.
   **Cancel** leaves sources unchanged. **Import for review** creates a separate
   working copy; it does not approve the supplied transcript or run ASR.
3. If identical inputs offer **Open existing copy**, use it to resume the saved
   authority. Corrections and review history remain attached to that copy.

The recording limit is 64 MiB; the transcript limit is 2 MiB. The supported JSON
shapes and further limits are in [LOCAL-TRANSCRIPT-IMPORT.md](LOCAL-TRANSCRIPT-IMPORT.md).
Unknown model identity, language, speaker, confidence and word times stay unknown.
Supplied chunk bounds describe recording chunks, not observed word alignment.

## Save a correction and inspect its history

Play the recording. Select a token, enter **Human-corrected reading** and an
optional **Reviewer note**, name the revision with **Revision name**, then choose
**Save token**. Wait for **Saved R…** before reviewing. For practice, any clearly
labelled synthetic correction is sufficient; it is not a listening assessment.

The corrected reading is separate from the original reading and raw transcript.
Use **History** to inspect saved revisions. **Research overview** offers a
read-only view of saved evidence and playback; it does not accept unsaved edits
or grant review. Return to the transcript to apply changes explicitly.

## Explicitly review the saved revision

Open **Review** and check its exact revision number, snapshot and validation
issues. Select a **Decision**, write a **Review rationale**, then choose
**Record review**. Approval applies to that saved full-package snapshot. Use
**Needs adjudication** or **Reject** when the material is not ready.

**Decision history** records the rationale and decision for each revision. Its
revision selector is read-only history; viewing an earlier decision does not
change the current review target. A later correction requires a new review.
Automated synthetic qualification exercises this explicit action with a
synthetic rationale; it does not constitute human-language approval.

## Run the optional local Semantica handoff

Open **Research handoff**. If needed, choose **Configure local runtime** and
select the already installed Python executable and compatible clean compiler
checkout. The supported runtime is Semantica 0.6.8; configuration checks the
actual compiler entrypoint. The workbench does not install it.

After approving the exact saved revision, choose **Run local Semantica**. Wait
for **Validated graph for R…** and the reopened graph result. A successful child
process or an accepted receipt alone is insufficient. Then choose **Export
validated graph**, select a destination parent folder and wait for **Exported
and reopened successfully**. Each export creates a fresh child folder.

This maps authored evidence; it does not infer linguistic accuracy. A later edit
or review rejection makes the old generation ineligible for current use.
Review and run the new saved revision when appropriate.

## Keep both kinds of export and reopen them

| Export | What it preserves | How to reopen |
| --- | --- | --- |
| **Export complete package** | Authoring package, original media/raw transcript, saved revision metadata | Extract the complete ZIP into a fresh folder and use **Import TEITOK package** to create a separate authority |
| **Export validated graph** | Approved snapshot's graph, contract, receipt, instructions and manifest; no original recording/raw transcript files | Copy the complete five-file folder, then use the consumer check below with the separately installed runtime |

For ordinary continuation, close the app normally and reopen the same authority
through Recent projects or **Open existing workbench**. This resumes its saved
corrections and exact review history; it is different from importing an export
into another authority.

Check a copied graph folder from a fresh process:

```powershell
& $Python -B scripts/semantica-handoff.py --verify-package $CopiedGraphFolder --compiler-root $CompilerRoot
```

Set those variables to the installed runtime and copied export paths. Successful
JSON reports `verified: true`, `native_reopen: true` and `files_verified: 4`
(the four payloads declared by the manifest). A detached export verifies its
exported snapshot; it cannot observe later edits or approval withdrawal in the
original authority. See [SEMANTIC-HANDOFF.md](SEMANTIC-HANDOFF.md).

## Reproduce the synthetic qualification

Use the existing pinned test dependencies and an already built, verified desktop
package. All test inputs, authorities and profiles are generated separately.
No new build or original corpus is required. In PowerShell from this checkout:

```powershell
$env:WB_ELECTRON_EXECUTABLE = 'C:\path\to\verified-package\Open-K-Folds Workbench.exe'
$env:WB_SEMANTICA_PYTHON = 'C:\path\to\runtime\python.exe'
$env:WB_SEMANTICA_COMPILER_ROOT = 'C:\path\to\clean-compatible-compiler'
$env:WB_EVIDENCE_DIR = 'C:\path\to\fresh-synthetic-evidence'
Remove-Item Env:WB_DESKTOP_BACKEND, Env:WB_DESKTOP_STORE, Env:WB_DESKTOP_PROJECT, Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node node_modules/@playwright/test/cli.js test --config desktop/playwright.config.mjs local-preparation.spec.mjs
```

Expect **2 passed, 0 skipped**. Missing runtime variables can skip optional
qualification; a skip is not success. Only native file selection is substituted.
Import, playback, correction, explicit review action, compilation, complete ZIP
export, graph export, application relaunch and relocated graph consumption use
the actual installed product and runtime. The second case checks supplied chunks
without inventing word times. Evidence and screenshots stay in the specified
synthetic directory. These are software-mechanics checks, not human research
acceptance. Local measured results and gaps are in
[FIRST-SESSION-QUALIFICATION.md](FIRST-SESSION-QUALIFICATION.md).
