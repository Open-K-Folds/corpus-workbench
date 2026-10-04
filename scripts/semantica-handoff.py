"""Local-only adapter to the existing Semantica-native compiler; no evidence ledger."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

sys.dont_write_bytecode = True


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def core(binary, store, project, *arguments):
    result = subprocess.run([str(binary), *map(str, arguments), "--store", str(store),
                             "--project", project], check=True, capture_output=True)
    return json.loads(result.stdout)


def compiler_identity(root):
    def git(*args):
        return subprocess.check_output(["git", "-c", f"safe.directory={root.as_posix()}",
                                        "-C", str(root), *args], text=True).strip()
    if git("status", "--porcelain", "--untracked-files=no"):
        raise ValueError("Compiler checkout has tracked modifications; use a reviewed clean revision")
    commit = git("rev-parse", "HEAD")
    paths = ["src/open_k_folds_semantic/__init__.py", "src/open_k_folds_semantic/run.py",
             "src/open_k_folds_semantic/validation.py", "pyproject.toml"]
    files = {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in paths}
    return commit, digest(files)


def effective_recipe(root):
    if importlib.metadata.version("semantica") != "0.6.8":
        raise ValueError("This tested adapter requires installed Semantica 0.6.8")
    commit, source_hash = compiler_identity(root)
    runtime = {distribution.metadata["Name"]: distribution.version
               for distribution in importlib.metadata.distributions()}
    runtime.update(python=platform.python_version(), platform=platform.platform())
    recipe = {
        "mapping_version": "corpus-evidence/2",
        "adapter_hash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "compiler_commit": commit, "compiler_source_hash": source_hash,
        "compiler_version": "semantica/0.6.8", "runtime_hash": digest(runtime),
        "ontology_hash": digest([]), "model_hash": digest(None),
        "options": {"extraction": "none; authored evidence mapping", "access": "local-only",
                    "ontology": "none; corpus evidence types are not ontology-validated",
                    "model": "none", "compiler_config": "pattern/min_confidence=0.70/max_workers=1"},
    }
    return recipe, runtime


def map_evidence(contract, recipe):
    """Wire source projections to native seed records; do not infer linguistic claims."""
    binding = {"schema": 1, "authority": contract["authority"], "project": contract["project_id"],
               "revision": contract["revision"]["id"], "snapshot_hash": contract["bundle_hash"],
               "config_hash": contract["config_hash"], "contract_hash": digest(contract),
               "recipe": recipe}
    lineage = {"project_id": binding["project"], "revision": binding["revision"],
               "bundle_hash": binding["snapshot_hash"], "config_hash": binding["config_hash"],
               "contract_hash": binding["contract_hash"], "recipe_hash": digest(recipe),
               "access_policy": "local-only"}
    records, anchors = [], {}

    def node(document, kind, external_id, source, text, sidecar=None):
        anchor = {"document": document, "kind": kind, "external_id": external_id}
        if sidecar is not None:
            anchor["sidecar"] = sidecar
        identity = "corpus:" + digest({"project": binding["project"], **anchor})
        anchors[identity] = anchor
        records.append({"id": identity, "type": "Corpus" + kind.title(), "text": text,
                        "properties": {**lineage, "anchor": anchor, "source": source,
                                       "artifact_hash": contract["artifact_manifest"][sidecar or document]["sha256"],
                                       "transcript_hash": contract["artifact_manifest"][document]["sha256"],
                                       "rights": contract["rights"],
                                       "definition_version": contract["definition_version"]}})
        return identity

    def edge(source, target, kind):
        records.append({"source_id": source, "target_id": target, "type": kind,
                        "metadata": lineage.copy()})

    for doc in contract["documents"]:
        path = doc["path"]
        source = {key: doc[key] for key in ["path", "title", "media", "metadata", "opaque_elements"]}
        document = node(path, "document", path, source, doc["title"])
        segments = {s["id"]: node(path, "utterance", s["id"], s, s["id"]) for s in doc["segments"]}
        for identity in segments.values():
            edge(identity, document, "partOfDocument")
        tokens = {}
        for token in doc["tokens"]:
            identity = node(path, "token", token["id"], token,
                            token["corrected"] if token["corrected"] is not None else token["original"])
            tokens[token["id"]] = identity
            edge(identity, document, "partOfDocument")
            if token["utterance"] is not None:
                edge(identity, segments[token["utterance"]], "partOfUtterance")
        for span in doc["spans"]:
            identity = node(path, "span", span["id"], span, span["fields"].get("label", span["id"]), span["sidecar"])
            edge(identity, document, "partOfDocument")
            for token in span["token_ids"]:
                edge(identity, tokens[token], "anchorsToken")
        for token in doc["tokens"]:
            target = token["attrs"].get("relation_target")
            if target:
                kind = token["attrs"].get("relation_type")
                if not kind:
                    raise ValueError("Supported authored relation has no type; review before compilation")
                edge(tokens[token["id"]], tokens[target.lstrip("#")], "authored:" + kind)
    return binding, {"records": records}, anchors


def ingest(binary, store, project, revision, compiler_root, output):
    # The native authority checks review and exact-head eligibility before dispatch.
    contract = core(binary, store, project, "contract", "--revision", revision, "--mapping-version", "corpus-evidence/2")
    recipe, runtime = effective_recipe(compiler_root)
    binding, seed, anchors = map_evidence(contract, recipe)
    generation_id = digest(binding)
    current = core(binary, store, project, "generations")
    if any(entry["generation_id"] == generation_id for entry in current):
        return {"generation_id": generation_id, "revision": revision, "reused": True}
    if output.exists():
        raise ValueError("Attempt output exists; choose a new directory")
    if os.getenv("FALKORDB_HOST"):
        raise ValueError("This adapter is local file-only; unset FALKORDB_HOST")
    output.mkdir(parents=True)
    sources = output / "sources"
    sources.mkdir()  # Explicit structured-only recipe: no automatic prose extraction.
    (output / "contract.json").write_bytes(encoded(contract))
    (output / "seed.json").write_bytes(encoded(seed))
    (output / "runtime.json").write_bytes(encoded(runtime))
    config = output / "semantica.yaml"
    config.write_text("extraction:\n  method: pattern\nquality:\n  min_confidence: 0.70\nprocessing:\n  max_workers: 1\n", encoding="utf-8")
    sys.path.insert(0, str(compiler_root / "src"))
    from open_k_folds_semantic.run import compile_sources
    import inspect
    if Path(inspect.getfile(compile_sources)).resolve() != (compiler_root / "src/open_k_folds_semantic/run.py").resolve():
        raise ValueError("Imported compiler does not match the bound checkout")
    from semantica.context import ContextGraph
    graph_file = output / "graph.json"
    compile_sources(sources, config, [], graph_file, [output / "seed.json"])
    graph = json.loads(graph_file.read_text(encoding="utf-8"))
    # Exercise the installed native reader too, rather than merely accepting JSON.
    reopened = ContextGraph(advanced_analytics=False)
    reopened.load_from_file(str(graph_file))
    if len(reopened.nodes) != len(anchors) or len(reopened.edges) != len(graph["edges"]):
        raise ValueError("Native graph reopen lost evidence")
    if effective_recipe(compiler_root)[0] != recipe:
        raise ValueError("Compiler/runtime changed during dispatch; completion is rejected")
    completion = {"schema": 1, "binding": binding,
                  "graph_hash": hashlib.sha256(graph_file.read_bytes()).hexdigest(),
                  "node_count": len(graph["nodes"]), "edge_count": len(graph["edges"]), "anchors": anchors}
    receipt = output / "completion.json"
    receipt.write_bytes(encoded(completion))
    # Only the Rust authority commits the result. A stale/retracted review fails
    # here, even if it changed while the independent compiler was executing.
    result = core(binary, store, project, "accept-generation", "--receipt", receipt, "--graph", graph_file)
    if result["generation_id"] != generation_id:
        raise ValueError("Native and adapter ingestion keys differ")
    return {**result, "reused": False, "native_reopen": True, "output": str(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--revision", type=int, required=True)
    parser.add_argument("--compiler-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = ingest(args.binary.resolve(), args.store.resolve(), args.project, args.revision,
                    args.compiler_root.resolve(), args.output.resolve())
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
