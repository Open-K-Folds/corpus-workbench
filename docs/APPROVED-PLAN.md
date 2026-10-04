> Public edition of approved migration plan v2, dated 2026-10-04. Private corpus statistics, device names and evaluation details are redacted. All 34 backlog items and 36 reference entries are retained. Implementation/release status is in MILESTONES.md.

# Corpus workbench migration plan

## A TEITOK compatible Rust core for Open-K-Folds

Prepared for Open-K-Folds | 4 October 2026 | Planning version 2

Revision note: this version adds a source-checked LaBB-CAT capability adoption plan, integrates its layer and temporal constraints into the Rust design, and updates dependencies, acceptance gates and copyleft boundaries. The first lossless authoring slice, existing Omnilingual pipeline and single evidence authority remain the delivery baseline.

## 1 Recommendation and decision

Build a corpus authoring workbench with a native Rust core and a TypeScript interface, using TEITOK as the compatibility reference and retained fallback. Begin with an authorized private project copy, whose identifying details are omitted from this public edition. Prove evidence, annotation and history preservation before expanding the corpus or replacing the existing tool.

Use LaBB-CAT as an additional capability reference for layered temporal annotation, language-aware lexicons, contextual search and optional phonetic analysis. Adopt these selectively around the authoring workflow; do not replace the TEITOK compatibility contract with a LaBB-CAT database migration. Section 3 separates foundation, near-term and later additions, with an exit test for each.

This is a staged migration of a research workflow, not a line-by-line PHP translation. The difficult work is preserving document structure, stable references, research provenance and advanced editing capabilities. Rust can improve the maintainability and enforcement of those rules, but changing language does not establish correctness by itself.

The first implementation should have one authoring authority inside the research-intelligence evidence domain: a native service, SQLite for transactional revision and workflow metadata, and immutable local artifact files. The TypeScript interface talks to that service. Independent backups remain necessary; one authority does not mean one copy. semantic-compiler consumes approved, exact revisions through a versioned contract. CompanyOS records consequential project decisions. The graph remains a rebuildable interpretation of evidence.

The earlier Cloudflare-first preference needs an explicit architecture decision. Ordinary Workers run Rust as WebAssembly rather than as a native Rust server. A D1-authoritative cloud version remains possible, but is a different deployment with additional consistency and performance work. Do not create both a D1 authority and a local SQLite or Postgres authority for the same records. First establish the native workflow; choose the later hosting model using measured evidence and the user's availability and privacy priorities. [S8, S9]

### What the first slice must prove

- Import the complete project copy, including XML, settings, annotation definitions, sidecars and media references
- Play and seek audio; correct a token without changing its identity; create and inspect a span and a relation
- Define and apply a language or annotation value without flattening isiXhosa, isiZulu, slang or code-switching
- Save a named revision, review an exact revision, compare changes, undo a committed edit and restore a previous state
- Export a complete package, reopen it in the retained TEITOK environment and verify every required relationship
- Recover acknowledged work after an interrupted save and reject a stale edit from a second browser tab

Retokenization, live collaborative merging, full corpus-scale query migration and cosmetic redesign do not belong in this first slice. Their absence is a bounded stage boundary, not permission to remove them from the eventual capability contract.

### What is already known and what remains to prove

Private trial details and source-specific measurements are excluded from this publication edition. Separate synthetic correction/save/reload/export/history/recovery fixtures establish engineering contracts. The existing separate ASR worker remains outside the workbench; this project does not rebuild ASR.

The inspected TEITOK source is commit 57d864b57fa3ed9f0a660a7781533ce7fa09ae2b. The source uses a PHP and JavaScript application plus Perl and C++ tooling, configurable XML and optional CWB/CQP components. All architecture, backlog and acceptance thresholds below are recommendations awaiting implementation; no fork, deployment or machine changes are authorized by this plan. [S1-S7]

## 2 The authoring journey

### Collect and preserve

Register a handpicked source with its existing evidence ID, creator/source URL where appropriate, capture date, permitted use and access restrictions. Preserve the original audio or video bytes and their checksum. Public availability alone is not a grant to redistribute, train on or expose a creator's material. Store only personal information necessary for the research purpose; make restricted material visibly restricted throughout export and analysis.

Import an Omnilingual result as an immutable machine draft. Record the exact model or checkpoint, code/configuration version, run ID, segmentation, time base, device and dtype. Keep GPU FP32 and any CPU fallback distinguishable in provenance. If the supplied run lacks a field, mark it unknown rather than inventing it. The corrected transcript must never silently become the original ASR output.

### Listen and correct

Show synchronized audio, utterances and tokens in the main workspace. Provide keyboard shortcuts, loop selection, playback speed, seek-to-token or utterance and a persistent inspector. Let the editor correct text while retaining the original reading and its history. Display save state as unsaved, saving, saved revision or conflict; never imply that a local draft has been committed.

Authentic speech remains the primary human-corrected layer. Standardized spellings, translations, glosses, lemmas and linguistic interpretations are separate fields or layers with their own provenance. The interface must make code-switching, ambiguous language assignment, incomplete speech, overlaps and uncertainty expressible without forcing a single standard-language reading.

### Annotate and explain

Select a token, contiguous span or supported discontinuous span, choose a versioned annotation type, and enter a value. Show relations with their endpoint identities and direction. Support project-specific definitions, permitted values, explanatory notes, examples and a distinction between missing, uncertain, not applicable and explicitly empty values. Definitions must be editable through an understandable form; advanced users can inspect the underlying schema.

Annotation should feel continuous with listening and correction. Avoid a modal dialog for every token. Bulk changes require a preview of affected records, an exact base revision and one reversible operation group. Keep inspectable XML available as an expert view; unrestricted raw XML editing remains guarded until structural validation and reference repair can make it safe.

### Review and use

A reviewer opens a comparison against a named previous revision, sees unresolved issues and hears the relevant audio. Approval attaches to that exact transcript and annotation revision, not to the file name or whichever version is latest later. Partial review records its precise coverage; disagreement, rejection and adjudication are explicit states. Self-review may be allowed for a solo pilot but must be labeled; a later independent-review requirement can then be enforced without rewriting history.

Only an approved, eligible revision enters the default Semantica pipeline. Results link back to the exact token IDs or media interval used. Later corrections mark affected extraction results stale and produce a new graph generation. An analyst can choose a historical generation deliberately; the normal interface must not pass off stale assertions as current findings.

## 3 Capability contract

The contract covers the research work that must survive migration. Inventory the actual project configuration and used plugins before treating this matrix as complete. An existing TEITOK feature marked deferred remains accessible through the retained copy until its replacement passes the stated gate. New LaBB-CAT-inspired capabilities are proposed additions and are not assumed to exist in that fallback. Preserve unsupported data even when the first interface cannot edit it.

| Capability | Migration treatment | Release gate |
| --- | --- | --- |
| Original media and machine drafts | Preserve immutable bytes and run provenance | Hash and media-reference equality |
| Token text and custom attributes | Preserve and replace popup-only workflow | Same identities and values after export |
| Utterances and audio timing | Preserve; add synchronized inspector | Seek, overlap and time-base tests |
| Hierarchical layers and temporal constraints | Foundation schema; preserve unknown structures | Parent, overlap, containment and missing-time fixtures |
| Original and normalized readings | Preserve as separate layers | Neither overwrites the other |
| Language and code-switch labels | Preserve; editable definitions | Ambiguous and mixed labels survive |
| Lemma, POS and morphology | Preserve attributes and vocabulary definitions | Import and export parity; editor when used |
| Spans and directed relations | Preserve sidecars and endpoint semantics | Zero orphaned endpoints |
| Header metadata and project settings | Preserve; version explicit values and resolved defaults | Source of each inherited value visible |
| Revision history and restore | Replace daily-only recovery with explicit revisions | Same-day compare, undo and crash recovery |
| Review and adjudication | Add exact-revision approval and issue tracking | New edits cannot inherit old approval |
| Search, KWIC and corpus filters | CWB parity first; add bounded multilayer queries later | Golden queries, hit identities and audio context match |
| Bulk editing | Add preview, grouping and rollback | Stale batch rejected atomically |
| Retokenization and token restructuring | Defer writes until reference repair is safe | Split, merge and deletion tests pass |
| Facsimiles, page zones and video | Preserve imported objects and links | Gate editable parity if present in real corpus |
| Nested token forms and alternative analyses | Preserve tok, dtok, mtok and unknown structures | No flattening or identity collisions |
| Dictionaries, tagging and converters | Preserve; add project lexicons and unknown-word review | Language coverage, per-token overrides and license checks |
| Word and phone alignment | Preserve; later reviewed correction and optional jobs | Manual boundaries protected and exact inputs pinned |
| Praat and EMU exchange | Later adapters when research needs justify them | Stale external edit rejected; timing round-trip proven |
| Raw XML and arbitrary project extensions | Read-only expert inspection initially | Guarded edits only after structural gate |
| Multi-user access | Add roles and conditional commits before sharing | Cross-project denial and concurrency tests |
| Live collaboration and branching | Defer; linear history first | Separate design and merge proof required |
| Cosmetic redesign | Defer | Functional usability has already passed |

