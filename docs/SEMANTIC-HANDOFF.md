# Approved evidence to native Semantica

Authoring and review remain native research-intelligence evidence operations. Graphs are derived. `contract --revision ID` requires the exact current approved revision; no graph or worker dispatch occurs when the UI merely previews that contract.

The optional `scripts/semantica-handoff.py` adapter uses a separately supplied compatible compiler checkout with the `open_k_folds_semantic` package entrypoint, clean Git revision, and installed Semantica **0.6.8**. This repository does not redistribute that separate compiler or install its runtime. Base authoring, export and native generation contract tests do not need it. The adapter requires the native compiler's `compile_sources` entrypoint through `SeedManager`, `GraphBuilder` and `ContextGraph`; it does not implement a parallel extraction pipeline. A portable optional compiler lock and public integration fixture remain gates.

The desktop **Research handoff** tool now runs this adapter. Choose **Configure local runtime**, select the existing Python executable and compatible clean compiler checkout, then explicitly review the exact saved revision. **Run local Semantica** obtains a V2 contract, compiles authored evidence, checks native acceptance, exports a private consumer-check package and reopens it with the installed `ContextGraph`. A successful process exit alone is insufficient. **Export validated graph** creates a fresh portable folder and repeats the consumer check. The browser explains the desktop runtime requirement; exporting a complete corpus ZIP does not run Semantica.

The optional guide links preserved sources, corrections, uncertainty annotations and exact-revision review. Skip, resume and revisit it without advancing a review decision or changing a draft. The desktop **Recording + transcript** action prepares a local recording and existing UTF-8 text or supported Omnilingual JSON; see [the versioned input boundary](LOCAL-TRANSCRIPT-IMPORT.md). Complete TEITOK directories remain supported. Raw drafts and media stay preserved while corrections use the working projection. The practice corpus contains generated text and a tone, not recognized speech. Each new practice action creates an independent copy; use Recent projects to resume an existing authority.

Uncertain words and competing interpretations remain literal reviewer notes, custom token annotations and span fields. They survive graph mapping inside the complete source projection. Notes are not automatic review blockers or measured probabilities. The authored-evidence lane performs no ASR, alignment, model extraction or ontology inference. Generic graph confidence and the recipe's compiler configuration must not be interpreted as transcription certainty.

```sh
python scripts/verify-semantic-handoff.py --help
python scripts/semantica-handoff.py --help
python scripts/semantica-handoff.py --check-runtime --compiler-root CLEAN_COMPILER
```

The compiler must expose `compile_sources(source, config_path, ontology_paths, output_path, observation_paths)` from its selected `src/open_k_folds_semantic/run.py`. Runtime preflight checks the installed version, clean compiler identity and this actual callable signature without compiling source prose. The locally qualified compiler is `81af6d16c223582d1b6ba54549831bb050b07302`; the compatible installation is separately supplied and no compiler code is changed by this feature.

## Portable handoff contract, schema 1

`export-handoff --store AUTHORITY --project ID --generation HASH --out NEW_DIRECTORY` accepts only a current, fully approved generation. It refuses an occupied destination. The directory contains exactly these files:

| File | Meaning |
| --- | --- |
| `graph.json` | Exact accepted Semantica graph object bytes |
| `completion.json` | Exact immutable native completion receipt bytes |
| `contract.json` | Exact approved source, review, rights and provenance contract bytes |
| `README.md` | Consumer instructions and limits |
| `manifest.json` | Completion marker and versioned payload manifest, written last |

The manifest identifies `format: "open-k-folds/corpus-semantica-handoff"`, `schema: 1`, generation/project/revision/snapshot/config identities, contract/receipt/graph hashes, mapping and recipe hashes, adapter/compiler/runtime identities, full recipe, exact review, rights/access policy, source artifact references, node/edge counts and `current_at_export: true`. Its `files` object declares exactly the four payload basenames, each with SHA-256 and byte count. Hashes cover stored bytes, including JSON formatting; they are not hashes of parsed and reserialized JSON. The receipt's canonical binding determines the generation ID independently of its raw file hash.

Portable consumption supports mapping V2. If an authority contains an accepted legacy V1 graph, run local Semantica to create its supported V2 successor before validated desktop export; the legacy graph remains preserved.

Approval/head are checked again under the native writer lock before the manifest is written. Missing/invalid manifest means incomplete export. The package describes original artifact hashes but contains no original audio or raw ASR bytes. Preserve those with the separate complete package archive. The graph still contains sensitive authored source projections and notes; local-only corpus rights continue to apply.

