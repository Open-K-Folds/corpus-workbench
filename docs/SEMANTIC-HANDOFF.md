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

Mapping `corpus-evidence/1` cannot distinguish identical span IDs in separate sidecars. Such packages remain lossless for authoring/export, but compiler handoff rejects the ambiguous identity. Shared sidecars matching multiple transcript filenames likewise require an explicit association. Any existing ambiguous generation is excluded from current queries and remains available through explicit historical access. A qualified compiler mapping is a future gate; this milestone does not change mapping or ledger schemas.
