"""Hand-labeled synthetic literal-query comparison with real optional CQP tools."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native", "tools", "out"]:
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    out = args.out.resolve()
    if out.exists():
        raise RuntimeError("new synthetic output directory required")
    out.mkdir(parents=True)
    native = args.native.resolve()
    specification = importlib.util.spec_from_file_location("literal_adapter", Path(__file__).with_name("cqp-literal-adapter.py"))
    adapter = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(adapter)
    tools = adapter.tool_paths(args.tools.resolve())
    package = out / "package"
    for folder in ["Resources", "xmlfiles"]:
        (package / folder).mkdir(parents=True)
    (package / "Resources/settings.xml").write_text("<ttsettings/>", encoding="utf-8")
    (package / "xmlfiles/a.xml").write_text("<TEI><teiHeader><title>SYNTHETIC literal query contract</title></teiHeader><text><u id='u1' start='1' end='3' variety='custom'><tok id='a1' form='raw' nform='é' wb_normalized='é'>raw</tok><tok id='a2' form='🙂'>🙂</tok><tok id='a3' form='again'>again</tok></u><u id='u2' start='2' end='5'><tok id='a4' form='again'>again</tok><tok id='a5' form='again'>again</tok><tok id='a6' form='again'>again</tok></u><u id='u3'><tok id='a7' form='a.b'>a.b</tok><tok id='a8' form='quote&amp;apos;'>quote&amp;apos;</tok><tok id='a9' form='&quot;; exit;'>literal</tok><tok id='a10' form='x&#x9;y'>tab</tok><tok id='a11' form='raw-empty' nform='' wb_normalized=''>raw-empty</tok><tok id='a12' form='other' nform='reviewed' wb_normalized='stale' wb_normalized_status='unresolved'>other</tok></u></text></TEI>", encoding="utf-8")
    (package / "xmlfiles/b.xml").write_text("<TEI><text><tok id='a1' form='again'>again</tok><tok id='b2' form='é'>é</tok><tok id='b3' form='🙂'>🙂</tok></text></TEI>", encoding="utf-8")
    store = out / "authority"
    subprocess.run([str(native), "import", "--store", str(store), "--project", "literal-qualification", "--package", str(package)], check=True, capture_output=True)
    view = json.loads(subprocess.check_output([str(native), "view", "--store", str(store), "--project", "literal-qualification"]))
    base = {"schema": 1, "project": "literal-qualification", "revision": view["revision"]["id"], "snapshot_hash": view["revision"]["snapshot_hash"], "mode": "current", "reading": "corrected", "terms": [], "documents": [], "context": 2, "offset": 0, "limit": 50}
    a, b = "xmlfiles/a.xml", "xmlfiles/b.xml"
    cases = [
        ("corrected-unicode", ["é", "🙂"], "corrected", None, [], [(a, ["a1", "a2"]), (b, ["b2", "b3"])]),
        ("original-unicode", ["é", "🙂"], "original", None, [], [(b, ["b2", "b3"])]),
        ("normalized-composed", ["é", "🙂"], "normalized", None, [], [(b, ["b2", "b3"])]),
        ("normalized-combining", ["é", "🙂"], "normalized", None, [], [(a, ["a1", "a2"])]),
        ("original-raw", ["raw"], "original", None, [], [(a, ["a1"])]),
        ("corrected-excludes-raw", ["raw"], "corrected", None, [], []),
        ("exact-language", ["é", "🙂"], "corrected", "custom", [], [(a, ["a1", "a2"])]),
        ("unknown-language-excluded", ["é", "🙂"], "corrected", "unknown", [], []),
        ("document-filter", ["é", "🙂"], "corrected", None, [b], [(b, ["b2", "b3"])]),
        ("language-before-filtered-count", ["é", "🙂"], "corrected", "custom", [b], []),
        ("overlapping-phrase-within-runs", ["again", "again"], "corrected", None, [], [(a, ["a4", "a5"]), (a, ["a5", "a6"])]),
        ("no-cross-document-phrase", ["again", "é"], "corrected", None, [], [(b, ["a1", "b2"])]),
        ("literal-regex-meta", ["a.b"], "corrected", None, [], [(a, ["a7"])]),
        ("regex-is-not-a-query", [".*"], "corrected", None, [], []),
        ("literal-entity-spelling", ["quote&apos;"], "corrected", None, [], [(a, ["a8"])]),
        ("literal-command-looking-token", ['"; exit;'], "corrected", None, [], [(a, ["a9"])]),
        ("literal-tab-token", ["x\ty"], "corrected", None, [], [(a, ["a10"])]),
        ("empty-correction-has-no-original-fallback", ["raw-empty"], "corrected", None, [], []),
        ("unresolved-normalization-excluded", ["stale"], "normalized", None, [], []),
        ("unresolved-normalization-fallback", ["reviewed"], "normalized", None, [], [(a, ["a12"])]),
        ("case-is-exact", ["É"], "corrected", None, [], []),
    ]
    reports = []
    index = out / "derived-index"
    request = out / "request.json"
    for name, words, layer, language, documents, expected in cases:
        query = {**base, "reading": layer, "terms": [{"text": word, "language": language} for word in words], "documents": documents}
        request.write_text(json.dumps(query, ensure_ascii=False), encoding="utf-8")
        result = adapter.native(native, store, request, "search")
        actual = [(hit["document"], hit["token_ids"]) for hit in result["result"]["hits"]]
        assert actual == expected, (name, actual, expected)
        report = adapter.qualify(native, store, request, tools, index)
        reports.append({"case": name, "expected": expected, **report})
    query = {**base, "terms": [{"text": "again", "language": None}], "offset": 1, "limit": 1}
    request.write_text(json.dumps(query), encoding="utf-8")
    reports.append({"case": "exact-page", **adapter.qualify(native, store, request, tools, index)})
    registry = index / "registry/wbliteral"
    queried = json.loads(subprocess.check_output([str(native), "view", "--store", str(store), "--project", base["project"]]))
    assert queried == view, "queries changed canonical authority or index status"
    original_registry = registry.read_bytes()
    registry.write_bytes(original_registry + b"\n# synthetic integrity test\n")
    try:
        adapter.qualify(native, store, request, tools, index)
        raise AssertionError("modified index was accepted")
    except RuntimeError as error:
        assert "modified CWB projection" in str(error)
    finally:
        registry.write_bytes(original_registry)
    command = {"schema": 1, "project": base["project"], "command_id": "qualification-edit", "base_revision": base["revision"], "preimage_hash": base["snapshot_hash"], "config_version": view["snapshot"]["config"]["version"], "label": "Synthetic correction after search", "operations": [{"kind": "set_token", "document": a, "token": "a1", "fields": {"nform": "changed"}}]}
    command_path = out / "command.json"
    command_path.write_text(json.dumps(command), encoding="utf-8")
    subprocess.run([str(native), "apply", "--store", str(store), "--command", str(command_path)], check=True, capture_output=True)
    try:
        adapter.qualify(native, store, request, tools, index)
        raise AssertionError("stale current request accepted")
    except RuntimeError as error:
        assert "stale" in str(error)
    current = json.loads(subprocess.check_output([str(native), "view", "--store", str(store), "--project", base["project"]]))
    latest = {**query, "revision": current["revision"]["id"], "snapshot_hash": current["revision"]["snapshot_hash"]}
    request.write_text(json.dumps(latest), encoding="utf-8")
    try:
        adapter.qualify(native, store, request, tools, index)
        raise AssertionError("old index accepted for changed evidence")
    except RuntimeError as error:
        assert "stale or modified CWB projection" in str(error)
    historical = {**query, "mode": "historical"}
    request.write_text(json.dumps(historical), encoding="utf-8")
    reports.append({"case": "explicit-historical-index-reuse", **adapter.qualify(native, store, request, tools, index)})
    assert current["snapshot"]["files"]["xmlfiles/b.xml"] == view["snapshot"]["files"]["xmlfiles/b.xml"]
    final = {"synthetic_only": True, "native_binary_sha256": hashlib.sha256(native.read_bytes()).hexdigest(), "selected_cqp_cases": len(reports), "index_tamper_rejected": True, "stale_current_rejected": True, "changed_revision_index_reuse_rejected": True, "canonical_index_status_not_changed_by_queries": True, "reports": reports, "limits": "UTF-8 hex-key exact tokens only; no original TEITOK byte-offset/index/query, regex, case folding, arbitrary CQP or full parity qualification"}
    evidence = out / "evidence.local.json"
    evidence.write_text(json.dumps(final, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"cases": len(reports), "status": "passed", "evidence": str(evidence)}))


if __name__ == "__main__":
    main()
