"""Optional trusted CWB adapter for the workbench's bounded literal grammar.

No arbitrary CQP input, downloads, canonical writes or imported-index reuse.
UTF-8 values become reversible hex keys so CWB cannot normalize whitespace,
empty readings or Unicode spelling. This does not qualify CQP regex semantics.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time

MAPPING = "literal-utf8-hex/1"


def encoded(value):
    return "n" if value is None else "v" + value.encode("utf-8").hex()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(argv, timeout=30, env=None):
    argv = [str(a) for a in argv]
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0, env=env)
    output = [bytearray(), bytearray()]
    lock = threading.Lock()
    exceeded = threading.Event()
    stopping = threading.Event()
    errors = []
    deadline = time.monotonic() + timeout

    def capture(stream, index):
        try:
            while not stopping.is_set():
                chunk = stream.read(65536)
                if not chunk:
                    break
                with lock:
                    if sum(map(len, output)) + len(chunk) > 8 * 1024 * 1024:
                        exceeded.set()
                    else:
                        output[index].extend(chunk)
                if exceeded.is_set():
                    if process.poll() is None:
                        process.kill()
                    break
        except OSError as error:
            if not stopping.is_set() and not exceeded.is_set():
                errors.append(error)

    threads = [threading.Thread(target=capture, args=(stream, index), daemon=True)
               for index, stream in enumerate((process.stdout, process.stderr))]
    try:
        for thread in threads:
            thread.start()
        process.wait(timeout=max(0, deadline - time.monotonic()))
        for thread in threads:
            thread.join(timeout=max(0, deadline - time.monotonic()))
        if any(thread.is_alive() for thread in threads):
            raise subprocess.TimeoutExpired(argv, timeout)
        if exceeded.is_set():
            raise RuntimeError("adapter output size limit")
        if errors:
            raise errors[0]
    finally:
        stopping.set()
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()
        process.stderr.close()
    result = subprocess.CompletedProcess(argv, process.returncode, bytes(output[0]), bytes(output[1]))
    if result.returncode:
        raise RuntimeError(f"{Path(argv[0]).name} failed: " + result.stderr.decode("utf-8", errors="replace")[:2000])
    return result


def native(binary, store, request, mode):
    return json.loads(run([binary, mode, "--store", store, "--project", json.loads(request.read_text(encoding="utf-8"))["project"], "--request", request], 60).stdout)


def tool_paths(directory):
    suffix = ".exe" if os.name == "nt" else ""
    result = {name: directory / (name + suffix) for name in ["cqp", "cwb-encode", "cwb-makeall"]}
    if not all(path.is_file() for path in result.values()):
        raise RuntimeError("trusted CWB bin directory must contain cqp, cwb-encode and cwb-makeall")
    return result


def index_files(work):
    return {p.relative_to(work).as_posix(): sha(p) for p in sorted(work.rglob("*")) if p.is_file() and p != work / "manifest.json"}


def overlaps(left, right):
    return left == right or left in right.parents or right in left.parents


def validate_paths(binary, store, request, tools, work, out=None):
    protected = [store, request, binary, *[path.parent for path in tools.values()]]
    if not (store / "ledger.sqlite").is_file() or not binary.is_file() or not request.is_file():
        raise RuntimeError("existing authority, native binary and query file required")
    if any(overlaps(work, path) for path in protected):
        raise RuntimeError("derived work directory overlaps canonical/input/tool paths")
    if out is not None and (out.exists() or overlaps(out, work) or any(overlaps(out, path) for path in protected)):
        raise RuntimeError("new report path must be outside canonical/input/tool/work paths")


def projection_rows(projection):
    rows = []
    run_id = 0
    for document in projection["documents"]:
        previous = object()
        for token in document["tokens"]:
            if previous != token["utterance"]:
                run_id += 1
            previous = token["utterance"]
            rows.append({"document": document["path"], "token": token["id"], "internal_id": token["internal_id"], "run": run_id, "original": reading(token, "original"), "corrected": reading(token, "corrected"), "normalized": reading(token, "normalized"), "language": token["language_effective"]})
    return rows


def reading(token, layer):
    corrected = token["corrected"] if token["corrected"] is not None else token["original"]
    if layer == "original":
        return token["original"]
    if layer == "normalized" and token["attrs"].get("wb_normalized_status") != "unresolved" and token["normalized"] is not None:
        return token["normalized"]
    return corrected


def ensure_index(work, projection, tools):
    identity = {name: sha(path) for name, path in tools.items()}
    expected = {"schema": 1, "mapping": MAPPING, "binding": projection["binding"], "tools_sha256": identity, "directory": work.as_posix()}
    if work.exists():
        manifest = json.loads((work / "manifest.json").read_text(encoding="utf-8"))
        if any(manifest.get(key) != value for key, value in expected.items()) or manifest.get("files") != index_files(work):
            raise RuntimeError("stale or modified CWB projection; rebuild in a fresh directory")
        return manifest
    work.mkdir(parents=True)
    (work / "data").mkdir()
    (work / "registry").mkdir()
    mapping = []
    lines = []
    for document in projection["documents"]:
        for token in document["tokens"]:
            mapping.append({"document": document["path"], "token": token["id"], "internal_id": token["internal_id"]})
        opened = False
        previous = object()
        for token in document["tokens"]:
            if not opened or previous != token["utterance"]:
                if opened:
                    lines.append("</run>")
                lines.append("<run>")
                opened = True
            previous = token["utterance"]
            values = [reading(token, "corrected"), reading(token, "original"), reading(token, "normalized"), token["language_effective"], document["path"]]
            lines.append("\t".join(encoded(value) for value in values))
        if opened:
            lines.append("</run>")
    vrt = work / "input.vrt"
    content = "\n".join(lines) + "\n"
    if len(content.encode()) > 128 * 1024 * 1024:
        raise RuntimeError("adapter VRT size limit")
    vrt.write_text(content, encoding="utf-8", newline="\n")
    (work / "mapping.json").write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
    run([tools["cwb-encode"], "-x", "-c", "utf8", "-f", vrt, "-d", work / "data", "-R", work / "registry/wbliteral", "-P", "original", "-P", "normalized", "-P", "language", "-P", "document", "-S", "run"])
    run([tools["cwb-makeall"], "-r", work / "registry", "-M", "64", "-V", "WBLITERAL"])
    version=run([tools["cqp"], "-v"])
    expected["cqp_version"] = (version.stdout+version.stderr).decode("utf-8", errors="replace").strip()
    expected["files"] = index_files(work)
    (work / "manifest.json").write_text(json.dumps(expected, indent=2), encoding="utf-8", newline="\n")
    return expected


def expression(query):
    attribute = {"corrected": "word", "original": "original", "normalized": "normalized"}[query["reading"]]
    terms = []
    for term in query["terms"]:
        conditions = [f'{attribute}="{encoded(term["text"])}"']
        if term["language"] is not None:
            conditions.append(f'language="{encoded(term["language"])}"')
        if query["documents"]:
            conditions.append('document="(' + "|".join(encoded(path) for path in query["documents"]) + ')"')
        terms.append("[" + " & ".join(conditions) + "]")
    return " ".join(terms) + " within run"


def qualify(binary, store, request, tools, work):
    validate_paths(binary, store, request, tools, work)
    raw=request.read_bytes()
    if len(raw)>1_048_576:
        raise RuntimeError("request size limit")
    with tempfile.TemporaryDirectory(prefix="wb-cqp-input-",dir=work.parent) as directory:
        frozen=Path(directory)/"request.json"
        frozen.write_bytes(raw)
        return _qualify_frozen(binary,store,frozen,tools,work)


def _qualify_frozen(binary,store,request,tools,work):
    before = native(binary, store, request, "search")  # validates the full finite grammar before CQP
    query = before["result"]["query"]
    if query.get("span") is not None:
        raise RuntimeError("span constraints are native-only; CQP span joins are unqualified")
    request.write_text(json.dumps(query,ensure_ascii=False),encoding="utf-8")
    projection = native(binary, store, request, "search-projection")
    if projection["binding"]!=before["result"]["binding"]:
        raise RuntimeError("native search/projection binding mismatch")
    manifest = ensure_index(work, projection, tools)
    with tempfile.TemporaryDirectory(prefix="wb-cqp-query-", dir=work.parent) as directory:
        script = Path(directory) / "query.cqp"
        init=Path(directory)/"empty-init.cqp"
        init.write_text("",encoding="ascii")
        script.write_text("WBLITERAL;\nwb_hits = " + expression(query) + ";\ndump wb_hits;\nexit;\n", encoding="ascii")
        environment={**os.environ,"CORPUS_REGISTRY":str(work / "registry")}
        result = run([tools["cqp"], "-m", "-I", init, "-r", work / "registry", "-f", script],env=environment)
    if result.stderr.strip():
        raise RuntimeError("CQP emitted diagnostics: " + result.stderr.decode("utf-8", errors="replace")[:2000])
    positions = []
    for line in result.stdout.decode("ascii").splitlines():
        columns = line.split()
        if not columns:
            continue
        if len(columns) != 4:
            raise RuntimeError("unexpected CQP dump grammar")
        start, end, target, keyword = map(int, columns)
        if start < 0 or end < start or target != -1 or keyword != -1:
            raise RuntimeError("unexpected CQP anchors")
        positions.append((start, end))
    rows=projection_rows(projection)
    previous=-1
    for start,end in positions:
        if start<=previous or end>=len(rows) or end-start+1!=len(query["terms"]):
            raise RuntimeError("invalid CQP position bounds/width/order")
        previous=start
        words=rows[start:end+1]
        if any(word["run"]!=words[0]["run"] or word["document"]!=words[0]["document"] for word in words):
            raise RuntimeError("CQP result crosses a source boundary")
        if query["documents"] and words[0]["document"] not in query["documents"]:
            raise RuntimeError("CQP result violates document scope")
        if any(word[query["reading"]]!=term["text"] or (term["language"] is not None and word["language"]!=term["language"]) for word,term in zip(words,query["terms"],strict=True)):
            raise RuntimeError("CQP result violates literal/language semantics")
    after = native(binary, store, request, "search")  # current head must still match after external work
    if before != after:
        raise RuntimeError("search changed during CQP adapter execution")
    if len(positions) != after["result"]["total"]:
        raise RuntimeError("CQP/native total mismatch")
    mapping = json.loads((work / "mapping.json").read_text(encoding="utf-8"))
    page = positions[query["offset"]:query["offset"] + query["limit"]]
    for positions_hit, hit in zip(page, after["result"]["hits"], strict=True):
        start, end = positions_hit
        source = mapping[start:end+1]
        if (start, end) != (hit["corpus_start"], hit["corpus_end"]) or [word["token"] for word in source] != hit["token_ids"] or any(word["document"] != hit["document"] for word in source):
            raise RuntimeError("CQP/native stable identity mismatch")
    return {"schema": 1, "mapping": MAPPING, "binding": projection["binding"], "result_hash": after["result_hash"], "total": len(positions), "page_hits": len(page), "cqp_expression": expression(query), "index_manifest_sha256": sha(work / "manifest.json"), "tools_sha256": manifest["tools_sha256"], "status": "bounded literal CQP/native parity passed; full CQP parity unverified"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["native", "store", "request", "tools", "work", "out"]:
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    validate_paths(args.native.resolve(),args.store.resolve(),args.request.resolve(),tool_paths(args.tools.resolve()),args.work.resolve(),args.out.resolve())
    report = qualify(args.native.resolve(), args.store.resolve(), args.request.resolve(), tool_paths(args.tools.resolve()), args.work.resolve())
    with args.out.open("x",encoding="utf-8") as file:
        file.write(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": report["status"], "total": report["total"], "evidence": str(args.out)}))


if __name__ == "__main__":
    main()
