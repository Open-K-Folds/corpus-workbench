# Edited package reconciliation checkpoint

This implements the next B16/B08/B21 product slice: a TEITOK export edited in a
separate copy can return as a proposal to the existing native revision authority.
The ordinary import receipt checks remain strict.

The native core freezes the complete directory in content-addressed private
staging. `return-stage --package DIRECTORY` returns a stage hash;
`return-preview --request FILE` binds it to the project, current revision and
snapshot hash. A `reconcile_package` command carries that request and the preview
hash through the existing atomic commit and idempotency path.

Supported deltas are the existing editable, unqualified leaf-token attributes:
`nform`, `wb_normalized`, `variety`, `annotation`, `review`, `note`, `lemma`, `pos`,
`msd`, `relation_target`, `relation_type`. The three-way preview distinguishes
external changes, already-current values and conflicts requiring explicit
current/external choices. Batches are limited to 100 changed fields.

An ordered XML signature preserves original text, IDs, timing, namespaced
attributes, unknown elements, comments and processing instructions. XML
declaration, quote/entity spelling and attribute order may differ after TEITOK's
serializer. Accepted changes patch the native original XML. Exact changed source
XML and new `backups/*.xml` files are retained in an immutable hash-named lineage
artifact; new active structures and changed settings, media or raw drafts block.
No returned approvals or compiler generations become current approvals.

Incremental publication: the native core passes the existing 134 Rust tests and
`cargo check --locked`. Reconciliation-specific falsifications, browser directory
upload/review, actual TEITOK save/reopen and recovery checks are pending. This
checkpoint is not the completed usable UI milestone or the whole migration plan.

The published source before this checkpoint is `3be85c7`, with passing native
amd64/ARM64 container contract runs. Version `0.2.0-dev.8` manifests were published
at `sha256:b636f47d7ec273378e502e2e91ea7eb4a3cf1a72e7cfe19ffcd2791a0149ee95`.
The publication workflow's final anonymous inspection failed with HTTP 401;
authenticated pulls are an accepted deployment choice. No physical Pi validation
is claimed, and device qualification does not block application development.
