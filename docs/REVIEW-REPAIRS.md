Independent review of the first two commits reproduced six correctness defects.
The repairs preserve supplied Workbench files byte for byte, including unknown
JSON fields and earlier receipts. Effective definitions, receipts and complete
historical objects are added under a fresh `Workbench/exports/<id>/` namespace
before atomic directory publication. Reimport applies a configuration overlay
only when its receipt matches all files outside that namespace. Older receipts
remain inspectable and keep valid hashes through subsequent exports.

Imported supported character anchors now receive the same Unicode range, quote,
layer and coordinate validation as authored anchors. Invalid supplied anchors
remain preserved, with blocking review issues. Concurrent identical commands
recheck their immutable payload binding under the SQLite writer lock.

Each server authorizes only downloads that it created for its own project
session. A ZIP's presence in a shared runtime directory grants no access.
The server binds its loopback port before writing a session launcher, and mixed
documents display unparented tokens in an explicit untimed section.

Validation: 42 Rust tests, strict Clippy, TypeScript build and three isolated
Playwright journeys pass. Tests use a separate binary target and UI directory;
the separate local integration environment was preserved.

Follow-up independent checks also verify receipt snapshot hashes, effective
definitions, every supplied history checksum and all declared historical objects.
Malformed/missing managed receipts fail explicitly. A package edited externally
after a workbench export requires explicit lineage reconciliation before reimport;
the importer cannot silently discard its effective configuration. Untimed runs
are interleaved in source order. Nine focused independent cases, including 24
concurrent duplicate rounds, and the ordered browser/scope controls pass.
