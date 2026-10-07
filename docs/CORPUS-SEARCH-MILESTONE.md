# Corpus concordance milestone - dev.10

**Corpus search** finds literal token sequences across saved documents, presents
KWIC context and qualified stable token IDs, plays observed audio intervals,
opens current hits in the authoring workspace and inspects historical hits read
only. A JSON download retains the exact query, page, snapshot, projection and
result fingerprints. This is a bounded contribution to B18/B28 of the approved
plan; full TEITOK/CWB/CQP parity remains open.

- [x] Native revision-bound literal concordance and strict request/result bounds.
- [x] Corpus-wide reading, language and document filters with exact hit counts.
- [x] Current navigation, historical inspection, observed audio and JSON export.
- [x] Draft-safe reload, stale-head rejection and obsolete-response suppression.
- [x] Optional derived CWB index and real CQP comparison for the selected grammar.
- [x] Independent native, HTTP, browser and adapter fault tests.
- [x] Bounded exact label/variety constraints on existing whole-token spans.
- [ ] Original TEITOK index rebuilding, arbitrary CQP, regex and general multi-layer joins.
- [ ] Bulk authoring from hit sets, durable worker jobs and production operations.

## Use the search

Open **Corpus search** in the inspector. Enter one exact token per line, select a
reading and optional language/document scope, then search. Case, Unicode code
points and whitespace inside each line are significant. Phrases stay within one
utterance or an unsegmented document run; overlapping matches are retained.
`.*` is a literal token. The default search uses the current saved revision, so
unsaved authoring drafts are not query evidence.

Original source, corrected reading and normalized reading remain distinct.
Corrected falls back to original only when absent. Normalized falls back to
corrected/original when absent or explicitly unresolved; the obsolete normalized
value and its status remain in result evidence. Empty values remain empty.
Language values are exact custom strings with their source provenance; no
linguistic inference or normalization is performed.

Current results must still match the authority before navigation or playback.
After an edit, search again or explicitly reload saved evidence. Reload refuses
to discard authoring drafts. Selecting a historical revision produces read-only
hit inspection and revision-specific media; it does not replace the authoring
head. Search exports contain the shown page, not an unbounded complete hit set.
They retain the corpus-rights scope and do not grant redistribution rights.

Audio requires one unambiguous in-package media reference and observed timing.
When every matched token has a word interval, playback uses those intervals;
otherwise a known whole-utterance interval is explicitly labelled. Missing or
ambiguous media/timing yields no play action. No word timings are invented.

## Bounded span constraint increment

The source increment after integrated main `ed82deb` advances B28 without a new
release or deployment. Expand **Span annotation constraint**, select **Label** or
**Language / variety**, and supply its exact value. This combines token text and
the existing token-language filter with an annotation on the same saved revision.
Every token in a phrase must occur in the explicit `corresp` anchors of **one**
matching whole-token span. Two separate spans cannot jointly satisfy a phrase;
gaps in discontinuous anchors are never filled. Character/subtoken annotations,
including unresolved coordinates, are excluded from this whole-token grammar.

The native query adds one optional `span` object, for example:

```json
{"span": {"field": "label", "value": "code-switch"}}
```

`label` and `variety` are the actual fields of the supported unqualified
`spanGrp` / direct `span` sidecars, already projected by the package authority.
No parallel annotation database or inferred language metadata is introduced.
Values are case-sensitive and byte-exact, at most 512 UTF-8 bytes. An empty value
matches an authored empty field; a missing field does not match. Ambiguous shared
sidecars, unsupported/namespaced field structures and `xml:base` reference scope
are rejected with the original source preserved. Annotation joins are bounded to
100,000 projected anchors; repeated witness evidence is bounded before copying
into the existing 4 MiB page limit.

Hits remain unique token occurrences even when multiple spans satisfy the query.
Their `spans` evidence retains each sidecar-qualified ID, artifact hash, full
projected fields and explicit anchors. The same evidence is available in compact
result disclosure, historical read-only inspection and JSON export. Counts and
pagination apply after the span constraint. Current hits are rechecked against
the saved head; historical queries retain the exact old annotation bytes and
media revision. No annotation constraint creates timing or changes the existing
word/whole-utterance audio qualification.

The additive query uses schema 1 and omits `span` when unconstrained. The engine
fingerprint is now `literal-token-concordance/2`; exports from engine 1 retain
their historical provenance but require a new query for action resolution under
engine 2. Corpus snapshots, revision history and imported-index status do not
change. The optional CQP adapter rejects span constraints as native-only before
external execution; general CQP joins remain unqualified.

## Query and projection bounds

The native engine accepts 1-8 literal terms, each at most 512 UTF-8 bytes, optional
exact language values at most 256 bytes, 0-12 context tokens, at most 200 hits per
page and offsets at most 100,000. The projection is limited to 1,000 documents,
100,000 tokens and 16 MiB combined transcript/annotation XML. A result page is
limited to 4 MiB. Nested token structures are rejected by this search mapping;
their original data remains preserved by the package authority.

