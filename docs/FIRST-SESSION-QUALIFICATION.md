# First-session qualification, 3 November 2026

The installed Windows build completed a new synthetic session from recording and
supplied text through correction, explicit exact-R2 review, actual Semantica
compilation, complete-package export, graph export, app relaunch and relocated
graph consumption. This proves software mechanics. Human-language review and
research acceptance were not performed.

Main was independently rechecked at `d54ad436d0f57bab489bad8c527299f7800dc9c9`.
The existing clean desktop build is `a816c7f8a6af0d117d48a75e10c245a6dade4586`;
both identify tree `725d5fb837b50136beac140ac8881cc78e14cb03`. No product code,
dependencies or binaries changed for this qualification. The scoped changes add
relaunch/relocation assertions and reconcile first-run instructions that omitted
the existing recording importer and desktop research handoff.

## Results and evidence

| Check | Observed result |
| --- | --- |
| Existing launcher | Archive, pinned manifest and all 99 product-file hashes verified; persistent research profile not opened |
| Native Electron session | 2 passed, 0 failed/skipped/flaky; generated UTF-8 and supplied-chunk inputs |
| Saved correction and review | Original `Molo`, corrected `Molweni`, uncertainty note and exact R2 review survive duplicate import and application relaunch |
| Actual Semantica 0.6.8 | Compatible clean compiler `81af6d16c223582d1b6ba54549831bb050b07302`; 12 nodes, 11 edges; actual native reader reopen |
| Relocated portable graph | Fresh Python process verifies four payload hashes and reopens the copied graph; original recording/raw hashes retained as references |
| Native importer contracts | All 3 input shapes plus cancellation, frozen preview, duplicate/concurrent/restart/lost-response recovery and complete export/reimport pass |
| Desktop unit tests | 66 passed, 0 failed/skipped, 1.48 seconds |
| Python package-boundary tests | 21 passed, 0 failed, 0.60 seconds; runtime/native-reader doubles in this suite are distinct from actual Semantica execution above |
| Existing protected state | All 12 fingerprinted files unchanged, including registered authority files, drafts/settings, launcher and pinned archive; private fingerprints retained only locally |

Machine-readable evidence: [qualification](../evidence/first-session/qualification.json),
[native session](../evidence/first-session/native-session.json),
[import contracts](../evidence/first-session/import-contracts.json) and
[resource observations](../evidence/first-session/resources.json).
All published evidence describes generated synthetic inputs. Actual private
source content, review state and personal OpenKnowledge data were not used.

## Rendered desktop checks

The Browser plugin was unavailable; the existing Playwright 1.56.1 Electron
route used a fresh synthetic profile at `workbench://app/`, title **Corpus
workbench**, with a 1440 x 1000 content viewport. Electron is 44.7.0, Node is
24.18.0 and the separately installed Semantica Python is 3.13.14. Native file
selection alone was substituted; actual import, backend, storage, review,
compiler, export and playback ran normally.

| Check | Evidence |
| --- | --- |
| Page identity and meaningful content | Expected title/origin and visible saved-token controls asserted |
| Framework error overlay | Absent in inspected native captures |
| Console health | Zero page errors and zero renderer console errors |
| Interaction proof | Preview/cancel, invalid input, import, playback, named correction, explicit review, run/export, duplicate and relaunch state assertions pass |
| Screenshot inspection | Preview, validated light/dark handoff and reopened dark desktop captures retained outside the source checkout; no observed clipping or overlap in the inspected viewport |

The launcher's old disposable cache was incomplete. Its existing recovery path
staged a fresh verified sibling without deleting the incomplete cache. Native
qualification reused that verified sibling. The original launcher and research
profile were not modified. Repeated recovery can retain additional program
copies while the default cache remains incomplete; no cache cleanup was done.

Initial managed-sandbox runs could not complete: Windows denied temporary-file
atomic renames/access. A subsequent native desktop run also exposed four missing
UI test-dependency resolutions in the isolated checkout. Reusing the existing
pinned UI dependencies resolved those; the complete native reruns passed.
These attempts are recorded separately from the successful native results.
Playwright's launcher emitted color-environment and shell-argument deprecation
warnings; these were runner warnings, not renderer errors. No application repair
was indicated by the successful native journey.

## Resource observations and reproduction

The two-case native run took **135.37 seconds** including runner overhead
(Playwright reports 133.03 seconds). At 250 ms sampling, the owned process tree
peaked at **1.33 GiB summed resident memory**, **3.10 GiB summed private committed
memory** and 15 simultaneous processes. Sampled CPU time totalled 91.42 seconds.
The importer-contract run took 5.32 seconds with a sampled resident peak of
79.95 MiB. These sums may count shared resident pages repeatedly and miss short
lived child processes. I/O counters are not allocated disk space; these are local
observations, not a memory ceiling or a 4 GiB-device qualification.

No Rust/UI build, dependency installation, Docker/WSL storage change or cleanup
was performed. Existing pinned dependencies and the launcher archive were reused.
Synthetic native evidence occupied about 18 MiB outside the checkout.

Follow [FIRST-RESEARCH-SESSION.md](FIRST-RESEARCH-SESSION.md) for the exact native
test environment and command. The additional focused commands, run natively from
the checkout, were:

```powershell
node --test desktop/tests/*.test.cjs
python -B -m unittest discover -s scripts/tests -p 'test_semantica_handoff.py' -v
node scripts/verify-local-transcript-import.cjs --binary $PackagedBackend --out $FreshSyntheticDirectory
node --check desktop/tests/local-preparation.spec.mjs
git diff --check
```

The last importer command generates only synthetic fixtures and refuses an
existing output directory. It does not execute Semantica; the native session
does. The local resource recorder sampled only the test runner's descendants
using the already installed `psutil`, with no system-wide process modification.

## Remaining qualification gaps

Actual listening/transcription assessment and research acceptance remain human
tasks. Native picker interaction, other operating systems, mobile/minimum
viewports, Raspberry Pi/4 GiB performance and physical power loss were not
qualified here. Full Rust/browser/container suites and new hosted CI were not
rerun locally for this documentation/test-only change. The existing local package
is unsigned and the compiler/runtime remain separately supplied. A detached
portable graph verifies its exported snapshot, not later authority eligibility.