Preservation has two meanings. An untouched imported file should export byte-for-byte unchanged. An edited file must preserve all unaffected syntax and all semantic relationships; if byte-preserving editing cannot be proven for a construct, block that edit or retain it read-only. A generic XML parse-and-reserialize operation is not an acceptable substitute for this contract.

### LaBB CAT adoption priorities

LaBB-CAT's official documentation and annotation-graph API provide the capability evidence below. The Rust design, immutable history, review gates and exact-revision Semantica behavior are recommendations for this workbench, not claims that LaBB-CAT implements them in the same way. No LaBB-CAT code is imported by this plan. Reuse decisions require the separate license review in section 11.

Foundation means a small data or validation rule belongs in the first slice. Near-term means after that slice has passed its lossless export and recovery gates. Later means optional research capability requiring an additional decision or resource proof. Preserve imported advanced data from the beginning even if its editor or processor is later.

| Capability | Priority | Dependency and backlog |
| --- | --- | --- |
| Layer hierarchy and time constraints | Foundation | Stable IDs and versioned schema; B06-B07 |
| Explicit metadata and language defaults | Foundation; richer routing near-term | Definitions and review; B07, B13, B27 |
| Multilayer search and contextual audio | Near-term | CWB parity and revision-aware index; B18, B28 |
| Project lexicons and pronunciation review | Near-term | Language definitions and typed imports; B27, B29 |
| Imported alignment review and provenance | Near-term | Temporal schema and history; B30 |
| Structural and linguistic quality queues | Foundation; phonetic checks near-term | Validation and exact review; B15, B31 |
| Automated word and phone alignment | Later and resource-gated | Lexicon coverage, jobs and measured worker; B33 |
| Praat and EMU exchange and acoustics | Later | Reviewed timing and protected edit exchange; B34 |
| Extensible jobs and portable analysis exports | Foundation contracts; adapters near-term | One authority, typed results and rights; B10, B32 |

### Layer hierarchy and temporal constraints

Verified capability: the nzilbb.ag Layer API represents parent layers, unaligned tags, time instants and intervals, multiple child annotations, permitted sibling overlap, parent containment and whether children cover their parent completely. This is a useful model for corpus layers rather than a requirement to use its Java implementation. [S21]

Adopt a versioned layer definition in Rust with those constraints, allowed value types and declared evidence dependencies. Model participant, turn, utterance, word and phone relationships without conflating structural parentage with temporal containment. In the AG model, words and utterances can share a turn parent; do not assume a mandatory utterance-to-word parent chain. Do not force every word into a simplistic strict tree: preserve overlapping speakers, untimed text, cross-cutting phrase spans and the original TEITOK structures. An unaligned label can inherit its parent's extent while retaining its own identity; a phone inventory label alone is not an observed timed phone.

Gate: fixtures must accept permitted overlap and untimed tags, reject cycles and impossible required containment, and round-trip unchanged XML. Full coverage is required only for layers configured to require it; ordinary silence or incomplete timing must not be silently filled. No separate graph database is needed for these domain records.

### Metadata and custom language definitions

Verified capability: LaBB-CAT routes language-sensitive phonemic tagging using a phrase-language override, then transcript language, then corpus language. Auxiliary managers can target different languages in one pronunciation layer. This is specific documented language inheritance, not proof that every metadata field has arbitrary cascading semantics. [S23]

Adopt explicit and effective values separately, with the rule, source scope and definition version visible. Preserve participant and transcript attributes without copying them into every token. A project may define its own language or variety labels, unknown and mixed values, and subtoken judgments; external codes are mappings, not an admission requirement. Near-term routing may use a clear language assignment to select a lexicon or processor. Ambiguous mixed-language tokens remain unresolved or human-routed rather than assigned a convenient default model.

Gate: changing a corpus default must leave an explicit phrase override intact, invalidate only affected generated results, and leave historical bundles reproducible. Test isiXhosa, isiZulu, English, local labels and intra-token mixing without any model installed. Defaults must never grant data-sharing rights.

### Multilayer search with evidence context

Verified capability: LaBB-CAT exposes search matrices combining layer patterns, numeric ranges, negation, token-distance constraints and boundary anchoring. Its corpus interface connects matches to transcripts and playable media, with results and selected annotations exportable for analysis. [S24, S25]

After CWB parity, add a bounded query representation supporting the specific research questions selected in the pilot, such as a language transition with a neighboring lexical form, or a reviewed phone with a duration criterion. Declare which combinations the initial engine supports and reject unsupported query semantics. Each hit carries stable target IDs, a snapshot fingerprint, participant/utterance context and authorized media coordinates. Let users hear configurable surrounding context, open the exact evidence revision and export the same result set. Apply rights filtering before counts as well as before playback.

Gate: a hand-labeled multilingual fixture must produce the expected hit IDs and audio intervals; current and historical modes cannot mix revisions. An edit must make an old result stale before it can drive a bulk command. Add query cost, regex complexity and result-size limits; do not rewrite all of CQP to obtain one useful layered search.

### Lexicons pronunciations and unknown words

Verified capability: LaBB-CAT supports flat-file lexical tagging, configurable spelling-to-phoneme mappings and workflows for missing pronunciations. Its tutorials distinguish token-specific pronunciation tags from reusable dictionary entries. Those are useful authoring patterns; an English lexicon or a simple mapping is not automatically suitable for the user's languages. [S26-S28]

Add versioned project lexicons with language/variety, written form, pronunciation alternatives, symbol inventory, source, license and review status. Preserve a token-level exception separately from the dictionary. The unknown-word queue should link to audio, frequency and each affected token; it must distinguish a transcription error from a genuine name, slang form, mixed word or unknown pronunciation. Show the impact before a dictionary update regenerates suggestions. Do not normalize authentic speech merely to satisfy a lookup.

Gate: an unfamiliar local term remains editable without a pronunciation; a reviewed override survives regeneration; ambiguous candidates are not silently selected. Prove language routing, phone-symbol validation, import/export and affected-result invalidation. Dictionary coverage, model availability and language-label support are three different checks.

### Alignment and manual correction provenance

Verified capability: LaBB-CAT integrates MFA for word/phone forced alignment, with either compatible pretrained dictionaries and acoustic models or a train-and-align route. Its Praat workflow flags manual alignment corrections so later automatic alignment does not replace them. EMU-webApp supports inspecting and saving phone-boundary corrections. [S29, S30, S31, S32]

Near-term, import and inspect existing alignments and add a versioned correction command. Store source transcript and media hashes, time base, input lexicon, engine/model/configuration versions, status, actor and manual-protection flags. A new automatic run produces a candidate layer or explicit comparison, never an overwrite of a human revision. Unknown legacy provenance stays unknown; engine confidence, manual origin and reviewer approval are separate concepts.

Later execution needs an approved worker and measured resources, accurate utterance segmentation and a compatible dictionary/phone set. The LaBB-CAT train-and-align guide calls for roughly 3-5 hours of speech; a short private evaluation cannot establish that route. Model availability and suitability for isiXhosa, isiZulu and mixed speech must be checked separately. If resources are missing, keep manual timing or an explicitly unaligned layer. Omnilingual continues to supply ASR drafts; forced alignment is a distinct optional operation.

