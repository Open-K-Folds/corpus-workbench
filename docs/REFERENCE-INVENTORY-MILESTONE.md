# Package reference inventory foundation

Source version **0.2.0-dev.2** adds a usable References inspector, native discovery and structural preflight, and qualified compiler mapping v2. This is a bounded prerequisite milestone for approved-plan B19/B20, not completed converters or retokenization. The published `0.1.0-preview.1` release is immutable.

Every package artifact is listed with its existing exact hash, size and role. Valid UTF-8 XML and XML-like sidecars (`.psdx`, schemas, stylesheets, SVG and recognizable XML with other extensions) enumerate every lexical attribute, namespace declaration, text piece, CDATA section, comment and processing instruction. XML declarations and outside-root whitespace are included. Carriers retain artifact path/hash, QName/namespace, original UTF-8 byte ranges, decoded values and parent element scope. Attributes use the shared quote-aware lexical scanner. Text scanning preserves separate pieces because the DOM parser merges adjacent text/CDATA while reporting only the first piece's range. No XML is reserialized.

ID declarations distinguish artifact path, element byte position and ID, including implicit `xml:id`. Equal bytes at different paths remain distinct. Candidate token lists, dependency heads, inline/stand-off links and explicit fragments receive only syntactic ID lookup. Local, document-relative, missing, external/unsafe, unknown and ambiguous scopes are separate. Shared annotation sidecars never acquire a guessed single owner. Inherited `xml:base`, configured XPath/custom fields, media base-URL/fallback rules and namespaced lookalikes remain unproven. Other grammars, binary data and malformed/unsupported XML-like sidecars are explicitly opaque. Nothing is executed or fetched.

The References inspector filters carriers by artifact/resolution, downloads complete inventory JSON, and checks proposed token/converter impact against a qualified target. The displayed list is bounded to 200 matches; the download is complete. Native inventory processing fails rather than returning partial coverage beyond 100,000 carriers. Existing package/XML parser limits still apply. Unsupported `.xml` imports retain the existing safe-parser rejection; other preserved XML-like formats can report opaque coverage.

`GET /api/inventory?revision=ID` returns `{inventory_hash, inventory}`. `inventory --revision ID` prints the inventory directly. `POST /api/preflight` and `preflight --request FILE` require schema 1, project, revision, snapshot/config/inventory hashes, operation (`retokenize` or `converter`), and qualified targets from that inventory. Unknown/duplicate targets, forged bindings, cross-project access and stale heads are rejected. The report lists known affected carriers, unknown/ambiguous carriers, opaque artifacts, immutable history and separate live review/generation context. Inventory digests remain stable after later edits/reviews/generations. Preflight **always returns `execution_enabled: false`** and does not stage objects or commit revisions.

Relation-only stand-off spans without token anchors now survive import/export as unsupported authored structures. Their source/target carriers can resolve within the sidecar, but they remain read-only and block full approval/compiler dispatch. Legacy `idx` coordinates retain their supplied semantics; they are not relabeled as workbench Unicode coordinates. Span-bearing `_def.xml` files block approval as ambiguous definitions. Unassociated or shared span-bearing annotation sidecars also block full approval and compiler currentness; their bytes remain exportable. Creation of a span for `def.xml` is rejected before writing its reserved sidecar filename.

Compiler mapping `corpus-evidence/2` qualifies span identities by transcript path, sidecar path and external ID. Span provenance binds the actual sidecar artifact and separate transcript artifact. Document/token/utterance identities already include document path. The adapter requests contract version 2 explicitly. Default CLI/UI contract preview remains version 1 for compatibility. Legacy anchors omit the new optional sidecar field, preserving their original serialization/digests. V1 duplicate-span generations remain exact historical records; valid V2 generations at the same approved revision can become current. Shared transcript/sidecar association remains blocked in both versions. Eligibility considers each immutable receipt's mapping version and current validation, approval and head.

Validation baseline: **91 Rust tests** (36 core contracts, 19 annotation edits, six export integrity, nine generations, three process recovery, 15 reference inventory, three review regressions), strict rustfmt/Clippy, TypeScript/build, and **seven actual browser flows**. The new browser flow exercises filtered discovery, full JSON download, blocked impact inspection, mobile layout, cross-project denial, stale rejection, immutable historical evidence and delayed-response selection races. Existing playback/correction/annotation/history/review/complete export/reimport/conflict flows still run. Independent source review used eleven synthetic package cases and eight forged compiler variants. No real media or transcripts are published.

Portable commands:

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --locked
npm ci --prefix ui
npm run check --prefix ui
npm run build --prefix ui
npm run test:e2e --prefix ui
npm audit --prefix ui --audit-level=low
cargo audit --deny warnings
```

Windows local verification used the supplied Rust/Visual Studio environment with `--target-dir target/reference-inventory`, direct `ui/node_modules/.bin/vite.cmd build --outDir dist-next`, and isolated Chrome with `WB_BINARY`/`WB_UI` pointing to those artifacts. Browser QA used a new synthetic authority on loopback 18912 and terminated it afterward. No existing session, preview binary, source demo or original corpus was replaced.

The separately installed native Semantica 0.6.8 acceptance script remains optional and outside public CI. It exercises approved R1/R2, three annotation generations, native reopen, retry, forged evidence, stale/rejected review and backup restore. The new qualified fixture repeats token IDs across two documents and span IDs across three sidecars, producing seven distinct nodes and eight authored edges with actual sidecar/transcript hashes.

Remaining structural gates are carrier-specific remapping contracts, explicit ambiguous associations, configurable/schema dialect decoding, prospective ID lineage, Unicode/time/overlap validation after structural changes, CWB byte-offset/index rebuild contracts, complete export/reopen proof and atomic converter/retokenization transactions. No split/merge, converter execution, durable worker/outbox, rights erasure, production deployment or native Pi validation is claimed here. Exact hosted CI and independent review of the integrated commit are required by the source integration workflow.
