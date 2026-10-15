# Exact-revision review decisions

This bounded B15 follow-through makes persisted decisions inspectable in the
editor. The approved plan requires rejection and adjudication to be explicit,
with an exact revision, reviewer, scope, timestamp and rationale. Previously the
Review panel displayed only approved/unreviewed; the complete records were
available inside exported receipts.

Review now shows the latest full-package decision for its captured exact
revision: approved, rejected, needs adjudication, or no recorded decision. Its
read-only decision history lists every recorded decision newest first, including
the actor, solo self-review label, scope, original timestamp and literal rationale.
The revision selector can inspect older named revisions without changing the
current review form's target. New edits and restored states remain unreviewed
until they receive their own exact-revision decision.

`GET /api/reviews?revision=N` returns a project-authorized envelope containing the
revision ID, snapshot hash and matching persisted records. Omitting the parameter
selects the current head once. No schema migration, review mutation, artifact,
export receipt or compiler contract changed. Electron forwards this read through
the same bounded native bridge as the other project reads.

The UI checks response revision/hash identity, discards obsolete history results,
and reports read failures with independent retry controls. Retrying or selecting
history preserves the current rationale. Current decision and approved-contract
availability follow the freshly read full-scope decision, including concurrent
same-revision reviews; failed reads leave that action disabled. Existing draft,
stale-head and authoring locks still guard writes.

This remains the local-owner, full-package, solo-review workflow. Partial review,
independent reviewer roles, issue adjudication assignments and multi-user sharing
are not introduced. Decision history is a read of the existing native ledger,
not a second browser authority.

Focused synthetic native and browser tests cover persistence/reopen, ordering,
project/hash boundaries, restore/new-revision isolation, escaped notes, draft
guards, retry, delayed responses and concurrent current decisions. Desktop tests
cover the read-only route and actual native receipt retrieval across relaunch.
Public screenshots contain synthetic evidence only.