Gate: re-running alignment cannot alter a manually protected boundary; a correction makes dependent duration/acoustic results stale; failed or skipped utterances remain visible. Check phone/word containment and boundaries against audio. A sampled human-reviewed benchmark must establish useful accuracy for each supported language/variety before automatic output becomes a routine aid.

### Quality checks that support review

Verified capability: the annotation-graph Validator documents consistency checks, and LaBB-CAT provides practical workflows for missing pronunciations and correcting alignments. The Validator also lists unimplemented checks, including valid-label enforcement; do not equate it with a complete linguistic quality system. [S22, S28, S31]

Build a small explainable validation report with stable rule IDs, severity, exact revision, affected evidence and resolution history. Foundation errors cover IDs, schema, required references and impossible times. Near-term checks cover unknown pronunciation, unaligned or failed intervals, unexpectedly short/long segments, overlapping same-speaker regions and outdated derived layers. Linguistic plausibility is a warning requiring judgment, not an automatic correction. Thresholds belong to the project and language context; they are not universal norms.

Gate: deliberately bad fixtures trigger the intended rule, legitimate overlap and code-switching remain representable, and a reviewer can navigate from issue to audio. Structural errors block commit when unsafe; unresolved research judgments block the relevant approval or export scope. Persist explanations without changing source evidence to make a check pass.

### Praat EMU and acoustic analysis

Verified capability: LaBB-CAT exchanges utterance audio and TextGrids with Praat, imports boundary corrections, uses EMU-webApp for phone editing, and can run Praat measurements over search-result intervals. These are integrations with external tools, not evidence that LaBB-CAT supplies all of EMU-SDMS or that a Rust workbench gains them automatically. [S31-S33]

Keep these later than authoring and exact-revision export. First offer a bounded audio/TextGrid package with stable ID mapping and its base revision. An external return becomes a previewed edit command; reject a stale base, added/deleted words outside the supported contract, invalid time maps and unrelated-layer changes. Integrating an editor must preserve the workbench's history and save semantics. Browser extensions and native helpers need a separate compatibility and permission check.

Acoustic jobs produce derived measurements with units, sampling positions, script/tool versions, parameters and error fields. Review interval quality first and benchmark reproducibility; a precise number from the wrong interval is not valid evidence. Heavy jobs stay off the 4 GB Pi until measured. Gate: a boundary round-trip preserves IDs and unrelated layers; a stale return is rejected; repeated measurements on pinned inputs agree within documented tool tolerance.

### Automation APIs and portable exports

Verified capability: LaBB-CAT publishes client APIs for layer generation, annotator discovery, search, task status/cancellation and serializer-based exports. Its managed-layer approach is a useful extension pattern, but does not prove the durable leases, fencing and revision guarantees required here. [S34, S35]

Keep the Rust service authoritative. Each approved adapter declares input layers, output layers, configuration schema, tool/version, capabilities, resource budget and any external-data destination. Use the existing job/attempt ledger for generation, alignment, search materialization and export. Results are immutable candidates bound to exact inputs; only validated commands can adopt them. Built-in safe transforms come before a general plugin marketplace. Arbitrary uploaded scripts remain disabled.

Support only verified formats per adapter: TEITOK remains the lossless reconstruction package; CSV/JSON result sets and later TextGrid/EMU exchange serve narrower analysis needs. Every export declares selected layers, snapshot and omitted or unrepresentable features. Gate: export/reimport tests preserve the supported identities and timing; a timeout/retry produces no duplicate accepted result; cancellation or a late stale attempt cannot overwrite a newer revision.

## 4 Architecture and ownership

### One evidence authority

research-intelligence owns source registration, immutable artifacts, transcript and annotation revisions, rights context and evidence lineage. The workbench is an authoring component of that domain, with a single supported commit path. Its transactional database is an implementation of that ownership, not a new independent evidence ledger.

semantic-compiler owns mappings, ontology versions, extraction recipes and execution into Semantica. It receives references and immutable snapshots; it does not become a second transcript editor. CompanyOS owns project-level decisions and approval to change the system's direction. Routine token edits and reviewer actions stay in evidence history, with CompanyOS linking to them only when a decision needs that context.

The graph, search index, waveform peaks and UI caches are derived. Each has an input revision and build version, and each can be deleted and rebuilt without losing evidence. Repository placement and license boundaries must be decided before code is copied: a GPL-derived component can have a clearly packaged release boundary, but a folder or process split does not by itself settle the licensing of a combined product.

### Proposed components

1. Rust domain library: stable IDs, hierarchical layer schemas, typed anchors, metadata resolution, validation, edit commands, revision rules, package compatibility and reference repair. Keep core decisions independent of HTTP and storage APIs
2. Rust native service: authenticated commands and queries, SQLite transactions, immutable artifact staging, job claims, media authorization and export orchestration
3. TypeScript interface: audio workspace, token and span selection, annotation definitions, revision comparison, issues and review. Treat server validation as authoritative
4. TEITOK adapter: package inventory, lossless syntax mapping, sidecar/settings conversion and verified export. Existing CWB and converters remain isolated adapters when needed
5. ASR adapter: accepts existing Omnilingual outputs and provenance. Later job dispatch is optional and uses the same job ledger
6. Semantica contract adapter: approved snapshot, mapping version, lineage references, result manifest and stale/retraction handling
7. Optional analysis adapters: versioned lexicon import, alignment candidates, acoustic measurements and editor exchange. They use the same command path and job ledger, never an independent writable corpus

Use versioned JSON API contracts with generated or checked TypeScript types. Mutating requests carry command ID, actor, project, exact base revision, schema version and intended operation. Responses include the committed revision and validation result. Long import, export and index jobs return a durable job ID rather than holding the request open. Do not permit arbitrary SQL, shell commands or project-supplied executable configuration through these endpoints.

LaBB-CAT-inspired temporal graphs are the structured corpus model inside this authority. They are distinct from the downstream Semantica knowledge graph: a phone boundary and its parent word are evidence records, while an extracted entity or claim is a derived interpretation. Store the former in versioned Rust/SQLite records and immutable bundles, not in a second authoring graph service. Retain the TEITOK syntax mapping alongside the domain projection so hierarchy validation cannot flatten preserved XML.

### Persistence decision

Choose SQLite for the single-service local pilot. A server process owns writes; browsers never open the database file. Use local disk, explicit transactional boundaries, foreign keys, write-ahead logging where appropriate and the supported backup API. For acknowledged-save durability, use FULL synchronization and verify behavior under power-loss simulation; do not copy a live database file without its transactional state. Keep WAL databases off network filesystems. Filesystem and SQL changes are not one transaction: stage and verify immutable blobs first, flush and fsync each completed file, atomically publish its final immutable path and fsync the containing directory, then commit their references and the new head in SQL. Unreferenced staged blobs can be garbage-collected after a safety interval. A committed database row must never refer to an unverified temporary file. [S14]

Persist revision snapshots plus a small, explicit command journal. Avoid making every future read depend on replaying years of application events through current code. Projections can be rebuilt from stored snapshots; command records explain intent and make history readable. A later Postgres move is justified by measured multi-service writes or operational needs, not by the word production. It must replace the authoritative store through a tested one-way cutover.

## 5 Evidence layers and record model

Keep these layers distinct in storage, permissions, the interface and exports:

- Source artifact: the captured media or document, original bytes, checksum and collection context
- Machine draft: an immutable ASR or converter result, exact run metadata and links to its source
- Human-corrected transcript: the research transcription, with timing and source-based uncertainty
- Normalized or translated layer: optional standardized form, translation, gloss or alternate reading, linked to the authentic form
- Linguistic annotation: language assignment, entities, POS, morphology, spans, relations and notes under versioned definitions
- Review: a decision, actor, scope, exact revision, time and rationale or unresolved issues
- Analysis: Semantica extraction and graph generation, fully linked to approved evidence and processing versions

### Minimum durable records

