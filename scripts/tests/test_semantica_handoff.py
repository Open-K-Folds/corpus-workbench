"""Portable handoff checks using synthetic evidence and a mocked native reader.

The optional installed Semantica runtime has its own acceptance script. These
tests exercise the package boundary without importing a compiler or user corpus.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


ADAPTER_PATH = Path(__file__).resolve().parents[1] / "semantica-handoff.py"
SPEC = importlib.util.spec_from_file_location("semantica_handoff_under_test", ADAPTER_PATH)
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def pretty_json(value):
    # The manifest binds file bytes, including harmless formatting differences.
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


class HandoffPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="semantica-package-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / "handoff"
        self.package.mkdir()
        self.compiler_root = self.root / "mock-compiler"
        self.recipe = {
            "mapping_version": "corpus-evidence/2",
            "adapter_hash": "a" * 64,
            "compiler_commit": "b" * 40,
            "compiler_source_hash": "c" * 64,
            "compiler_version": "semantica/0.6.8",
            "runtime_hash": "d" * 64,
            "ontology_hash": adapter.digest([]),
            "model_hash": adapter.digest(None),
            "options": {
                "extraction": "none; authored evidence mapping",
                "access": "local-only",
                "ontology": "none; corpus evidence types are not ontology-validated",
                "model": "none",
                "compiler_config": "pattern/min_confidence=0.70/max_workers=1",
            },
        }
        transcript = b"<TEI><text><tok id='w1'>SYNTHETIC</tok></text></TEI>"
        snapshot_hash = "e" * 64
        self.contract = {
            "contract_version": 2,
            "authority": "research-intelligence",
            "project_id": "synthetic-package-check",
            "revision": {
                "id": 7, "parent": 6, "snapshot_hash": snapshot_hash,
                "actor": "synthetic-owner", "label": "Synthetic reviewed correction",
                "created_at": "2026-10-15T00:00:00Z", "command_id": "synthetic-command",
            },
            "bundle_hash": snapshot_hash,
            "config_hash": "f" * 64,
            "definition_version": 1,
            "rights": "Synthetic fixture; no research corpus content",
            "access_policy": "local-only; public/model-training permission not implied",
            "artifact_manifest": {
                "xmlfiles/synthetic.xml": {
                    "sha256": sha256(transcript), "bytes": len(transcript),
                    "role": "transcript",
                },
            },
            "review": {
                "revision": 7, "snapshot_hash": snapshot_hash,
                "actor": "synthetic-owner", "decision": "approved", "scope": "full",
                "note": "Synthetic mechanics only; uncertainty stays authored",
                "created_at": "2026-10-15T00:01:00Z", "self_review": True,
            },
            "documents": [{
                "path": "xmlfiles/synthetic.xml", "title": "SYNTHETIC e\u0301🙂",
                "media": [], "metadata": {"source": "synthetic"}, "opaque_elements": [],
                "segments": [], "spans": [],
                "tokens": [{
                    "id": "w1", "internal_id": "synthetic-internal-w1",
                    "original": "e\u0301🙂", "corrected": "heard 🙂", "normalized": None,
                    "attrs": {"uncertainty": "synthetic ambiguous hearing"},
                    "utterance": None, "start_us": None, "end_us": None,
                    "language_effective": None, "language_source": "unknown", "editable": True,
                }],
            }],
        }
        binding, seed, anchors = adapter.map_evidence(self.contract, self.recipe)
        self.binding = binding
        self.graph = {"nodes": [], "edges": []}
        for record in seed["records"]:
            if "id" in record:
                self.graph["nodes"].append({
                    "id": record["id"], "type": record["type"],
                    "properties": {**record["properties"], "content": record["text"]},
                })
            else:
                self.graph["edges"].append({
                    "source_id": record["source_id"], "target_id": record["target_id"],
                    "type": record["type"], "properties": record["metadata"],
                })
        self.completion = {
            "schema": 1, "binding": binding, "graph_hash": sha256(pretty_json(self.graph)),
            "node_count": len(self.graph["nodes"]), "edge_count": len(self.graph["edges"]),
            "anchors": anchors,
        }
        self.write_json("contract.json", self.contract)
        self.write_json("graph.json", self.graph)
        self.write_json("completion.json", self.completion)
        (self.package / "README.md").write_bytes(b"# SYNTHETIC local graph handoff\n")
        self.manifest = {
            "schema": 1, "format": "open-k-folds/corpus-semantica-handoff",
            "generation_id": adapter.digest(binding), "project": binding["project"],
            "revision": binding["revision"], "snapshot_hash": binding["snapshot_hash"],
            "config_hash": binding["config_hash"], "recipe_hash": adapter.digest(self.recipe),
            "mapping_version": self.recipe["mapping_version"],
            **{key: self.recipe[key] for key in (
                "adapter_hash", "compiler_version", "compiler_commit",
                "compiler_source_hash", "runtime_hash",
            )},
            "recipe": self.recipe,
            "review": self.contract["review"], "rights": self.contract["rights"],
            "access_policy": self.contract["access_policy"],
            "source_artifacts": self.contract["artifact_manifest"],
            "node_count": self.completion["node_count"],
            "edge_count": self.completion["edge_count"], "current_at_export": True,
        }
        self.reseal_files()
        self.loaded_paths = []
        self.native_node_delta = 0
        self.native_edge_delta = 0
        self.native_error = None
        owner = self

        class SyntheticContextGraph:
            def __init__(self, **_options):
                self.nodes = []
                self.edges = []

            def load_from_file(self, filename):
                owner.loaded_paths.append(Path(filename))
                if owner.native_error is not None:
                    raise owner.native_error
                graph = json.loads(Path(filename).read_text(encoding="utf-8"))
                self.nodes = [None] * (len(graph["nodes"]) + owner.native_node_delta)
                self.edges = [None] * (len(graph["edges"]) + owner.native_edge_delta)

        context = types.ModuleType("semantica.context")
        context.ContextGraph = SyntheticContextGraph
        semantica = types.ModuleType("semantica")
        semantica.context = context
        modules = patch.dict(sys.modules, {"semantica": semantica, "semantica.context": context})
        modules.start()
        self.addCleanup(modules.stop)
        runtime = patch.object(adapter, "check_runtime", return_value={
            "ok": True, "ready": True, "recipe": self.recipe,
            "semantica_version": "0.6.8",
            "runtime": {"python": "synthetic", "semantica": "0.6.8"},
        })
        self.runtime_check = runtime.start()
        self.addCleanup(runtime.stop)

    def write_json(self, filename, value):
        (self.package / filename).write_bytes(pretty_json(value))

    def save_manifest(self):
        self.write_json("manifest.json", self.manifest)

    def reseal_files(self):
        """Update byte integrity while leaving semantic bindings unchanged."""
        self.manifest["files"] = {}
        for filename in ("graph.json", "completion.json", "contract.json", "README.md"):
            raw = (self.package / filename).read_bytes()
            self.manifest["files"][filename] = {"sha256": sha256(raw), "bytes": len(raw)}
        for field, filename in (
            ("graph_hash", "graph.json"), ("receipt_hash", "completion.json"),
            ("contract_hash", "contract.json"),
        ):
            self.manifest[field] = self.manifest["files"][filename]["sha256"]
        self.save_manifest()

    def verify(self):
        return adapter.verify_package(self.package, self.compiler_root)

    def assert_rejected_before_native_load(self):
        with self.assertRaises(ValueError):
            self.verify()
        self.assertEqual([], self.loaded_paths)

    def test_valid_package_reopens_native_graph_and_preserves_authored_source(self):
        proof = self.verify()
        self.assertTrue(proof["ok"])
        self.assertTrue(proof["verified"])
        self.assertTrue(proof["native_reopen"])
        self.assertEqual(4, proof["files_verified"])
        self.assertEqual(adapter.digest(self.binding), proof["generation_id"])
        self.assertEqual(self.binding["revision"], proof["revision"])
        self.assertEqual(self.binding["snapshot_hash"], proof["snapshot_hash"])
        self.assertEqual(2, proof["node_count"])
        self.assertEqual(1, proof["edge_count"])
        self.assertEqual("not checked; exported snapshot only", proof["current_eligibility"])
        self.runtime_check.assert_called_once_with(self.compiler_root)
        self.assertEqual([self.package / "graph.json"], self.loaded_paths)
        token = next(node for node in self.graph["nodes"] if node["type"] == "CorpusToken")
        self.assertEqual("synthetic ambiguous hearing", token["properties"]["source"]["attrs"]["uncertainty"])
        self.assertIsNone(token["properties"]["source"]["start_us"])
        self.assertIsNone(token["properties"]["source"]["normalized"])

    def test_file_hashes_use_raw_bytes_including_json_formatting(self):
        self.assertNotEqual(adapter.digest(self.contract), self.manifest["contract_hash"])
        self.assertNotEqual(adapter.digest(self.completion), self.manifest["receipt_hash"])
        self.assertTrue(self.verify())
        self.assertEqual(1, len(self.loaded_paths))

    def test_payload_tampering_is_rejected_before_native_load(self):
        for filename in ("graph.json", "completion.json", "contract.json", "README.md"):
            with self.subTest(filename=filename):
                path = self.package / filename
                original = path.read_bytes()
                path.write_bytes(original + b" ")
                self.assert_rejected_before_native_load()
                path.write_bytes(original)

    def test_wrong_declared_file_size_is_rejected_before_native_load(self):
        self.manifest["files"]["graph.json"]["bytes"] += 1
        self.save_manifest()
        self.assert_rejected_before_native_load()

    def test_missing_required_file_is_rejected_before_native_load(self):
        (self.package / "README.md").unlink()
        self.assert_rejected_before_native_load()

    def test_extra_file_is_rejected_before_native_load(self):
        (self.package / "unexpected.json").write_text("{}", encoding="utf-8")
        self.assert_rejected_before_native_load()

    def test_extra_directory_is_rejected_before_native_load(self):
        (self.package / "unexpected").mkdir()
        self.assert_rejected_before_native_load()

    def test_unsafe_manifest_file_names_are_rejected_before_native_load(self):
        original = copy.deepcopy(self.manifest)
        for filename in ("../graph.json", "/graph.json", "nested/graph.json", "C:\\graph.json", "..\\graph.json"):
            with self.subTest(filename=filename):
                self.manifest = copy.deepcopy(original)
                self.manifest["files"][filename] = self.manifest["files"]["graph.json"]
                self.save_manifest()
                self.assert_rejected_before_native_load()

    def test_symlink_payload_is_rejected_even_when_bytes_match(self):
        path = self.package / "README.md"
        target = self.root / "outside-readme.md"
        target.write_bytes(path.read_bytes())
        path.unlink()
        try:
            path.symlink_to(target)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"This environment cannot create a synthetic symlink: {error}")
        self.assert_rejected_before_native_load()

    def test_unsupported_manifest_format_or_schema_is_rejected(self):
        original = copy.deepcopy(self.manifest)
        for field, value in (("schema", 2), ("schema", "1"), ("format", "other/graph")):
            with self.subTest(field=field, value=value):
                self.manifest = copy.deepcopy(original)
                self.manifest[field] = value
                self.save_manifest()
                self.assert_rejected_before_native_load()

    def test_manifest_identity_and_provenance_must_match_receipt_and_contract(self):
        original = copy.deepcopy(self.manifest)
        replacements = {
            "generation_id": "0" * 64, "project": "unrelated-project", "revision": 8,
            "snapshot_hash": "0" * 64, "config_hash": "0" * 64,
            "recipe_hash": "0" * 64, "contract_hash": "0" * 64,
            "receipt_hash": "0" * 64, "graph_hash": "0" * 64,
            "mapping_version": "corpus-evidence/1", "adapter_hash": "0" * 64,
            "compiler_version": "semantica/other", "compiler_commit": "0" * 40,
            "compiler_source_hash": "0" * 64, "runtime_hash": "0" * 64,
            "rights": "invented rights", "access_policy": "public",
            "review": {**self.contract["review"], "decision": "rejected"},
            "source_artifacts": {}, "current_at_export": False,
        }
        for field, value in replacements.items():
            with self.subTest(field=field):
                self.manifest = copy.deepcopy(original)
                self.manifest[field] = value
                self.save_manifest()
                self.assert_rejected_before_native_load()

    def test_receipt_binding_is_checked_after_file_integrity_passes(self):
        self.completion["binding"]["revision"] += 1
        self.write_json("completion.json", self.completion)
        self.reseal_files()
        self.assert_rejected_before_native_load()

    def test_receipt_counts_and_anchors_are_checked_after_file_integrity_passes(self):
        original = copy.deepcopy(self.completion)
        mutations = (
            lambda value: value.update(node_count=value["node_count"] + 1),
            lambda value: value.update(edge_count=value["edge_count"] + 1),
            lambda value: value.update(anchors={}),
            lambda value: next(iter(value["anchors"].values())).update(external_id="forged"),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutations.index(mutation)):
                self.completion = copy.deepcopy(original)
                mutation(self.completion)
                self.write_json("completion.json", self.completion)
                self.reseal_files()
                self.assert_rejected_before_native_load()

    def test_native_reopen_must_preserve_node_and_edge_counts(self):
        for nodes, edges in ((-1, 0), (0, -1), (1, 0), (0, 1)):
            with self.subTest(nodes=nodes, edges=edges):
                self.loaded_paths.clear()
                self.native_node_delta, self.native_edge_delta = nodes, edges
                with self.assertRaises(ValueError):
                    self.verify()
                self.assertEqual([self.package / "graph.json"], self.loaded_paths)

    def test_native_reader_failure_is_reported(self):
        self.native_error = ValueError("Synthetic native graph load failure")
        with self.assertRaisesRegex(ValueError, "Native Semantica could not reopen") as rejected:
            self.verify()
        self.assertIs(rejected.exception.__cause__, self.native_error)
        self.assertEqual([self.package / "graph.json"], self.loaded_paths)


class RuntimePreflightTests(unittest.TestCase):
    def setUp(self):
        self.compiler = Path(tempfile.gettempdir()) / "synthetic-compiler-preflight"

    def test_missing_or_wrong_semantica_version_is_actionable(self):
        with patch.object(adapter.importlib.metadata, "version", side_effect=adapter.importlib.metadata.PackageNotFoundError("semantica")):
            with self.assertRaisesRegex(ValueError, "select the existing Semantica 0.6.8 runtime"):
                adapter.effective_recipe(self.compiler)
        with patch.object(adapter.importlib.metadata, "version", return_value="0.6.7"):
            with self.assertRaisesRegex(ValueError, "requires installed Semantica 0.6.8"):
                adapter.effective_recipe(self.compiler)

    def test_incompatible_legacy_four_argument_api_is_rejected(self):
        def old_api(source, config_path, ontology_paths, output_path):
            raise AssertionError("Preflight must not execute compilation")
        with patch.object(adapter.importlib, "import_module", return_value=types.SimpleNamespace(compile_sources=old_api)), patch.object(adapter.inspect, "getfile", return_value=str(self.compiler / "src/open_k_folds_semantic/run.py")):
            with self.assertRaisesRegex(ValueError, "five-argument|observation_paths"):
                adapter.load_compiler(self.compiler)

    def test_compatible_api_is_inspected_without_running_compilation(self):
        def compile_sources(source, config_path, ontology_paths, output_path, observation_paths=()):
            raise AssertionError("Preflight must not execute compilation")
        with patch.object(adapter.importlib, "import_module", return_value=types.SimpleNamespace(compile_sources=compile_sources)), patch.object(adapter.inspect, "getfile", return_value=str(self.compiler / "src/open_k_folds_semantic/run.py")):
            self.assertIs(adapter.load_compiler(self.compiler), compile_sources)

    def test_entrypoint_from_another_checkout_is_rejected(self):
        def compile_sources(source, config_path, ontology_paths, output_path, observation_paths=()):
            raise AssertionError("Preflight must not execute compilation")
        with patch.object(adapter.importlib, "import_module", return_value=types.SimpleNamespace(compile_sources=compile_sources)), patch.object(adapter.inspect, "getfile", return_value=str(self.compiler / "other/run.py")):
            with self.assertRaisesRegex(ValueError, "does not match the selected checkout"):
                adapter.load_compiler(self.compiler)

    def test_dirty_compiler_failure_is_not_reported_as_ready(self):
        with patch.dict(adapter.os.environ, {}, clear=True), patch.object(adapter, "effective_recipe", side_effect=ValueError("Compiler checkout has tracked modifications")), patch.object(adapter, "load_compiler") as compiler:
            with self.assertRaisesRegex(ValueError, "tracked modifications"):
                adapter.check_runtime(self.compiler)
            compiler.assert_not_called()

    def test_external_database_configuration_is_rejected_before_loading(self):
        with patch.dict(adapter.os.environ, {"FALKORDB_HOST": "synthetic.invalid"}), patch.object(adapter, "load_compiler") as compiler:
            with self.assertRaisesRegex(ValueError, "local file-only"):
                adapter.check_runtime(self.compiler)
            compiler.assert_not_called()


if __name__ == "__main__":
    unittest.main()
