"""Local-only adapter to the existing Semantica-native compiler; no evidence ledger."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

sys.dont_write_bytecode = True

PACKAGE_FORMAT = "open-k-folds/corpus-semantica-handoff"
PACKAGE_FILES = ("graph.json", "completion.json", "contract.json", "README.md")
MAX_PACKAGE_FILE_BYTES = 64 * 1024 * 1024


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
    try:
        version = importlib.metadata.version("semantica")
    except importlib.metadata.PackageNotFoundError as error:
        raise ValueError("Semantica is not installed in this Python environment; select the existing Semantica 0.6.8 runtime") from error
    if version != "0.6.8":
        raise ValueError(f"This tested adapter requires installed Semantica 0.6.8; this runtime has {version}")
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


def load_compiler(root):
    """Resolve the selected compiler's real entrypoint without invoking extraction."""
    root = root.resolve()
    sys.path.insert(0, str(root / "src"))
    try:
        compile_sources = importlib.import_module("open_k_folds_semantic.run").compile_sources
    except (ImportError, AttributeError) as error:
        raise ValueError("The selected compiler has no compatible open_k_folds_semantic.run.compile_sources entrypoint") from error
    expected = (root / "src/open_k_folds_semantic/run.py").resolve()
    if Path(inspect.getfile(compile_sources)).resolve() != expected:
        raise ValueError("Imported compiler does not match the selected checkout; start a fresh Python process with the configured compiler")
    signature = inspect.signature(compile_sources)
    expected_arguments = ("source", "config_path", "ontology_paths", "output_path", "observation_paths")
    if tuple(signature.parameters)[:5] != expected_arguments:
        raise ValueError("The compiler must support compile_sources(source, config_path, ontology_paths, output_path, observation_paths); select the compatible structured-evidence compiler")
    try:
        signature.bind(Path("sources"), Path("semantica.yaml"), [], Path("graph.json"), [])
    except TypeError as error:
        raise ValueError("The compiler cannot accept the required five-argument structured-evidence API") from error
    return compile_sources


def check_runtime(compiler_root):
    """Read-only compatibility preflight. No graph, model or inference is started."""
    if os.getenv("FALKORDB_HOST"):
        raise ValueError("This adapter is local file-only; unset FALKORDB_HOST in the adapter process")
    recipe, runtime = effective_recipe(compiler_root)
    load_compiler(compiler_root)
    return {"ok": True, "operation": "check-runtime", "ready": True,
            "semantica_version": "0.6.8", "compiler_commit": recipe["compiler_commit"],
            "compiler_source_hash": recipe["compiler_source_hash"], "recipe": recipe,
            "runtime": {"python": runtime["python"], "platform": runtime["platform"],
                        "distribution_count": len(runtime) - 2},
            "compile_sources": {"entrypoint": "src/open_k_folds_semantic/run.py",
                                "supports_observations": True}}


def _json_object(data, name):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON field in {name}")
            result[key] = value
        return result
    try:
        value = json.loads(data.decode("utf-8"), object_pairs_hook=unique_keys)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Invalid UTF-8 JSON in {name}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {name}")
    return value


def _package_bytes(root, name, maximum=MAX_PACKAGE_FILE_BYTES):
    file = root / name
    if file.is_symlink() or not file.is_file() or file.resolve().parent != root.resolve():
        raise ValueError(f"Package file must be a regular local file: {name}")
    size = file.stat().st_size
    if size > maximum:
        raise ValueError(f"Package file exceeds the supported size: {name}")
    data = file.read_bytes()
    if len(data) != size:
        raise ValueError(f"Package file changed while being read: {name}")
    return data