| Record | Identity and essential contents |
| --- | --- |
| Project and source | Existing domain IDs, source URL/context, access and rights policy |
| Artifact | Immutable ID, checksum, byte size, media type, storage reference, parents |
| Document revision | Document ID, revision ID, parent, snapshot hash, actor, command, schema |
| Evidence bundle and corpus snapshot | Exact transcript/annotation revisions, configuration and definition hashes, media references; ordered bundle set for export |
| Token and segment | Stable internal ID, original external ID, order, layer and media anchor |
| Annotation definition and layer schema | Version, parent layer, value schema, alignment and overlap/containment/coverage rules |
| Metadata binding | Explicit/effective value, source scope, resolution rule and configuration version |
| Lexicon and pronunciation | Versioned entry, language/variety, symbol inventory, alternatives, source/license and token overrides |
| Alignment and measurement | Input bundle, time base, engine/model/script settings, manual protection, units and review status |
| Annotation and relation | Stable ID, layer, definition version, anchors, status and provenance |
| Review decision | Exact revision, reviewer, scope, decision, timestamp and reasons |
| Job and attempt | Job ID, immutable inputs, stage, state, lease, fence, attempt and outputs |
| Export and ingestion | Snapshot hash, contract version, mapping version, result or graph generation |

Internal IDs should be opaque and stable; do not derive them from token text or current token position. Preserve TEITOK external IDs exactly and map them within a document namespace. Record ordering separately, so inserting a token does not renumber its neighbors. Checksums identify bytes and verify integrity; they do not by themselves prove who authored a record.

Do not confuse XML byte offsets, Unicode code-point offsets, browser UTF-16 positions and audio sample coordinates. Every anchor declares its coordinate system, layer and revision. Quote/context checks can diagnose a broken anchor, but similar text must never silently receive a lost annotation. [S18]

Keep orthographic tokens, syntactic words and morpheme analyses distinct. Support subtoken spans and intra-token language judgments without forcing retokenization; this matters for agglutinative language and mixed forms. Cross-document relations require a document-qualified endpoint, and mention identity must remain distinct from an inferred entity. [S19]

Store media times in an explicit integer time base, preferably source samples when reliable and microseconds otherwise. Preserve imported numeric text where round-trip compatibility requires it. Specify interval convention, media duration, channel and source offset. Do not fake token-level alignment from utterance timestamps. Missing alignment remains missing, and a transcoded playback proxy points back to the original with an explicit time mapping.

## 6 Revisions undo and concurrent edits

### A linear history for the first release

Use one committed head per document. Every successful content-changing command creates an immutable revision with its parent and grouped changes. The head moves only through an atomic comparison against the caller's base revision. A second tab or user editing an older base receives a conflict with both versions retained; the server does not silently overwrite or last-write-win the newer work.

Single-user editing still requires this rule because multiple tabs, retries and intermittent connectivity can produce concurrent writes. Require an idempotency key on commands, scoped to project and authenticated actor and bound to a canonical request hash. Reuse with a different payload is an error; the actor is derived from authentication, not trusted from the request body. If the client times out after a successful commit, retrying the same command returns the original result rather than creating another revision. Keep permission and validation checks inside the commit boundary. Also verify the expected source/preimage hash: an application lock cannot protect against an external TEITOK process or file editor that ignores it. Any detected outside edit enters an explicit reconciliation flow. Group autosaves into meaningful commands rather than creating a full-corpus rewrite for each keystroke.

### Pin the complete review context

A document evidence bundle is an immutable manifest pinning the transcript revision, annotation revisions, relevant definition versions and hashes, settings and media references. Approval attaches to that bundle hash and its review scope. A corpus snapshot pins an ordered set of document bundles and the corpus configuration in a consistent database read; exports and ingestion refer to its hash. Shared settings are never fetched as whichever version happens to be current during export.

Commands check the relevant configuration precondition as well as the document head. A shared-definition change creates a new configuration version and marks affected document bundles as requiring validation and review; unrelated documents need not lose approval. Historical bundles remain interpretable through their original bindings.

### Three different recovery actions

Local undo reverses an uncommitted edit in the browser. Committed undo creates a new inverse revision after checking that the affected objects still match the expected state. Restore creates a new head whose content reproduces a chosen prior snapshot; it does not delete the intervening record. Redo is a new command and must pass current validation and base checks.

The interface should say exactly which of these actions it is performing. Show who changed what, before and after values, revision time and a short command label. Allow revision labels and notes; automatic timestamps alone do not make history understandable. A bulk operation is one transaction and one logical history group, with a readable list of affected tokens or annotations.

### Conflict handling and approval

For the pilot, present a side-by-side conflict view and let the editor reapply an intended change against the latest revision. No automatic merge of timing, token structure, overlapping spans or conflicting linguistic judgments. Independent field merges can be considered later only with explicit commutativity rules and tests. CRDTs and Git-style branches add substantial domain-specific repair work; neither is required for a useful first release.

Approval is a separate immutable decision referencing an exact snapshot. A later edit creates an unreviewed revision and makes downstream currentness visible immediately. Undoing an edit does not restore approval automatically, even if the text happens to match; a policy may explicitly recognize an identical approved snapshot after verifying all relevant layers and hashes.

Crash tests must interrupt blob staging, database commit, response delivery and projection refresh separately. Success means each acknowledged revision remains recoverable, unacknowledged work is either safely absent or discoverable by command ID, and no partially committed document becomes the head.

## 7 Stable identities and structural change

### Safe edits before retokenization

Text correction that preserves a token's identity is allowed first. Each command identifies the token by ID, not by array index or displayed spelling. Annotation anchors resolve to those IDs and the revision that gives them meaning. Keep the original form and source byte range so the compatibility adapter can explain and validate its patch. Even an identity-preserving correction can invalidate character/subtoken spans, morpheme analyses, normalized readings and other content-dependent annotations. Inspect those dependencies on every text edit; remap only unambiguously, otherwise mark the current annotation unresolved while keeping its historical interpretation intact.

Retokenization changes the objects that other research records refer to. Therefore it is a dedicated operation with a preview, a reference-impact report and a proposed mapping from old IDs to new IDs. A token split creates new IDs, a merge creates a new ID, and retired IDs remain tombstones with lineage. Never recycle a retired ID or silently redirect an ambiguous relation endpoint.

### Reference repair contract

Before a split, merge, reorder or deletion commits, enumerate every reference: inline links, annotation spans, relations, utterance boundaries, timing anchors, dictionaries where applicable, reviews, exported snapshots and graph evidence links. Apply a documented rule per reference type. A whole-token span may expand across all split successors; a linguistic relation with unclear intended target must become unresolved for review.

Discontinuous spans, overlaps and nested structures require explicit support. A display range alone is insufficient to represent them. Preserve a stable annotation ID with an ordered set of anchor segments. If legacy syntax cannot represent a new construct, block that compatibility export or supply a clearly labeled extension package; never silently downgrade it.

All repairs happen in one revision with a machine-readable mapping and an editor-readable preview. Dangling required pointers are always invalid. Drafts may contain explicit needs-adjudication records whose historical anchors still resolve, but unresolved current judgments block approval and default Semantica export. Reference repair never rewrites an immutable historical revision. After commit, search and graph outputs tied to the previous revision are stale. Historical exports remain immutable evidence of their original input.

### Schema and definition evolution

Version the persisted schema, API, project definitions, package manifest and compiler contract separately. Renaming a language label is different from redefining its meaning. Preserve prior definition versions so old annotations can still be interpreted. A migration must have a dry run, explicit loss report, deterministic output and a complete pre-migration backup.

Use expand-and-contract database changes where practical. Prefer restoring a pre-migration snapshot into the older binary over assuming every destructive database migration has a safe reverse operation. Old application versions must reject unsupported new schema versions rather than opening them optimistically. Test both full-version upgrade and a failed midway upgrade before releasing structural changes.

## 8 Complete TEITOK import and export

### Package boundary

A raw XML download is not a full project backup. Inventory all XML documents, Resources/settings.xml, annotation definition and sidecar files, audio/video and facsimiles, dictionaries and mappings, conversion configuration and any project-specific assets needed to interpret the corpus. Enumerate external references and mark missing or intentionally excluded objects. Exclude credentials and user account secrets. Preserve required approved project scripts or executable extensions only as inert quarantined artifacts with hashes and execution disabled; put them in an explicitly identified compatibility-dependency bundle. If a required asset cannot be included, mark the export incomplete for reconstruction. Importing data never grants permission to run that code. [S3-S6]

Create a versioned manifest containing relative paths, object role, byte length, media type, SHA-256, source package version, importer version, external-ID map, definition versions and portability status. A complete portable package includes the authorized media bytes. A restricted package can contain references only, but must be labeled incomplete for offline restoration and must explain the access dependency.

