# First-session qualification, 3 November 2026

The installed Windows build completed a new synthetic session from recording and
supplied text through correction, explicit exact-R2 review, actual Semantica
compilation, complete-package export, graph export, app relaunch and relocated
graph consumption. This proves software mechanics. Human-language review and
research acceptance were not performed.

Main was independently rechecked at `d54ad436d0f57bab489bad8c527299f7800dc9c9`.
The existing clean desktop build is `a816c7f8a6af0d117d48a75e10c245a6dade4586`;
both identify tree `725d5fb837b50136beac140ac8881cc78e14cb03`. The installed-runtime
qualification reused that product without rebuilding it. The initial scoped
changes add relaunch/relocation assertions and reconcile first-run instructions
that omitted the existing recording importer and desktop research handoff. A
subsequent hosted audits required the Vite and ZIP dependency patches below;
the installed desktop binary and research data remain unchanged.

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

During the installed-runtime qualification, no Rust/UI build, dependency
installation, Docker/WSL storage change or cleanup was performed. Existing pinned
dependencies and the launcher archive were reused. Synthetic native evidence
occupied about 18 MiB outside the checkout. The hosted-audit follow-up uses fresh
UI dependencies, a small UI build and a focused debug Rust build in fresh C:
temporary storage. No release build or desktop repackaging was performed.

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

## Hosted audit follow-up

The first draft head, `b9a143d22d862267e838d4ad2ec8941c7b009232`, completed all four
push/PR workflows: both container workflows succeeded and both corpus workflows
failed at the UI dependency audit. Ten of twelve jobs succeeded; the two browser
jobs stopped at `npm audit --prefix ui --audit-level=low`, so their browser tests
and later Cargo audit did not run. This was a real failure, not a flaky browser
assertion. See the [PR corpus run](https://github.com/Open-K-Folds/corpus-workbench/actions/runs/41685266789).

The locked Vite 7.3.6 build tool was affected by upstream advisories. Its
[7.3.7 patch release](https://github.com/vitejs/vite/releases/tag/v7.3.7) includes
the fixes identified by the audit; upstream lists 7.3.7 as patched for the
[custom-middleware issue](https://github.com/vitejs/vite/security/advisories/GHSA-9jrq-w75r-8gcw)
and [non-Windows file-serving issue](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22).
Only the exact Vite pin and its lock entry change; no transitive dependency
versions change. No audit rule is relaxed or skipped.

A fresh UI-only dependency directory preserves the earlier shared dependency
installation. The patched lock audit reports zero vulnerabilities; typechecking
and the production UI build pass. All generated JavaScript, CSS, worker and font
assets are byte-identical to the verified installed desktop assets. The focused
import, decision-history, research-handoff and live-overview browser run passes
all 33 cases with zero skips, failures or flaky results in 74.86 seconds including
runner overhead (71.95 seconds reported by Playwright). It uses the existing
packaged backend and installed Chrome; mocked desktop-bridge cases remain
control-plane checks, distinct from actual Semantica execution. These checks and
subsequent hosted results qualify the source follow-up separately from the
retained installed-runtime evidence above. See the
[build-tool follow-up evidence](../evidence/first-session/ui-build-tool-followup.json).
Exact final-head
hosted results are recorded in the PR and local delivery result, avoiding another
source commit just to record its own checks.

The recovered program cache contains 100 files, including its manifest, totalling
395,861,075 bytes (377.5 MiB of logical file lengths). The existing pinned ZIP is
165,953,003 bytes and was reused. Each later recovery while the default cache is
still incomplete can retain another program copy of roughly this size in the
system temporary directory. Actual allocated disk space can differ. The original
launcher, incomplete cache, research profile and data were preserved; no cleanup
or launcher replacement was performed.

## ZIP advisory follow-up

After the Vite fix, head `75a7774f43e229f7273262e7b5b3f8cc1dcaad73` completed
both full 127-case browser suites and both npm audits. All native and container
jobs passed. Its two browser jobs then failed the later Cargo audit on `zip`
0.6.6: RUSTSEC-2026-0367, -0368, -0369 and -0429. The earlier npm failure had
prevented that Cargo step from running. See the
[PR corpus run](https://github.com/Open-K-Folds/corpus-workbench/actions/runs/41686553114).

The production source uses `zip` only in `package::zip_directory` to write
complete-package exports; it has no ZIP extraction call sites. Upstream lists
[9.0.0 as patched](https://rustsec.org/advisories/RUSTSEC-2026-0369), and its
[Rust 1.88 minimum](https://github.com/zip-rs/zip2/blob/v9.0.0/Cargo.toml) fits the
existing Rust 1.90 toolchain. The exact pin is now 9.0.0 with default features
still disabled. The writer uses `SimpleFileOptions` and explicitly records Unix
creator metadata so existing `0600` archive permissions survive Windows builds.
No extraction operation or audit suppression is added.

The new regression initially caught the changed Windows creator default: the
archive reader reported `0664` despite requesting `0600`. Retaining the previous
Unix creator metadata fixes this. Both focused Rust export tests now pass,
covering Unicode/binary/empty payloads, stored entries, private permissions and
refusal to overwrite an existing destination. Rustfmt passes. The existing
complete authoring browser journey also passes against the patched debug backend.
Independent Python `zipfile` verification confirms all 25 exported files carry
Unix `0600` metadata, source audio is unchanged, and native reimport preserves
the saved Unicode correction. The independently imported authority starts
unapproved; same-authority review persistence is tested separately above.

Only ZIP's required dependencies change in the Cargo lock: add `equivalent`,
`indexmap` and `typed-path`; remove now-unused `byteorder` and `crossbeam-utils`.
The dependency inventory follows the exact locks and retains the older advisory
database scan explicitly as historical evidence. See
[ZIP follow-up evidence](../evidence/first-session/zip-audit-followup.json).
The existing pinned desktop build remains unchanged; this follow-up qualifies
source and a debug backend, with final exact-head hosted checks recorded in the
PR and local delivery result.