```sh
python scripts/semantica-handoff.py --verify-package EXTRACTED_FOLDER --compiler-root CLEAN_COMPILER
```

The consumer rejects unsupported schema, extra/missing files, unsafe payload paths, changed bytes, binding/review/provenance/topology mismatches and unexpected counts before claiming verification. It then actually calls `ContextGraph.load_from_file`, checks reopened counts and rechecks graph bytes. This verifies integrity and native readability, not a producer signature or a transfer into another application's database. `current_at_export` describes the export boundary; a detached package cannot know later edits or review retraction in its original authority.

## Retry, interruption and recovery

The desktop stores runtime paths and private attempt metadata in its profile. It starts one bounded child process without a shell; authoring controls are guarded while recording controls remain available. It never installs a runtime or silently approves a revision. Failed/partial attempt directories remain intact. Errors stay visible until retry or explicit refresh, and an accepted receipt remains distinguishable from a successful runtime consumer check.

The generation key is idempotent for the same approved contract and effective recipe. Repeated execution reuses the accepted generation and repeats the real consumer read; changed evidence, review contract or runtime recipe can produce a new identity. Every portable export gets a fresh directory and never overwrites an earlier copy. Interrupted attempts reconcile against the native authority; retry may reuse an accepted result even if its earlier response was lost. A forced application/process termination is not a cancellation guarantee; acceptance still rechecks exact approval. Later edits/rejection remove old results from current scope. Review and run the new saved revision to recover.

Optional actual-runtime qualification uses synthetic fixtures:

```sh
python scripts/verify-semantic-handoff.py --binary NATIVE_BINARY --compiler-root CLEAN_COMPILER --evidence evidence.json --export-dir NEW_RETAINED_FOLDER
# Native Electron journey (requires a built desktop bundle):
# WB_ELECTRON_EXECUTABLE, WB_SEMANTICA_PYTHON, WB_SEMANTICA_COMPILER_ROOT
npm run test:electron
```

Public CI runs Rust export tests, Python boundary tests and desktop control-plane tests. Those doubles do not claim an installed compiler was executed. The env-gated native journey and optional verifier exercise the real separately supplied runtime locally. Runtime package/platform fingerprints are recorded; a portable dependency lock and real private-corpus linguistic qualification remain outside this slice.

The generation key binds exact evidence/config/rights/definition/artifact lineage, adapter/compiler source and runtime hashes, mapping/model/ontology versions and effective options. Authored documents, utterances, tokens, spans and relations are mapped without invented timing or linguistic inference. All projected source fields and the complete authored edge set are checked again by the native authority. Missing/extra topology is rejected.

The compiler never writes the authoring ledger. Rust stages verified immutable graph/receipt/contract objects, rechecks approval/head under the SQLite writer lock, and records one idempotent generation. Current generation queries require the current head and latest exact approval. Historical access is explicit with `--historical yes`. Corrections and review rejection exclude old graph generations from current queries; permanent erasure/tombstones are still future work.

No ontology/model inference, external graph database, extraction service or public corpus transfer is enabled by this adapter. It rejects an external database endpoint. The locally exercised optional smoke is described in MILESTONES.md; public CI does not claim this separately supplied runtime is verified.

Mapping `corpus-evidence/1` cannot distinguish identical span IDs in separate sidecars and continues to reject them. The adapter now explicitly requests `contract --mapping-version corpus-evidence/2`, which qualifies spans by transcript, sidecar and ID and binds both artifact hashes. Legacy anchors omit their new optional sidecar field; existing V1 receipts/contracts/graphs retain their original hashes and explicit history. Current eligibility considers each receipt's mapping version, so valid V2 generations can coexist with historical ambiguous V1 generations. Shared sidecars matching multiple transcript filenames and newly blocking validation still require explicit resolution. Default contract preview remains V1, and the ledger/API schema is unchanged. See the [reference inventory milestone](REFERENCE-INVENTORY-MILESTONE.md) for evidence and remaining structural gates.

Bounded structural split/merge now emits immutable successor lineage and reserves prior identities. Three optional actual native structural generations verify reviewed pre-edit, split and merge snapshots (7/13, 8/16, 7/13 nodes/edges), while old graphs/receipts/contracts remain exact historical objects and unreviewed changes are excluded. See [structural evidence and remaining decoder gates](RETOKENIZATION-MILESTONE.md).