### Import sequence

1. Copy into quarantine without changing the original. Enforce archive path, size, entry-count and decompression limits; reject path traversal, unsafe symlinks and duplicate/conflicting paths
2. Hash every object and validate the manifest. Record unsupported extensions and missing dependencies before creating any live document
3. Parse XML safely with external entity and network resolution disabled. Preserve comments, processing instructions, namespace prefixes, mixed content, whitespace, entity spelling and attribute ordering where unchanged
4. Build a lossless syntax representation plus a typed domain projection. A conventional DOM alone is insufficient for byte-preserving export
5. Resolve IDs, spans, relations, media anchors, header XPath mappings and project definitions. Block collisions and dangling mandatory references
6. Run no-op round-trip tests and render the imported document for human inspection. Only promote the package to editable status after its supported-feature report passes

Unknown XML and configuration are preserved as opaque source material and shown in the compatibility report. Imported scripts and plugins are never executed automatically. Unsupported behavior remains unavailable until its adapter and security review exist; unsupported data must not disappear.

### Export and proof

Export one exact committed snapshot, not a moving head. Reuse untouched original bytes and apply minimal validated edits to affected regions. When an edit requires broader reserialization, make the impact explicit and prove the preservation contract before allowing compatibility export. Include definitions and sidecars from the same revision boundary; mismatching a current schema with old annotations is a failed export.

CWB indexes are derived and may contain source byte offsets. Identify each index with an input fingerprint covering ordered document revisions, relevant definitions/settings and attribute mappings, and encoder/build version. Mark it stale when any of those inputs changes, and rebuild from the exported snapshot before relying on query results. Query results declare their fingerprint; bulk edits cannot target stale query coordinates. Never ship an old index as though it belongs to new XML. Keep CWB/CQP behind an adapter until a substitute passes the corpus query contract. [S7]

Acceptance requires three independent checks: byte identity for all untouched objects; structural and referential equality for edited documents outside their intended edits; and a successful reopen in a clean TEITOK project copy with media, annotations and representative queries verified. This is bidirectional compatibility for supported content, not merely successful XML parsing.

## 9 Omnilingual and Semantica contracts

### Bounded ASR integration

Import the existing Omnilingual JSON, text or aligned output through one documented adapter. Preserve the raw result alongside the mapped working draft. A repeated import of the same source, run and output hash should be idempotent. A different run becomes another draft candidate, not an overwrite of human work. Timing or speaker information that the ASR did not produce cannot be manufactured as certainty.

If later dispatching ASR from the workbench, keep the authorized ASR worker as the explicitly capable GPU worker, with the existing CPU fallback policy recorded. Jobs contain IDs and immutable input references. The worker obtains authorized data at claim time, produces attempt-specific artifacts and submits a fenced result. No public GPU endpoint, new provider upload or model-training use is implied by draft import.

### Exact revision export to semantic compiler

The handoff manifest includes project/source IDs, approved document revision, snapshot and artifact hashes, annotation-definition versions, media anchors, rights/access policy, compiler contract version and the requested mapping or extraction recipe. Output assertions must link to the exact evidence IDs and relevant spans or intervals, with extraction/run version and confidence where the method provides it.

Keep a unique ingestion key over the complete input snapshot and evidence-bundle hashes, mapping/ontology version and immutable effective recipe configuration, including compiler/adapter version and model/checkpoint where applicable. A mutable recipe name is insufficient. Retrying an ingestion must not multiply claims. Validate the contract before dispatch and validate the returned manifest before accepting completion. A pipeline failure changes job status, not the approved evidence snapshot.

### Changes and retractions

When revision R2 supersedes approved R1, mark R1-derived results stale for the current view. After R2 is reviewed and compiled, build a new graph generation, validate counts and lineage, then atomically switch the current-generation pointer. Preserve R1's generation when retention permits so past analyses remain reproducible.

Do not remove a shared claim merely because one source was withdrawn: retract that evidence edge or assertion provenance, then recompute support. Conversely, a rights withdrawal may require removing restricted source material and derived content from active stores and backups under an approved retention process. Keep a minimal non-content tombstone where permitted, so withdrawn material is not reimported accidentally.

Default queries must filter by current valid generation and eligibility. A stale status badge alone is insufficient if stale claims still feed unqualified answers. The acceptance test follows one corrected token from original audio through a reviewed revision to a graph assertion, then demonstrates that a superseded assertion no longer appears in the current result set.

## 10 Deployment without competing authorities

### Stage A local native pilot

Run one Rust service and the TypeScript interface beside a disposable copy of the pilot corpus on an explicitly approved machine. Keep the original TEITOK service as the fallback. Bind locally by default. Use SQLite and immutable local files; no D1, R2 or cloud queues are needed to establish editing correctness.

This is the recommended first engineering topology, not an instruction to change the authorized ASR worker now. It avoids solving distributed commits, credentials and free-tier enforcement before the core evidence invariants are proven. Capture service startup, memory, save latency and export timings on the actual target.

### Stage B choose the operating model

| Model | Authority and behavior | Decision condition |
| --- | --- | --- |
| Native primary | Rust with SQLite or later Postgres; optional static edge UI and private ingress | Prefer for local control and native compatibility; remote editing depends on host availability |
| Cloud primary | Worker API and D1 own revisions/jobs; private R2 stores immutable artifacts; native Rust performs bounded jobs | Prefer only if review must remain available while home machines are offline |
| Wasm authoring core | Pure Rust validation/command subset compiled for Workers with D1/R2 adapters | Accept only after free-tier CPU, memory and semantic parity tests pass |

The cloud-primary option cannot merely accept opaque native worker edits into D1 after the fact. The authority must validate permissions, base revision and command preconditions at commit time. Either the shared validation core runs within measured Worker limits, or commands wait for the native service and the interface honestly reflects that dependency. An edge API that trusts stale worker output would undermine the revision model.

For cloud primary, immutable blobs are staged to private R2 and verified before a D1 conditional commit references them. The database owns jobs, attempts and the outbox. Queues is a delivery signal; it does not own the job history. For native primary, the native database owns those same records and Queues is optional. Never mirror two mutable job or review ledgers bidirectionally.

### The two CM5 machines

The proposed hardware target is ARM64 CM5 with 4 GB RAM, Ubuntu 24.04 and NVMe storage. Private host names, system inventory and network details are omitted. Native target validation and deployment approval remain separate gates.

Retain the tentative split: first Pi for Semantica/FalkorDB if measured fit permits, second for a lightweight native service or worker/staging. Benchmark RSS, peak ingestion memory, disk use, thermal behavior and simultaneous playback/editing under realistic load before assigning services. A 4 GB graph process competing with database and import work may force a smaller graph, serialized jobs or a different placement. Do not call the shared carrier and power supply high availability.

### Free cloud budget and worker failures

Current documented Free limits make the deployment decision concrete: Workers has 100,000 requests per day, 10 ms CPU per request and 128 MB per isolate; D1 has 500 MB per database and 5 GB per account, with 5 million rows read and 100,000 written per day; Queues includes 10,000 operations per day and 24-hour retention. R2 Standard includes 10 GB-month storage, one million Class A and ten million Class B operations per month. D1 index maintenance consumes writes, so full-corpus autosave rewrites are a poor design. These figures must be rechecked before provisioning. [S9, S10, S12, S13, S15]

Cloudflare Containers currently require Workers Paid, so they are not a free native-Rust hosting alternative. A Wasm port must also isolate native filesystem, subprocess and thread assumptions from the portable core. [S16, S17]

Free-only is a hard operating constraint, not an assumption that every Cloudflare service automatically stops before charges. Review account billing behavior and quotas before provisioning; set application-level admission caps and alerts, and stop new cloud work safely when remaining capacity is uncertain. Do not enable paid services or add payment commitments without approval. [S9-S13]

Cloudflare Queues Free retains messages for 24 hours and delivers at least once. Persist every unfinished job, lease, attempt, cancellation and output in the chosen authority. Publish through an outbox, use idempotency keys and monotonically increasing attempt fences, and redispatch unfinished jobs after delivery expiry. A stale attempt may finish computation but cannot replace the accepted result of a newer attempt. A dead-letter queue is not a permanent failure archive. [S10, S11]

