# Approved evidence to native Semantica

Authoring and review remain native research-intelligence evidence operations. Graphs are derived. `contract --revision ID` requires the exact current approved revision; no graph or worker dispatch occurs when the UI merely previews that contract.

The optional `scripts/semantica-handoff.py` adapter uses a separately supplied compatible compiler checkout with the `open_k_folds_semantic` package entrypoint, clean Git revision, and installed Semantica **0.6.8**. This repository does not redistribute that separate compiler or install its runtime. Base authoring, export and native generation contract tests do not need it. The adapter requires the native compiler's `compile_sources` entrypoint through `SeedManager`, `GraphBuilder` and `ContextGraph`; it does not implement a parallel extraction pipeline. A portable optional compiler lock and public integration fixture remain gates.

```sh
python scripts/verify-semantic-handoff.py --help
python scripts/semantica-handoff.py --help
```

The generation key binds exact evidence/config/rights/definition/artifact lineage, adapter/compiler source and runtime hashes, mapping/model/ontology versions and effective options. Authored documents, utterances, tokens, spans and relations are mapped without invented timing or linguistic inference. All projected source fields and the complete authored edge set are checked again by the native authority. Missing/extra topology is rejected.

The compiler never writes the authoring ledger. Rust stages verified immutable graph/receipt/contract objects, rechecks approval/head under the SQLite writer lock, and records one idempotent generation. Current generation queries require the current head and latest exact approval. Historical access is explicit with `--historical yes`. Corrections and review rejection exclude old graph generations from current queries; permanent erasure/tombstones are still future work.

No ontology/model inference, external graph database, extraction service or public corpus transfer is enabled by this adapter. It rejects an external database endpoint. The locally exercised optional smoke is described in MILESTONES.md; public CI does not claim this separately supplied runtime is verified.

Mapping `corpus-evidence/1` cannot distinguish identical span IDs in separate sidecars and continues to reject them. The adapter now explicitly requests `contract --mapping-version corpus-evidence/2`, which qualifies spans by transcript, sidecar and ID and binds both artifact hashes. Legacy anchors omit their new optional sidecar field; existing V1 receipts/contracts/graphs retain their original hashes and explicit history. Current eligibility considers each receipt's mapping version, so valid V2 generations can coexist with historical ambiguous V1 generations. Shared sidecars matching multiple transcript filenames and newly blocking validation still require explicit resolution. Default contract preview remains V1, and the ledger/API schema is unchanged. See the [reference inventory milestone](REFERENCE-INVENTORY-MILESTONE.md) for evidence and remaining structural gates.

Bounded structural split/merge now emits immutable successor lineage and reserves prior identities. Three optional actual native structural generations verify reviewed pre-edit, split and merge snapshots (7/13, 8/16, 7/13 nodes/edges), while old graphs/receipts/contracts remain exact historical objects and unreviewed changes are excluded. See [structural evidence and remaining decoder gates](RETOKENIZATION-MILESTONE.md).
