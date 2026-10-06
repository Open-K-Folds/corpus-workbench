# Bounded local correction recovery

This extends the transcript editor at `82ade69`; the implementation is
`a545d423b9c3f4755d83111ff0a936b1afa4dd4c`. It recovers inline corrected-reading
proposals on the same browser profile and origin after reload or page loss.
Native revisions remain the saved corpus authority.

## Scope and retention

Only inline transcript corrections are persisted. Property, annotation,
structural and returned-package forms retain their existing memory-only behavior.
No source package, media, full View, DOM Range or authentication capability is
copied into recovery storage. A record contains the selected corrected readings,
proposal, qualified token identities, Unicode code-point bounds/direction, exact
saved hashes/config version and, when needed, the complete pending command.

The authenticated session supplies a non-secret authority lineage identity
derived from the project's unique import command and initial snapshot. A record
also binds the current actor (`local-owner` in the present solo-user model),
project and document. Independent imports of identical packages/projects differ;
backups of the same authority retain their lineage. Changing origin, port or
browser profile makes that profile's local recovery unavailable.

One versioned browser journal is bounded to 20 records, 64 KiB per record and
1 MiB for the serialized journal, conservatively counted as two bytes per UTF-16
code unit. Browser Web Locks serialize journal changes across tabs. Recovery
atomically replaces its source slot, including at capacity; separate active
drafts use distinct IDs. Conditional replacement/removal preserves records
changed by another tab. There is no automatic expiry or eviction. Entries remain
until explicit discard/Undo, recovery replaces the intended slot, or a confirmed
command and exact saved reading refresh permit removal. Limits refuse new
persistence rather than remove another draft. Unknown/invalid older records are
preserved without executing commands.

## Recovery and saving

Reload offers explicit Recover and Discard with the saved basis visible. It does
not restore text automatically. Recover requires the exact revision, snapshot,
artifact, config and qualified token/readings to match. The native projection
reconstructs and checks the selection and grapheme boundaries. Unsupported
multi-token, whitespace and deletion proposals remain disabled drafts. A stale
proposal is inspectable/discardable; recovery never rebases it to another source.
The existing open-page conflict flow still requires explicit comparison/reapply.

Recovery actions refuse navigation while an inline correction is active, being
finalized or already resolving. Another document's retained proposal cannot
switch the surrounding document identity underneath an in-memory correction.
The active correction and other stored proposals remain available unchanged.

Accept queues and completes persistence of the complete command before sending
it. Response loss or failed saved-reading refresh keeps that identity. Reload
offers Resolve original save and blocks dependent authoring/review, even when
the initial reading request fails. Reconciliation resends precisely that command;
native idempotency prevents duplicate revisions. Definite stale/validation
rejections preserve the proposal and clear only the rejected command, using a
conditional journal update. Authentication/unknown outcomes retain the command.
Removal follows both commit confirmation and exact saved reading reconciliation.

Each change is queued without rerendering or normalizing the active input. The
status shows local persistence in progress and reports storage denial, quota,
unsupported locks and limits honestly. Saving still works if browser storage is
unavailable, using the authenticated open page; in that case reload recovery of
the proposal or uncertain command cannot be promised. A previous successfully
persisted proposal may remain when a newer large edit cannot be retained.

## Qualification

KhanCreate Windows qualification used fresh synthetic authorities only. Native
format, clippy, full tests and build passed. The final local browser suite passed all 67 scenarios with zero failures,
skips or flaky results at the reviewed implementation. Exact-head hosted
workflows are reported separately in the task handoff.
The 19 recovery cases cover reload, page close without unload, backward Unicode,
unsupported proposals, stale heads, response loss before/after commit, failed
reading refresh, document/tab isolation, identical independent imports at the
same origin, malformed records/journals, denied local/session storage, each bound,
capacity recovery and delayed conditional writes. Review repairs have dedicated
held-lock Undo/Accept/Reapply and native validation-rejection regressions.
Desktop 1440x1000 and mobile 390x844 screenshots were inspected; no horizontal
overflow was observed. Existing saved review/export/source/media contracts remain.

The independent read-only review is bound in
[`evidence/draft-recovery-review.json`](../evidence/draft-recovery-review.json).
Hosted CI is a separate gate; the handoff names exact commit/run results and
distinguishes runner acquisition failures from test regressions.

## Reproduce a synthetic preview

Build the native binary and UI, then create a new disposable package/authority:

```powershell
cargo build --locked
npm ci --prefix ui
npm run build --prefix ui
python scripts/prepare-synthetic.py --out .private/recovery-demo/package
target/debug/corpus-workbench.exe import --store .private/recovery-demo/authority --project synthetic-recovery --package .private/recovery-demo/package
New-Item -ItemType Directory -Path .private/recovery-demo/server
Push-Location .private/recovery-demo/server
../../../target/debug/corpus-workbench.exe serve --store ../authority --project synthetic-recovery --ui ../../../ui/dist --port 18946
```

Open the generated protected `.runtime/Open-Workbench.html` on that machine.
Create an inline proposal, wait for the local update indicator to finish and
reload. Recover or discard explicitly; inspect History to confirm that creating
or recovering a proposal did not create a native revision. Use an unoccupied port
and a new directory; do not reuse a research authority or another running preview.

## Limits

Recovery depends on browser storage and the same origin/profile. Browser
clearing/eviction, private browsing and OS/power loss can still remove local
drafts. An abrupt loss during a queued local update can lose its newest changes;
the UI distinguishes pending persistence. This is recovery assistance, not a
backup or acknowledged native save. No remote sync, production deployment,
physical Pi/power-loss qualification, broader form persistence or automatic stale
mapping is included. No dependency or security/access policy was changed.