Workers poll only their supported capability lane with backoff and free slots. An unavailable ASR worker means waiting for that worker, not silently moving ASR to a Pi. Media URLs are short-lived and issued at claim time. No credentials belong in queue messages. Existing remote access, credentials, private uploads and network changes each require their applicable approval before deployment.

## 11 Security licensing and release engineering

### Protect corpus data and the edit boundary

Use project-scoped authorization for every command, artifact and media request. Separate reader, editor, reviewer and administrator capabilities even if the pilot initially has one person. Authentication at an ingress does not replace object-level checks. Keep media private, use short-lived access, and exclude tokens, source transcripts and sensitive creator data from routine logs.

Treat XML, archives, annotation values and filenames as hostile input. Disable external entities; bound nesting, text sizes and decompression; prevent path traversal; sanitize rendered markup; enforce Content Security Policy and protect cookie-authenticated mutations against CSRF. Isolate external converters with resource limits and narrow filesystem access. Do not trust an imported project script merely because it arrived with a corpus.

Backups require encryption and a documented key-recovery route. Immutability means revisions are not edited in place; it does not mean retaining restricted material forever. Do not store the only key beside the only backup. Rights restrictions and deletion rules apply to exports, staging directories, logs, graph generations and backups as well as the main interface. Cross-border hosting and processing must be decided explicitly; a nearby Cloudflare edge does not establish storage residency. [S12, S13]

### TEITOK and LaBB CAT licensing boundaries

The inspected TEITOK license notice states GPL version 3 or later; this assessment does not treat it as AGPL. A Rust port based on this code should be planned as GPL-covered derivative work, with retained attribution, copyright and license notices and clear descriptions of changes. A different language does not remove those obligations. [S2]

Before distribution, assemble corresponding source for covered code, build and installation instructions, modifications and the required license materials. Browser-delivered covered JavaScript must be considered in that release review; keeping the backend private does not make shipped frontend code disappear from the distribution analysis. For the GPL-covered TEITOK work, ordinary private server use is different from distributing binaries or frontend code. That statement must not be generalized to modified AGPL network software.

Inventory dependencies and assets separately: CWB, Smarty, converter tools, fonts, media libraries, copied JavaScript, models and container base images may have distinct licenses. Preserve original license files and generate an SBOM. Keep research data, creator media and model rights separate from software licensing. Use distinct branding and a factual TEITOK compatibility/attribution statement. Do not present a clean-room escape route after source inspection or promise legal certainty.

LaBB-CAT server commit 6099a295d54d7fada3ae348847a293deb5f8592f contains the AGPLv3 license; inspected source headers specify version 3 or later. Prefer that repository evidence over the older overview page's generic GPL description. Copying or translating covered implementation into Rust remains a derivative-work question. Under AGPLv3 section 13, a modified network-interactive version must offer its corresponding source to remote users. GPLv3 and AGPLv3 have specific combination provisions, including network-source requirements; this is not permission to relabel copied LaBB-CAT code as GPL-only. [S20, S36]

The default adoption route here is capability-level design and documented interoperability implemented in our own Rust components, not copied LaBB-CAT code. Record which specification, source file or library informed each component. Treat any direct reuse, translated algorithm, bundled library or modified service as a separate review item. The annotation-graph library, individual annotators, EMU, Praat, dictionaries and model assets each need their own license check; the server license alone does not settle them. A process, HTTP service, plugin or repository boundary is not an automatic exemption from combined-work obligations. Obtain qualified legal advice for a consequential distribution or hosted-service boundary; this plan makes no legal guarantee.

Before enabling a reused AGPL component, document the covered boundary, notices, corresponding-source contents and delivery method, build instructions and source-offer placement, and verify these against the actual release. Keep documentation and UI assets separately inventoried: the LaBB-CAT documentation declares CC BY-SA 4.0. The plan uses source-linked capability summaries rather than reproducing its tutorial text or screenshots.

### Recovery objectives

The pilot must lose no acknowledged revision after a service crash or machine restart under the tested durability configuration. Whole-disk loss is a separate risk: propose an independent backup at each completed editing session, with a visible last-verified-backup time and a warning before switching workstations. Agree a maximum acceptable off-device data-loss window and restore-time target before production; measure a clean restore rather than claiming an untested service level. A second CM5 on the same carrier is not the only independent backup. Rehearse restoring both metadata and immutable objects, then verify checksums, approvals and a rebuilt graph.

### Reproducible delivery

Pin Rust and Node toolchains, lockfiles, native dependencies and container bases. CI should build and test Linux x86-64 and ARM64 artifacts, with native smoke tests on the actual target class before release. Cross-compilation success alone does not establish runtime, codec or filesystem compatibility.

Required CI stages are formatting/static checks, unit/property tests, malicious-input tests, compatibility fixtures, migration tests, API contract tests, browser editing flows, license and vulnerability inventory, and restore/rebuild tests. Publish build provenance and checksums with the approved release. Quarantine a failing fixture rather than changing expected results to make a build green. Resolve dependency findings by actual exposure and document any accepted exception.

## 12 Phases and exit criteria

No delivery date is promised before the compatibility inventory and technical spikes reveal the actual scope. Each phase produces a testable artifact and a go/no-go decision. Stop migration, not research work, if a gate fails; the retained TEITOK copy remains available.

### Phase 0 freeze the contract

Inventory the complete pilot project and the real advanced features in use. Record baseline exports, object hashes, token/annotation counts, source commit, CWB queries, editing task timings and screenshots. Decide the permitted pilot machine and protected package copy. Produce the capability contract, data-rights classification and distribution boundary. Select which near-term LaBB-CAT-inspired research tasks actually matter; record separately whether each will be an original implementation, a data-format adapter or licensed code reuse.

Exit: the original is recoverable, every dependency is accounted for, required features have a named test, and implementation scope is approved. No editing migration starts from a raw XML file alone.

### Phase 1 prove the hard invariants

Build small spikes for lossless XML patching, package round-trip, stable ID projection and transactional revision commits. Add synthetic hostile/edge-case fixtures alongside the authorized pilot. Demonstrate no-op byte identity, an isolated token edit, temporal/layer constraint validation, explicit-versus-inherited metadata, concurrent write rejection and crash-safe commit. Establish whether the selected Rust XML approach actually preserves lexical material; switch the adapter strategy if it does not.

Exit: zero silent data loss, zero orphan references, original bytes preserved, and a clean restore. If byte-safe edits to required constructs are infeasible at reasonable complexity, retain those operations in TEITOK and reconsider the migration scope before building a polished interface.

### Phase 2 complete the first authoring slice

Deliver audio playback, token correction, one configurable annotation layer, spans and relations, review, history comparison, committed undo/restore and full package export. Reopen the edited export in TEITOK. Run the real research task with the user and observe whether the functional interface is clearer than the token-popup workflow.

Exit: the entire first-slice journey passes on the pilot, acknowledged edits survive restart, and the user can explain and navigate the history without developer assistance. The new workbench remains on a copy.

### Phase 3 close advanced parity gaps

Add the used linguistic fields, search/CWB adapter, bulk-edit preview, definitions management, difficult media anchors and required project extensions. Prioritize bounded multilayer search with audio context, custom-language routing, project lexicons, imported-alignment review and explainable quality queues (B27-B31). Add guarded structural edits and reference repair only after their tests pass. Expand the fixture set with more authorized creators, language combinations and document shapes.

Optional automatic alignment and Praat/EMU integrations (B33-B34) need separate resource, language/model, permission and license gates. They can follow the Semantica connection and must not delay its exact-revision contract.

Exit: every required capability is either proven in the new workbench or has an explicit, acceptable legacy path. Unsupported required work is a blocker to replacing TEITOK, even if the common editing path looks complete.

### Phase 4 connect reviewed evidence

Implement the exact-revision semantic-compiler contract, idempotent ingestion, lineage verification, stale-result exclusion and retraction/rebuild flow. Use a private test graph generation. Keep a reproducible export that can rebuild it from a clean store.

Exit: a correction visibly propagates through review to a new graph generation, old claims leave the current view, and historical results retain their correct evidence provenance.

### Phase 5 choose deployment and rehearse cutover