def verify_package(package, compiler_root):
    """Check exported bytes and bindings, then consume them with native Semantica."""
    runtime = check_runtime(compiler_root)
    package = package.resolve()
    if not package.is_dir():
        raise ValueError("Choose an extracted Semantica handoff package directory")
    if {entry.name for entry in package.iterdir()} != {*PACKAGE_FILES, "manifest.json"}:
        raise ValueError("Handoff package must contain only manifest.json, graph.json, completion.json, contract.json and README.md")
    manifest_bytes = _package_bytes(package, "manifest.json", 8 * 1024 * 1024)
    manifest = _json_object(manifest_bytes, "manifest.json")
    if manifest.get("format") != PACKAGE_FORMAT or type(manifest.get("schema")) is not int or manifest["schema"] != 1:
        raise ValueError("Unsupported handoff package format or schema; export a schema-1 package")
    files = manifest.get("files")
    if not isinstance(files, dict) or set(files) != set(PACKAGE_FILES):
        raise ValueError("Handoff manifest must declare exactly the four fixed payload files")
    payload = {}
    for name in PACKAGE_FILES:
        expected = files[name]
        if not isinstance(expected, dict) or set(expected) != {"sha256", "bytes"}:
            raise ValueError(f"Invalid file manifest entry: {name}")
        if type(expected["bytes"]) is not int or expected["bytes"] < 0 or not isinstance(expected["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", expected["sha256"]):
            raise ValueError(f"Invalid file size or SHA-256: {name}")
        payload[name] = _package_bytes(package, name)
        if len(payload[name]) != expected["bytes"] or hashlib.sha256(payload[name]).hexdigest() != expected["sha256"]:
            raise ValueError(f"Package file checksum or byte count mismatch: {name}")
    if _package_bytes(package, "manifest.json", 8 * 1024 * 1024) != manifest_bytes:
        raise ValueError("Handoff manifest changed during verification")
    completion = _json_object(payload["completion.json"], "completion.json")
    contract = _json_object(payload["contract.json"], "contract.json")
    graph = _json_object(payload["graph.json"], "graph.json")
    try:
        binding = completion["binding"]
        recipe = binding["recipe"]
        generation_id = digest(binding)
        contract_hash = hashlib.sha256(payload["contract.json"]).hexdigest()
        receipt_hash = hashlib.sha256(payload["completion.json"]).hexdigest()
        graph_hash = hashlib.sha256(payload["graph.json"]).hexdigest()
        expected_binding, seed, expected_anchors = map_evidence(contract, recipe)
        if completion["schema"] != 1 or binding != expected_binding:
            raise ValueError("Completion and contract evidence binding mismatch")
        if binding["contract_hash"] != digest(contract):
            raise ValueError("Contract checksum does not match the completion binding")
        if binding["schema"] != 1 or binding["authority"] != "research-intelligence" or recipe["mapping_version"] != "corpus-evidence/2" or recipe["compiler_version"] != "semantica/0.6.8":
            raise ValueError("Unsupported exported evidence binding or recipe")
        if recipe["options"].get("extraction") != "none; authored evidence mapping" or recipe["options"].get("access") != "local-only":
            raise ValueError("Unsupported exported extraction or access recipe")
        review = contract["review"]
        if review["revision"] != binding["revision"] or review["snapshot_hash"] != binding["snapshot_hash"] or review["decision"] != "approved" or review["scope"] != "full":
            raise ValueError("Exported contract does not contain exact full-scope approval")
        if completion["graph_hash"] != graph_hash or completion["anchors"] != expected_anchors:
            raise ValueError("Graph checksum or evidence anchors do not match the completion")
        if not isinstance(graph["nodes"], list) or not isinstance(graph["edges"], list):
            raise ValueError("Native graph must contain node and edge lists")
        node_count, edge_count = len(graph["nodes"]), len(graph["edges"])
        if type(completion["node_count"]) is not int or type(completion["edge_count"]) is not int or completion["node_count"] != node_count or completion["edge_count"] != edge_count:
            raise ValueError("Graph counts do not match the completion")
        expected_manifest = {
            "generation_id": generation_id, "project": binding["project"],
            "revision": binding["revision"], "snapshot_hash": binding["snapshot_hash"],
            "config_hash": binding["config_hash"], "recipe_hash": digest(recipe),
            "contract_hash": contract_hash, "receipt_hash": receipt_hash, "graph_hash": graph_hash,
            **{key: recipe[key] for key in ("mapping_version", "adapter_hash", "compiler_version",
                                            "compiler_commit", "compiler_source_hash", "runtime_hash")},
            "recipe": recipe, "review": review, "rights": contract["rights"],
            "access_policy": contract["access_policy"], "source_artifacts": contract["artifact_manifest"],
            "node_count": node_count, "edge_count": edge_count,
        }
        if any(manifest.get(key) != value for key, value in expected_manifest.items()) or manifest.get("current_at_export") is not True:
            raise ValueError("Handoff manifest does not match the exact completion, contract or graph binding")
        expected_nodes = {record["id"]: record for record in seed["records"] if "id" in record}
        if len(expected_nodes) != node_count or len({node["id"] for node in graph["nodes"]}) != node_count:
            raise ValueError("Exported graph has missing or duplicate evidence nodes")
        for node in graph["nodes"]:
            expected = expected_nodes.get(node["id"])
            if expected is None or node["type"] != expected["type"] or any(node["properties"].get(key) != value for key, value in expected["properties"].items()) or node["properties"].get("content") != expected["text"]:
                raise ValueError("Exported graph source evidence does not match the approved contract")
        edge_key = lambda edge: (edge["source_id"], edge["target_id"], edge["type"])
        expected_edges = {edge_key(record): record["metadata"] for record in seed["records"] if "source_id" in record}
        if len(expected_edges) != edge_count or len({edge_key(edge) for edge in graph["edges"]}) != edge_count:
            raise ValueError("Exported graph has missing or duplicate authored edges")
        if any(edge_key(edge) not in expected_edges or any(edge["properties"].get(key) != value for key, value in expected_edges[edge_key(edge)].items()) for edge in graph["edges"]):
            raise ValueError("Exported graph authored edges do not match the approved contract")
    except (KeyError, TypeError, AttributeError) as error:
        raise ValueError("Handoff package has incomplete or malformed evidence bindings") from error
    try:
        from semantica.context import ContextGraph
        reopened = ContextGraph(advanced_analytics=False)
        reopened.load_from_file(str(package / "graph.json"))
    except Exception as error:
        raise ValueError(f"Native Semantica could not reopen the verified graph ({type(error).__name__}); use the configured compatible runtime") from error
    if len(reopened.nodes) != node_count or len(reopened.edges) != edge_count:
        raise ValueError("Native graph reopen did not preserve the exported node and edge counts")
    for name in PACKAGE_FILES:
        if _package_bytes(package, name) != payload[name]:
            raise ValueError(f"Package file changed during native verification: {name}")
    if _package_bytes(package, "manifest.json", 8 * 1024 * 1024) != manifest_bytes:
        raise ValueError("Handoff manifest changed during native verification")
    return {"ok": True, "verified": True, "operation": "verify-package", "format": PACKAGE_FORMAT,
            "schema": 1, "generation_id": generation_id, "revision": binding["revision"],
            "snapshot_hash": binding["snapshot_hash"], "node_count": node_count,
            "edge_count": edge_count, "files_verified": len(PACKAGE_FILES), "native_reopen": True,
            "semantica_version": runtime["semantica_version"], "current_at_export": True,
            "current_eligibility": "not checked; exported snapshot only"}


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
    compile_sources = load_compiler(compiler_root)
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
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check-runtime", action="store_true")
    modes.add_argument("--verify-package", type=Path)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--store", type=Path)
    parser.add_argument("--project")
    parser.add_argument("--revision", type=int)
    parser.add_argument("--compiler-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    operation = "check-runtime" if args.check_runtime else "verify-package" if args.verify_package else "ingest"
    try:
        if args.check_runtime:
            result = check_runtime(args.compiler_root.resolve())
        elif args.verify_package:
            result = verify_package(args.verify_package.resolve(), args.compiler_root.resolve())
        else:
            if not all((args.binary, args.store, args.project, args.revision is not None, args.output)):
                raise ValueError("Ingest requires --binary, --store, --project, --revision and --output")
            result = ingest(args.binary.resolve(), args.store.resolve(), args.project, args.revision,
                            args.compiler_root.resolve(), args.output.resolve())
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        if isinstance(error, subprocess.CalledProcessError):
            message = error.stderr.decode("utf-8", errors="replace").strip() if isinstance(error.stderr, bytes) else str(error.stderr or "").strip()
            message = message or "Native evidence operation failed"
        else:
            message = str(error) or type(error).__name__
        action = ("Select the existing Semantica 0.6.8 Python runtime and a clean compatible compiler checkout; no installation is performed."
                  if operation == "check-runtime" else
                  "Select an intact extracted schema-1 handoff package and the configured compatible local runtime."
                  if operation == "verify-package" else
                  "Confirm the current saved revision has exact approval and the configured local runtime is ready; retry with a new output directory.")
        print(json.dumps({"ok": False, "operation": operation, "error": message, "action": action}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