Every query binds project, revision and snapshot hash. Projection fingerprints
also bind settings/configuration and the engine version. In-memory projections
are derived views; search creates no second revision ledger and changes no
canonical XML, review or imported-index status. Hit resolution recomputes the
bounded page and rejects altered query, proof, project or hit identity.

## Native and optional CQP adapter

Native commands use the same strict JSON query as the UI:

```sh
corpus-workbench search --store AUTHORITY --project PROJECT --request query.json
corpus-workbench search-projection --store AUTHORITY --project PROJECT --request query.json
```

An operator can separately qualify this grammar against trusted, locally
installed `cwb-encode`, `cwb-makeall` and `cqp` binaries:

```sh
python scripts/cqp-literal-adapter.py --native NATIVE_BINARY --store AUTHORITY \
  --request query.json --tools CWB_BIN_DIRECTORY --work NEW_DERIVED_DIRECTORY \
  --out NEW_REPORT.json
```

The adapter uses `literal-utf8-hex/1`, a reversible UTF-8 key mapping that keeps
tabs, empty values, combining forms and command-looking strings as data. It
generates only literal fixed-width clauses and source-run boundaries. Arbitrary
CQP input is not accepted. The entire returned position set is checked for
bounds, order, width, source boundary, reading, language and document semantics;
the exact total and selected stable-ID page must agree with native search.

Caller input is frozen once. Search/projection bindings and the current head are
rechecked around external execution. Derived index manifests bind snapshot,
settings/mapping, tool binaries and generated file hashes. A changed revision,
tool or index requires a fresh derived directory. Output paths cannot overwrite
the authority, request, executable, tool directory or existing report. Each
external command has a time/output bound. This operator tool is not exposed by
the browser and is not included in the default application image.

This mapping is not original TEITOK byte-offset/index parity. Imported CWB indexes
remain governed by their existing stale-index/export checks. Regex, case folding,
Unicode normalization, general structural joins, alignment, arbitrary CQP programs and
bulk edits are unqualified and unavailable in this slice.

## Validation and provenance

The span increment adds seven native contracts for same-span phrase coverage,
qualified witnesses, exact values and bounds, stale/current versus historical
evidence, ambiguous schemas/associations and output amplification. Two browser
journeys extend the six concordance journeys with empty/no-match states,
layer/filter changes, keyboard controls, light/dark/mobile rendering, exact
witness export, span-only concurrent edits and historical audio/navigation.
The adapter has a regression for explicit native-only rejection. Exact-head
results and independent review are recorded in the scoped pull request. All
local mutation fixtures use fresh synthetic authorities on KhanCreate.

The original dev.10 native suite contained 175 tests: the prior 155 plus five search contracts and
15 independent falsifications. Focused local runs passed all 20 new contracts,
including deterministic concurrent-head races, strict bounds, forged hit proofs,
Unicode/IDs, unresolved normalization, overlap, media ambiguity, result limits,
and actual HTTP session/CSRF/Origin/project and historical media-range behavior.
Strict Clippy, formatting and the TypeScript/Vite build pass.

Six new isolated Chrome journeys pass with fresh synthetic authorities: KWIC,
real playback, exact export, desktop/mobile rendering, filters/readings,
intermediate historical revisions, stale results, protected drafts and delayed
responses. The complete browser suite contains 29 journeys. Existing authoring
and return-copy journeys are checked for regression; exact-head hosted results
are recorded in the pull request. The environment's Browser plugin was unavailable;
QA used the existing isolated Playwright/Chrome route without a user browser.

Fourteen independent Python adapter tests pass with real native authority/proofs
and injected external-tool faults. The real CWB 3.5.0 Windows x86-64 tools pass
23 hand-labelled synthetic comparisons plus index tamper, stale-current and
changed-revision index-reuse rejection. Query-only authority views remain exact.
No CWB/Linux/ARM64 or physical Pi qualification is implied by that Windows run.

The optional archive was obtained from the official
[CWB distribution](https://sourceforge.net/projects/cwb/files/cwb/cwb-3.5/windows/cwb-3.5.0-win64-x86_64.zip/download):
`cwb-3.5.0-win64-x86_64.zip`, 34,637,626 bytes, observed SHA-256
`6fb23ba3a565d01105ab96a8f2d1bcd6294dd1913944657af8e12898066a9a2f`.
This is an observed checksum, not independent signature verification. CWB is
GPL-2.0-or-later; the retained upstream archive includes its dependency notices.
No CWB binary/source was copied into the application, no locked application
dependency changed, and no LaBB-CAT AGPL code was reused. This inventory does not
claim legal clearance. See the official [encoding tutorial](https://cwb.sourceforge.io/files/CWB_Encoding_Tutorial/2.html)
and [CQP dump documentation](https://cwb.sourceforge.io/files/CQP_Manual/7_2.html)
for the external format, and [private preview access](PRIVATE-PREVIEW.md) for
launching an existing protected Windows preview from another computer.