Measure target machines and compare native-primary against the cloud-primary/Wasm option using the agreed availability, privacy and free-only constraints. Test offline worker behavior, capacity rejection, backup restoration and version rollback. Obtain approval for credentials, network configuration, private uploads or spending before those steps.

Exit: one authority is documented, recovery works on a clean environment, permissions are tested, and the user approves the operating model. Freeze writes in the old tool for the final migration, verify imported heads, and then enable writes only in the new authority. Keep the old system read-only for rollback inspection; do not dual-edit both copies.

## 13 Ordered implementation backlog

Backlog order expresses dependencies, not a delivery calendar. Each item should become a small reviewable change with fixtures and a human-readable result. Repository locations are to be agreed before any code is created.

| ID | Concrete outcome | Depends on |
| --- | --- | --- |
| B01 | Full pilot package inventory, rights classification and baseline hashes | Implementation approval |
| B02 | Required capability list and baseline research tasks | B01 |
| B03 | TEITOK GPL and LaBB-CAT AGPL reuse and release boundary record | B01 |
| B04 | Manifest schema and immutable artifact store prototype | B01 |
| B05 | Safe XML parser plus lossless no-op and minimal-edit proof | B04 |
| B06 | Stable external/internal ID map and reference validator | B05 |
| B07 | Snapshot, layer hierarchy, temporal constraints and metadata binding versions | B02, B06 |
| B08 | SQLite commit, head precondition and idempotency protocol | B04, B07 |
| B09 | Crash injection, database backup and clean restore harness | B08 |
| B10 | Versioned API and checked TypeScript contract | B07, B08 |
| B11 | Media playback, time-base mapping and persistent inspector | B06, B10 |
| B12 | Token correction and explicit save-state interface | B09-B11 |
| B13 | Definition editor, language values, spans and relations | B06, B10, B12 |
| B14 | Revision comparison, grouped undo, redo and restore | B08, B12, B13 |
| B15 | Exact-revision review and explainable structural/language issue checks | B13, B14 |
| B16 | Complete package export and TEITOK reopen test | B05, B13-B15 |
| B17 | Real pilot usability and performance evidence | B11-B16 |
| B18 | CWB query adapter and index invalidation | B16 |
| B19 | Required advanced fields, converters and bulk edits | B02, B16-B18 |
| B20 | Retokenization impact preview and reference repair | B06, B14, B19 |
| B21 | Approved snapshot contract and Semantica lineage | B15, B16 |
| B22 | Idempotent ingestion and current/stale/retraction tests | B21 |
| B23 | ARM64/x86 builds, dependency SBOM and security gate | B03; continuous thereafter |
| B24 | Measured native versus cloud authority decision | B17, B22, B23 |
| B25 | Worker leases/outbox, offline recovery and quota tests | B24 if distributed |
| B26 | Backup restoration, cutover rehearsal and release approval | B09, B20-B25; selected additions below |

### Selective LaBB CAT adoption backlog

These additions are ordered by their own dependencies. B27-B31 are near-term candidates after B17, selected against real research tasks. B33-B34 are later and optional; B32 starts with the export/API contracts needed by a selected adapter rather than a general extension platform.

| ID | Concrete outcome | Depends on |
| --- | --- | --- |
| B27 | Versioned language defaults, explicit overrides and processor routing | B13, B15, B17 |
| B28 | Bounded multilayer search, exact hit IDs and contextual audio/export | B17, B18, B27 |
| B29 | Project lexicons, pronunciation alternatives and unknown-word queue | B17, B27; B03 per resource |
| B30 | Imported word/phone timing review with manual protection and provenance | B07, B11, B14, B17 |
| B31 | Alignment/lexicon quality rules and navigable review queue | B15, B29, B30 |
| B32 | Capability-declared adapter API and scoped CSV/JSON/TextGrid exports | B03, B10, B16; selected adapter contract |
| B33 | Optional aligner candidate jobs and per-language accuracy/resource proof | B29-B31, B32; approved worker |
| B34 | Optional Praat/EMU edit exchange and reproducible acoustic jobs | B30, B31, B32; approved tools |

Define and test the adapter boundary before implementing automatic alignment or acoustic jobs. B25 applies if any of these jobs is distributed. Cutover requires only the explicitly selected additions and their gates, not every feature in the LaBB-CAT catalog.

B18-B20 and B21-B23 can proceed in parallel after their prerequisites. Compatibility and history work precede cosmetic refinement. A capability excluded by the final inventory can be removed from the required release backlog only through an explicit scope decision, while its imported data still remains preserved.

## 14 Acceptance tests and measurable evidence

### Fixture families

Keep authorized research validation private. Public acceptance fixtures are clearly synthetic: mixed language labels, slang mechanics, apostrophes, combining characters, emoji, punctuation, ambiguous language, overlapping speech, missing timing, discontinuous spans, multiple forms and unknown XML. Synthetic mechanics cannot substitute for linguistic review.

Include a token correction that changes an existing subtoken language span: it must be repaired explicitly or marked unresolved, never silently attached to different characters. Add malformed XML, XXE attempts, deep nesting, decompression bombs, duplicate IDs, malicious filenames, stale sidecars, nonexistent relation endpoints and mismatched media checksums. Include interrupted imports, full disk, simultaneous tabs, retry-after-timeout, expired leases and schema upgrades from each supported prior version.

### Nonnegotiable gates

| Test | Passing evidence |
| --- | --- |
| No-op package round-trip | 100 percent byte equality for included untouched files |
| Intended edit isolation | Only approved values change; every unrelated structure retained |
| Identity and references | Zero duplicate stable IDs or dangling required pointers; unresolved judgments block approval |
| Retry and concurrency | One revision per command/payload; changed payload rejected; stale base cannot overwrite head |
| Crash consistency | Every acknowledged revision recoverable; no partial head |
| History | Same-day changes comparable; undo/restore retain intervening history |
| Review | Unreviewed revision cannot reuse old approval or enter default export |
| TEITOK interoperability | Clean reopen, media playback, annotations and golden queries pass |
| Semantica currentness | Bundle/configuration hashes resolve; stale claims absent from current queries |
| Security | Unauthorized project/media reads and writes fail; hostile inputs bounded |
| Restore | Metadata and objects restored; approved export and graph rebuilt |
| Budget and outages | No silent job loss after 24-hour queue expiry or offline workers |

### Gates for adopted LaBB CAT capabilities

| Test | Passing evidence |
| --- | --- |
| Hierarchy and temporal schema | Expected parent/peer constraints pass; cycles and required containment errors fail; no XML flattening |
| Language inheritance | Explicit phrase/token values survive default changes; historical effective values reproduce |
| Layered search | Expected stable hit IDs and audio context on a labeled fixture; stale results cannot mutate head |
| Lexicon review | Unknown/local forms preserved; token override survives regeneration; symbol sets validated |
| Alignment provenance | Exact inputs resolvable; rerun cannot overwrite manual boundary; failures/skips visible |
| Quality queue | Seeded errors found without invalidating legitimate overlaps or mixed speech; issue-to-audio navigation works |
| External editor exchange | Supported IDs/times round-trip; stale or overbroad returned edits rejected |
| Analysis reproducibility | Pinned measurement settings reproduce within documented tolerance; failures remain explicit |
| Adapter isolation | Undeclared output, data destination or capability rejected; retries/cancellation cannot corrupt revisions |
| License and resource readiness | Each enabled reuse/model/tool has recorded terms, approved boundary and measured worker fit |

Only gates for enabled capabilities are release blockers. Foundation schema and preservation checks always apply; a missing optional model must not block human corpus authoring or reviewed Semantica export.

### Performance and usability targets

Instrument import/export duration, peak RSS, index build time, save latency, audio seek behavior, graph ingestion memory, bytes per revision and database growth. On the measured pilot target, propose a warm local save p95 below 300 ms and ordinary selection/inspector interaction below 100 ms excluding media fetch. These are initial engineering targets, not measured claims or universal guarantees. Establish a real baseline before deciding whether to tighten them.

The hard usability test is task completion: the user must correct a phrase, assign mixed-language evidence, make a relation, compare two revisions and recover a mistaken edit without losing their place or needing to understand database internals. Record time, errors and points of confusion against the existing TEITOK workflow. Do not optimize only click counts; research accuracy and confidence in recovery matter more.

### Falsification and rollback

