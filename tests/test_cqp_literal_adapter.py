"""Independent adapter falsification with real native, synthetic authorities.

Only external CQP output and index construction are injected. This suite proves
the adapter boundary; real CWB interoperability requires separate qualification.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
DOC = "xmlfiles/demo.xml"


class AdapterBoundary(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        suffix = ".exe" if os.name == "nt" else ""
        cls.binary = Path(os.environ.get("WB_NATIVE_BINARY", ROOT / "target/debug" / ("corpus-workbench" + suffix))).resolve()
        if not cls.binary.is_file():
            raise RuntimeError("Build the native binary or set WB_NATIVE_BINARY before running adapter tests")

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wb-independent-cqp-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        package = self.root / "package"
        (package / "xmlfiles").mkdir(parents=True)
        (package / "Resources").mkdir()
        (package / "Resources/settings.xml").write_text("<ttsettings/>", encoding="utf-8")
        (package / DOC).write_text(
            "<TEI><text><u id='u1'><tok id='w0' form='a' variety='custom'/><tok id='w1' form='b'/></u>"
            "<u id='u2'><tok id='w2' form='a'/><tok id='w3' form='\U0001f642'/><tok id='w4' form='&quot;; exit;'/></u></text></TEI>",
            encoding="utf-8",
        )
        (package / "xmlfiles/z.xml").write_text("<TEI><text><tok id='w0' form='else'/></text></TEI>", encoding="utf-8")
        self.store = self.root / "authority"
        self.cli("import", "--package", package)
        self.initial = json.loads(self.cli("view").stdout)
        self.query = {
            "schema": 1, "project": "adapter-review", "revision": self.initial["revision"]["id"],
            "snapshot_hash": self.initial["revision"]["snapshot_hash"], "mode": "current",
            "reading": "original", "terms": [{"text": "a", "language": None}],
            "documents": [], "context": 0, "offset": 0, "limit": 1,
        }
        self.request = self.root / "request.json"
        self.write_request()
        specification = importlib.util.spec_from_file_location("independent_literal_adapter", ROOT / "scripts/cqp-literal-adapter.py")
        self.adapter = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.adapter)
        self.real_run = self.adapter.run
        self.real_native = self.adapter.native
        tools_directory = self.root / "tools"
        tools_directory.mkdir()
        suffix = ".exe" if os.name == "nt" else ""
        self.tools = {name: tools_directory / (name + suffix) for name in ["cqp", "cwb-encode", "cwb-makeall"]}
        for path in self.tools.values():
            path.write_bytes(b"SYNTHETIC external result injection, never executed")
        self.dump = b"0 0 -1 -1\n2 2 -1 -1\n"
        self.external_scripts = []
        self.native_requests = []
        self.index_number = 0
        self.adapter.run = self.injected_run
        self.adapter.ensure_index = self.synthetic_index

    def cli(self, *args):
        return subprocess.run(
            [str(self.binary), *map(str, args), "--store", str(self.store), "--project", "adapter-review"],
            capture_output=True, check=True, timeout=15,
        )

    def write_request(self):
        self.request.write_text(json.dumps(self.query, indent=2, ensure_ascii=False), encoding="utf-8")

    def injected_run(self, argv, timeout=30, env=None):
        if Path(argv[0]).resolve() == self.binary:
            request = Path(argv[argv.index("--request") + 1])
            self.native_requests.append((argv[1], request, json.loads(request.read_text(encoding="utf-8"))))
            return self.real_run(argv, timeout=timeout, env=env)
        self.assertEqual(Path(argv[0]), self.tools["cqp"])
        self.external_scripts.append(Path(argv[argv.index("-f") + 1]).read_text(encoding="ascii"))
        return SimpleNamespace(stdout=self.dump, stderr=b"", returncode=0)

    def synthetic_index(self, work, projection, tools):
        # The index is external to the authority. Canonical identity mapping comes
        # from the actual native projection, never invented test hit identities.
        work.mkdir()
        mapping = [
            {"document": document["path"], "token": token["id"], "internal_id": token["internal_id"]}
            for document in projection["documents"] for token in document["tokens"]
        ]
        (work / "mapping.json").write_text(json.dumps(mapping), encoding="utf-8")
        identities = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in tools.items()}
        manifest = {"binding": projection["binding"], "tools_sha256": identities}
        (work / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def qualify(self):
        self.index_number += 1
        return self.adapter.qualify(self.binary, self.store, self.request, self.tools, self.root / f"index-{self.index_number}")

    def historical_pair(self):
        command = {
            "schema": 1, "project": "adapter-review", "command_id": "synthetic-update",
            "base_revision": self.initial["revision"]["id"], "preimage_hash": self.initial["revision"]["snapshot_hash"],
            "config_version": self.initial["snapshot"]["config"]["version"], "label": "Synthetic different projection",
            "operations": [{"kind": "set_token", "document": DOC, "token": "w1", "fields": {"nform": "corrected"}}],
        }
        command_path = self.root / "command.json"
        command_path.write_text(json.dumps(command), encoding="utf-8")
        self.cli("apply", "--command", command_path)
        current = json.loads(self.cli("view").stdout)
        self.query["mode"] = "historical"
        self.write_request()
        return dict(self.query, revision=current["revision"]["id"], snapshot_hash=current["revision"]["snapshot_hash"])

    def test_valid_complete_hit_set_and_exact_selected_page(self):
        original = self.request.read_bytes()
        report = self.qualify()
        self.assertEqual((report["total"], report["page_hits"]), (2, 1))
        self.assertEqual(report["binding"]["revision"], self.query["revision"])
        self.assertEqual(report["binding"]["snapshot_hash"], self.query["snapshot_hash"])
        self.assertEqual(self.request.read_bytes(), original)
        self.assertEqual([mode for mode, _, _ in self.native_requests], ["search", "search-projection", "search"])
        self.assertTrue(all(path != self.request and query == self.query for _, path, query in self.native_requests))
        after = json.loads(self.cli("view").stdout)
        self.assertEqual(after["revision"], self.initial["revision"])
        self.assertEqual(after["snapshot"], self.initial["snapshot"])

    def test_offpage_unmapped_position_is_rejected(self):
        self.dump = b"0 0 -1 -1\n500 500 -1 -1\n"
        with self.assertRaisesRegex(RuntimeError, "bounds"):
            self.qualify()

    def test_offpage_wrong_literal_is_rejected(self):
        self.dump = b"0 0 -1 -1\n1 1 -1 -1\n"
        with self.assertRaisesRegex(RuntimeError, "literal/language"):
            self.qualify()

    def test_duplicate_and_reversed_positions_are_rejected(self):
        for dump in [b"0 0 -1 -1\n0 0 -1 -1\n", b"2 2 -1 -1\n0 0 -1 -1\n"]:
            with self.subTest(dump=dump):
                self.dump = dump
                with self.assertRaisesRegex(RuntimeError, "order"):
                    self.qualify()

    def test_width_and_unsupported_anchors_are_rejected(self):
        for dump in [b"0 1 -1 -1\n", b"-1 0 -1 -1\n", b"0 0 0 -1\n", b"0 0 -1 0\n"]:
            with self.subTest(dump=dump):
                self.dump = dump
                with self.assertRaises(RuntimeError):
                    self.qualify()

    def test_cross_utterance_match_is_rejected(self):
        self.query["terms"] = [{"text": "b", "language": None}, {"text": "a", "language": None}]
        self.write_request()
        self.dump = b"1 2 -1 -1\n"
        with self.assertRaisesRegex(RuntimeError, "source boundary"):
            self.qualify()

    def test_offpage_language_mismatch_is_rejected_even_when_page_is_empty(self):
        self.query["terms"][0]["language"] = "custom"
        self.query["offset"] = 1
        self.write_request()
        self.dump = b"2 2 -1 -1\n"
        with self.assertRaisesRegex(RuntimeError, "literal/language"):
            self.qualify()

    def test_offpage_foreign_document_is_rejected(self):
        self.query["documents"] = [DOC]
        self.write_request()
        self.dump = b"0 0 -1 -1\n5 5 -1 -1\n"
        with self.assertRaisesRegex(RuntimeError, "document scope"):
            self.qualify()

    def test_original_request_mutation_cannot_change_frozen_revision(self):
        changed = self.historical_pair()
        def mutate_original(binary, store, frozen, mode):
            if mode == "search-projection":
                self.request.write_text(json.dumps(changed), encoding="utf-8")
                try:
                    return self.real_native(binary, store, frozen, mode)
                finally:
                    self.write_request()
            return self.real_native(binary, store, frozen, mode)
        self.adapter.native = mutate_original
        report = self.qualify()
        self.assertEqual(report["binding"]["revision"], self.query["revision"])
        self.assertNotEqual(report["binding"]["revision"], changed["revision"])
        self.assertTrue(all(query == self.query for _, _, query in self.native_requests))

    def test_real_foreign_revision_projection_is_rejected_before_index_creation(self):
        changed = self.historical_pair()
        foreign = self.root / "foreign-query.json"
        foreign.write_text(json.dumps(changed), encoding="utf-8")
        def different_projection(binary, store, frozen, mode):
            return self.real_native(binary, store, foreign if mode == "search-projection" else frozen, mode)
        self.adapter.native = different_projection
        with self.assertRaisesRegex(RuntimeError, "binding mismatch"):
            self.qualify()
        self.assertFalse((self.root / "index-1").exists())

    def test_canonical_input_tool_and_existing_output_paths_are_rejected(self):
        work = self.root / "derived"
        ledger = self.store / "ledger.sqlite"
        original = ledger.read_bytes()
        for target in [ledger, self.request, self.binary, self.tools["cqp"], work / "report.json"]:
            with self.subTest(target=target), self.assertRaises(RuntimeError):
                self.adapter.validate_paths(self.binary, self.store, self.request, self.tools, work, target)
        for target in [self.store / "index", self.root, self.tools["cqp"].parent / "index"]:
            with self.subTest(work=target), self.assertRaises(RuntimeError):
                self.adapter.validate_paths(self.binary, self.store, self.request, self.tools, target)
        self.assertEqual(ledger.read_bytes(), original)

    def test_report_created_during_qualification_is_never_overwritten(self):
        output = self.root / "report.json"
        sentinel = b"SYNTHETIC concurrent writer must remain"
        real_qualify = self.adapter.qualify
        def competing_report(*args):
            report = real_qualify(*args)
            output.write_bytes(sentinel)
            return report
        self.adapter.qualify = competing_report
        argv = ["adapter", "--native", str(self.binary), "--store", str(self.store), "--request", str(self.request),
                "--tools", str(self.tools["cqp"].parent), "--work", str(self.root / "derived"), "--out", str(output)]
        with patch.object(sys, "argv", argv), self.assertRaises(FileExistsError):
            self.adapter.main()
        self.assertEqual(output.read_bytes(), sentinel)

    def test_unknown_native_query_fields_fail_before_any_external_query(self):
        self.query["terms"][0]["execute"] = "arbitrary CQP must not be accepted"
        self.write_request()
        with self.assertRaisesRegex(RuntimeError, "failed"):
            self.qualify()
        self.assertFalse(self.external_scripts)
        self.assertFalse((self.root / "index-1").exists())

    def test_command_looking_literal_only_reaches_cqp_as_hex_data(self):
        self.query["terms"] = [{"text": '\"; exit;', "language": None}]
        self.write_request()
        self.dump = b"4 4 -1 -1\n"
        report = self.qualify()
        self.assertEqual(report["total"], 1)
        self.assertEqual(len(self.external_scripts), 1)
        self.assertNotIn('\"; exit;', self.external_scripts[0])
        self.assertIn('original="v223b20657869743b"', self.external_scripts[0])


if __name__ == "__main__":
    unittest.main()