Stop cutover for any silent XML loss, unresolved required reference, evidence overwrite, false approval, stale claim leaking into current analysis, irrecoverable acknowledged save or unbounded hostile-input behavior. Stop the proposed hardware placement if normal work risks out-of-memory termination or leaves insufficient operating margin. Stop the cloud design if required commands cannot fit the free operating envelope or if billing cannot be held within the authorized constraint.

Rollback means making the new system read-only, exporting and preserving its latest valid revisions, restoring the prior known-good application and data snapshot into a separate environment, and reconciling any later accepted edits explicitly before resuming writes. Switching an executable back is insufficient after a schema migration. Never overwrite the only newer dataset to restore the old tool.

## 15 Risks and decisions before implementation

### Main risks and controls

Lossless XML compatibility is the largest technical risk: prove it before broad UI work. Reference repair is the largest structural-edit risk: quarantine ambiguous mappings and block approval. Incomplete advanced-feature inventory is the largest scope risk: compare actual research tasks, not a generic feature list. Confusing authenticity with normalization is a research risk: enforce separate layers in both storage and UI.

Model and dictionary gaps are an additional scope risk: support for a custom language label does not prove useful automatic alignment or acoustic interpretation. Treat overlap, slang and mixed-language material as benchmark cases, not exceptions to hide. LaBB-CAT feature inspiration must not become a full platform rewrite before the first lossless authoring slice.

Hardware capacity and cloud quotas are deployment risks, not reasons to weaken data guarantees. Measure before placement and use admission control. Dependency and license boundaries are release risks: inventory early and review before distribution. An attractive editor without reliable provenance, restore and parity would not meet the user's purpose.

### Three decisions that unlock useful work

1. Approve a protected-copy local pilot on a named machine. The proposed default is the environment already used for the TEITOK trial, with the original corpus unchanged and no public exposure
2. Accept the TEITOK GPL-compatible derivative direction and agree the release boundary before copying code. Decide separately whether any LaBB-CAT implementation is to be reused with its AGPL obligations; capability adoption does not require that choice. A legal review is appropriate before distribution if the broader product boundary is consequential
3. Choose the later availability priority after the pilot: native-primary simplicity and local control, or cloud-primary review availability while home machines are offline. This does not need to delay the local correctness work

The first inventory should resolve feature-specific unknowns from the actual project rather than asking the user a long speculative questionnaire. Decisions about collaborator roles, corpus sharing, storage location, retention and training use belong before the corresponding feature is enabled. This planning document does not itself authorize deployment, paid infrastructure, Pi setup or private-data upload. Implementation and public source publication were separately authorized on 2026-10-04; corpus content remains private.

## 16 Sources and evidence basis

Pinned source references describe the inspected TEITOK and LaBB-CAT server versions. LaBB-CAT documentation and API pages were checked for this revision on 4 October 2026; their examples can describe older tool versions and are capability evidence, not ready-to-run installation instructions. Official service documentation supports deployment constraints but can change; recheck relevant limits at deployment approval. Trial and machine details are the existing project context, not newly reproduced measurements.

- S1. TEITOK repository and installation/dependency description at the inspected commit. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/README.md
- S2. TEITOK license text and project notice, especially lines 634-640. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/LICENSE#L634-640
- S3. Token save path and token identity handling. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/common/Sources/toksave.php
- S4. Shared XML save helper and daily backups, lines 502-550. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/common/Sources/functions.php#L502-550
- S5. Annotation definitions and sidecar save paths. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/common/Sources/annotation.php
- S6. Waveform editing and post-tokenization warning, lines 157-161. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/common/Sources/wavesurfer.php#L157-161
- S7. CWB encoder and byte-position range generation, lines 216-225 and later structural index code. https://gitlab.com/maartenes/TEITOK/-/blob/57d864b57fa3ed9f0a660a7781533ce7fa09ae2b/src/tt-cwb-encode.cpp#L216-225
- S8. Cloudflare Rust Workers and WebAssembly. https://developers.cloudflare.com/workers/languages/rust/
- S9. Workers CPU, memory, request and script limits. https://developers.cloudflare.com/workers/platform/limits/
- S10. Queues plan allowances and retention. https://developers.cloudflare.com/queues/platform/pricing/
- S11. Queues at-least-once delivery guarantee. https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- S12. D1 limits and data location. https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/configuration/data-location/
- S13. R2 pricing and data location. https://developers.cloudflare.com/r2/pricing/ and https://developers.cloudflare.com/r2/reference/data-location/
- S14. SQLite write-ahead logging and online backup API. https://sqlite.org/wal.html and https://sqlite.org/backup.html


- S15. D1 daily rows and index-write accounting. https://developers.cloudflare.com/d1/platform/pricing/
- S16. Cloudflare Containers requires Workers Paid. https://developers.cloudflare.com/containers/platform/pricing/
- S17. Rust wasm32 unknown unknown platform limitations. https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html
- S18. W3C Web Annotation selectors and position anchoring. https://www.w3.org/TR/annotation-model/#selectors
- S19. Universal Dependencies distinguishes tokens from syntactic words. https://universaldependencies.org/u/overview/tokenization.html
- S20. LaBB-CAT server license and representative source notice at inspected commit 6099a295d54d7fada3ae348847a293deb5f8592f. https://github.com/nzilbb/labbcat-server/blob/6099a295d54d7fada3ae348847a293deb5f8592f/LICENSE and https://github.com/nzilbb/labbcat-server/blob/6099a295d54d7fada3ae348847a293deb5f8592f/server/src/main/java/nzilbb/labbcat/server/api/APIRequestContext.java
- S21. Annotation-graph layer schema and graph hierarchy. https://nzilbb.github.io/ag/apidocs/nzilbb/ag/Layer.html and https://nzilbb.github.io/ag/apidocs/nzilbb/ag/Graph.html
- S22. Validator behavior and documented incomplete checks. https://nzilbb.github.io/ag/apidocs/nzilbb/ag/util/Validator.html
- S23. Language fallback and auxiliary managers for multilingual corpora. https://nzilbb.github.io/labbcat-doc/howto/phonemic-tagging/multilingual-corpora.html
- S24. Search matrix semantics, filtering and match retrieval. https://nzilbb.github.io/labbcat-R/reference/getMatches.html
- S25. Search results, context, media and analysis exports. https://nzilbb.github.io/labbcat-doc/worksheets/course/4-searching.html
- S26. Flat lexicon import and tagging. https://nzilbb.github.io/labbcat-R/reference/loadLexicon.html
- S27. Configurable orthography to phoneme mapping. https://nzilbb.github.io/labbcat-doc/howto/phonemic-tagging/character-mapper.html
- S28. Missing pronunciations, token overrides and reusable dictionary entries. https://nzilbb.github.io/labbcat-doc/worksheets/course/8a-forced-alignment-htk.html
- S29. MFA integration and compatible pretrained models and dictionaries. https://nzilbb.github.io/labbcat-doc/howto/forced-alignment/mfa-pretrained-models.html
- S30. MFA train-and-align prerequisites and indicative speech-data requirement. https://nzilbb.github.io/labbcat-doc/howto/forced-alignment/mfa-train-align.html
- S31. Praat correction exchange, protected manual edits and boundary rules. https://nzilbb.github.io/labbcat-doc/howto/forced-alignment/correction-praat.html
- S32. EMU-webApp phone-boundary correction and save workflow. https://nzilbb.github.io/labbcat-doc/howto/forced-alignment/correction-emu.html
- S33. Aligned annotation, acoustic measurement and error reporting. https://nzilbb.github.io/labbcat-doc/worksheets/course/9-aligned-data.html
- S34. Annotator requirements, output layers and task lifecycle. https://nzilbb.github.io/ag/apidocs/nzilbb/ag/automation/Annotator.html and https://nzilbb.github.io/labbcat-js/LabbcatView.html
- S35. Formatter catalog and scoped fragment export. https://nzilbb.github.io/ag/nzilbb.formatter/index.html and https://nzilbb.github.io/labbcat-R/reference/getFragments.html
- S36. GNU AGPLv3 section 13 and GNU guidance on combined-work source obligations. https://www.gnu.org/licenses/agpl.en.html#section13 and https://www.gnu.org/licenses/gpl-faq.html#AGPLv3CorrespondingSource
