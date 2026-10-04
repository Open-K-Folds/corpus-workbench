"""End-to-end synthetic acceptance against installed native Semantica, without a DB/model."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import wave
import struct
import math

spec = importlib.util.spec_from_file_location("handoff", Path(__file__).with_name("semantica-handoff.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def verify(binary, compiler_root, output):
    with tempfile.TemporaryDirectory(prefix="semantica-qa-", dir=output.parent) as temp:
        root = Path(temp)
        package = root / "package"
        (package / "Resources").mkdir(parents=True)
        (package / "xmlfiles").mkdir()
        (package / "Annotations").mkdir()
        (package / "Raw").mkdir()
        (package / "Audio").mkdir()
        audio=package / "Audio/synthetic.wav"
        with wave.open(str(audio),"wb") as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000)
            wav.writeframes(b"".join(struct.pack("<h",int(1000*math.sin(2*math.pi*220*i/16000))) for i in range(128000)))
        (package / "Resources/settings.xml").write_text("<ttsettings unknown='preserve'/>")
        (package / "Raw/asr.raw.json").write_text('{"text":"immutable synthetic draft","word_times":null}')
        (package / "xmlfiles/demo.xml").write_text("<TEI><teiHeader><media url='synthetic.wav'/></teiHeader><text><body><tok id='outside' form='untimed'>untimed</tok><u id='u-1' start='0' end='4'><tok id='w-1' form='e😀' relation_target='#w-3' relation_type='context'>e😀</tok><tok id='w-2' form='mixed'>mixed</tok></u><u id='u-2' start='2' end='6'><tok id='w-3' form='speech'>speech</tok></u></body></text></TEI>", encoding="utf-8")
        (package / "Annotations/review_demo.xml").write_text("<spanGrp><span id='span-1' corresp='#w-1 #w-3' label='synthetic discontinuous'>e speech</span></spanGrp>")
        store = root / "authority"
        def core(*args, authority=store):
            return bridge.core(binary, authority, "synthetic", *args)
        first = core("import", "--package", package)
        def approve(revision):
            return core("review", "--revision", revision, "--decision", "approved", "--note", "Synthetic mechanics; no linguistic judgment")
        def expect_rejection(call, expected):
            try:
                call()
            except Exception as error:
                detail = str(error)
                if isinstance(error, bridge.subprocess.CalledProcessError):
                    detail += error.stderr.decode("utf-8", errors="replace")
                assert expected in detail, detail
                return
            raise AssertionError("Expected rejection")
        expect_rejection(lambda: core("contract", "--revision", first["id"]), "current approved")
        approve(first["id"])
        original_contract = core("contract", "--revision", first["id"])
        r1 = bridge.ingest(binary, store, "synthetic", first["id"], compiler_root, root / "attempt-r1")
        assert r1["node_count"] == 8
        reused = bridge.ingest(binary, store, "synthetic", first["id"], compiler_root, root / "retry-not-created")
        assert reused["reused"] and reused["generation_id"] == r1["generation_id"]
        assert not (root / "retry-not-created").exists()
        graph1 = core("generation", "--id", r1["generation_id"])
        tokens = [node for node in graph1["graph"]["nodes"] if node["properties"]["anchor"]["kind"] == "token"]
        assert len(tokens) == 4 and all(node["properties"]["source"]["start_us"] is None for node in tokens)
        view = core("view")
        command = {"schema":1,"project":"synthetic","command_id":"correction","base_revision":view["revision"]["id"],
                   "preimage_hash":view["revision"]["snapshot_hash"],"config_version":view["snapshot"]["config"]["version"],
                   "label":"Synthetic heard correction","operations":[{"kind":"set_token","document":"xmlfiles/demo.xml","token":"w-1","fields":{"nform":"heard 😀"}}]}
        command_file = root / "command.json"
        command_file.write_bytes(bridge.encoded(command))
        second = core("apply", "--command", command_file)
        assert core("generations") == []
        expect_rejection(lambda: core("generation", "--id", r1["generation_id"]), "current scope")
        assert not core("generation", "--id", r1["generation_id"], "--historical", "yes")["generation"]["current"]
        expect_rejection(lambda: bridge.ingest(binary, store, "synthetic", second["id"], compiler_root, root / "unreviewed"), "current approved")
        expect_rejection(lambda: core("accept-generation", "--receipt", root/"attempt-r1/completion.json", "--graph", root/"attempt-r1/graph.json"), "current approved")
        approve(second["id"])
        r2 = bridge.ingest(binary, store, "synthetic", second["id"], compiler_root, root / "attempt-r2")
        graph2 = core("generation", "--id", r2["generation_id"])
        corrected = next(node for node in graph2["graph"]["nodes"] if node["properties"]["anchor"]["external_id"] == "w-1")
        assert corrected["properties"]["content"] == "heard 😀"
        assert corrected["properties"]["source"]["original"] == "e😀"
        assert corrected["properties"]["source"]["normalized"] is None
        assert len(core("generations")) == 1 and len(core("generations", "--historical", "yes")) == 2
        assert bridge.digest(graph1["contract"]) == graph1["receipt"]["binding"]["contract_hash"]
        assert graph1["graph"] == core("generation", "--id", r1["generation_id"], "--historical", "yes")["graph"]
        # Reject compiler output with fabricated source content or missing evidence.
        graph_file = root / "attempt-r2/graph.json"
        receipt_file = root / "attempt-r2/completion.json"
        graph = json.loads(graph_file.read_text(encoding="utf-8"))
        receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
        graph["nodes"][0]["properties"]["source"] = {"invented": True}
        bad_graph = root / "bad-graph.json"
        bad_graph.write_bytes(bridge.encoded(graph))
        receipt["graph_hash"] = bridge.hashlib.sha256(bad_graph.read_bytes()).hexdigest()
        bad_receipt = root / "bad-completion.json"
        bad_receipt.write_bytes(bridge.encoded(receipt))
        expect_rejection(lambda: core("accept-generation", "--receipt", bad_receipt, "--graph", bad_graph), "source projection mismatch")
        assert len(core("generations")) == 1
        backup = root / "backup"
        # backup is a human-readable CLI operation, not JSON.
        bridge.subprocess.run([str(binary),"backup","--store",str(store),"--out",str(backup)],check=True,capture_output=True)
        assert core("generation", "--id", r2["generation_id"], authority=backup)["graph"] == graph2["graph"]
        core("review", "--revision", second["id"], "--decision", "rejected", "--note", "Synthetic retraction")
        assert core("generations") == []
        expect_rejection(lambda: core("generation", "--id", r2["generation_id"]), "current scope")
        assert len(core("generations", "--historical", "yes")) == 2
        # Each supported annotation mutation must invalidate the old default
        # graph before a fresh exact review and native compiler generation.
        previous = r2
        annotation_generations = []
        operations = [
            {"kind":"set_span","document":"xmlfiles/demo.xml","sidecar":"Annotations/review_demo.xml","id":"span-1","fields":{"label":"repaired synthetic span"},"anchor":{"kind":"tokens","token_ids":["w-2","w-3"]}},
            {"kind":"set_relation","document":"xmlfiles/demo.xml","from":"w-1","to":"#w-2","relation_type":"repaired-context","note":None},
            {"kind":"clear_relation","document":"xmlfiles/demo.xml","from":"w-1"},
        ]
        for index, operation in enumerate(operations):
            view = core("view")
            command = {"schema":1,"project":"synthetic","command_id":f"annotation-{index}","base_revision":view["revision"]["id"],
                       "preimage_hash":view["revision"]["snapshot_hash"],"config_version":view["snapshot"]["config"]["version"],
                       "label":"Synthetic reference repair","operations":[operation]}
            command_file.write_bytes(bridge.encoded(command))
            revision = core("apply", "--command", command_file)
            assert core("generations") == []
            expect_rejection(lambda: core("generation", "--id", previous["generation_id"]), "current scope")
            approve(revision["id"])
            result = bridge.ingest(binary, store, "synthetic", revision["id"], compiler_root, root / f"annotation-{index}")
            current = core("generation", "--id", result["generation_id"])
            span = next(n for n in current["graph"]["nodes"] if n["properties"]["anchor"]["kind"] == "span")
            token = next(n for n in current["graph"]["nodes"] if n["properties"]["anchor"]["external_id"] == "w-1")
            assert span["properties"]["source"]["token_ids"] == ["w-2","w-3"]
            assert span["properties"]["source"]["fields"]["label"] == "repaired synthetic span"
            assert result["node_count"] == 8 and result["edge_count"] == (12 if index == 2 else 13)
            if index == 1:
                assert token["properties"]["source"]["attrs"]["relation_target"] == "#w-2"
            if index == 2:
                assert "relation_target" not in token["properties"]["source"]["attrs"]
            assert current["contract"]["artifact_manifest"]["Raw/asr.raw.json"] == original_contract["artifact_manifest"]["Raw/asr.raw.json"]
            assert current["contract"]["artifact_manifest"]["Audio/synthetic.wav"] == original_contract["artifact_manifest"]["Audio/synthetic.wav"]
            annotation_generations.append(result["generation_id"])
            previous = result
        assert graph1["graph"] == core("generation", "--id", r1["generation_id"], "--historical", "yes")["graph"]
        # Qualified identities must survive repeated bare IDs in different
        # documents and sidecars in the actual native compiler, not only fixtures.
        duplicate_package=root/"duplicate-package"
        for directory in ["Resources","xmlfiles","Annotations"]:(duplicate_package/directory).mkdir(parents=True)
        (duplicate_package/"Resources/settings.xml").write_text("<ttsettings/>")
        for name in ["demo","other"]:
            (duplicate_package/f"xmlfiles/{name}.xml").write_text("<TEI><text><tok id='same-token' form='SYNTHETIC'>SYNTHETIC</tok></text></TEI>")
        for name in ["first_demo","second_demo","first_other"]:
            (duplicate_package/f"Annotations/{name}.xml").write_text(f"<spanGrp><span id='same-span' corresp='#same-token' label='{name}'/></spanGrp>")
        duplicate_store=root/"duplicate-authority"
        dr=core("import","--package",duplicate_package,authority=duplicate_store)
        core("review","--revision",dr["id"],"--decision","approved","--note","Synthetic qualified identity fixture",authority=duplicate_store)
        expect_rejection(lambda:core("contract","--revision",dr["id"],authority=duplicate_store),"ambiguous span IDs")
        qualified=bridge.ingest(binary,duplicate_store,"synthetic",dr["id"],compiler_root,root/"qualified-v2")
        actual=core("generation","--id",qualified["generation_id"],authority=duplicate_store)
        assert qualified["node_count"]==7 and qualified["edge_count"]==8
        token_nodes=[n for n in actual["graph"]["nodes"] if n["properties"]["anchor"]["kind"]=="token"]
        span_nodes=[n for n in actual["graph"]["nodes"] if n["properties"]["anchor"]["kind"]=="span"]
        assert len(token_nodes)==2 and len({n["id"] for n in token_nodes})==2
        assert len(span_nodes)==3 and len({n["id"] for n in span_nodes})==3
        for n in span_nodes:
            anchor=n["properties"]["anchor"]
            assert n["properties"]["artifact_hash"]==actual["contract"]["artifact_manifest"][anchor["sidecar"]]["sha256"]
            assert n["properties"]["transcript_hash"]==actual["contract"]["artifact_manifest"][anchor["document"]]["sha256"]
        assert actual["receipt"]["binding"]["recipe"]["mapping_version"]=="corpus-evidence/2"
        # Structural evidence is a separate closed-dialect fixture. The richer
        # ASR/media fixture above remains immutable and intentionally unsupported
        # for structural mutation until its carrier decoders are proved.
        structural_package=root/"structural-package"
        for directory in ["Resources","xmlfiles","Annotations"]:(structural_package/directory).mkdir(parents=True)
        (structural_package/"Resources/settings.xml").write_text("<ttsettings/>")
        (structural_package/"xmlfiles/demo.xml").write_text("<TEI><text><u id='u1' start='0' end='5'><tok id='w1' form='é🙂x' nform='a🙂bc' wb_normalized='A🙂BC' variety='local'>é🙂x</tok><tok id='w2' form='two' relation_target='#w1' relation_type='context'>two</tok><tok id='w3' form='three'>three</tok></u></text></TEI>",encoding="utf-8")
        (structural_package/"Annotations/review_demo.xml").write_text("<spanGrp><span id='s1' corresp='#w1 #w3'/><span id='s2' corresp='#w1' wb_start='1' wb_end='2' wb_coordinate='unicode-codepoint' wb_layer='corrected' wb_quote='🙂' wb_status='resolved'/></spanGrp>",encoding="utf-8")
        structural_store=root/"structural-authority"
        sr=core("import","--package",structural_package,authority=structural_store)
        core("review","--revision",sr["id"],"--decision","approved","--note","Synthetic structural fixture",authority=structural_store)
        initial=bridge.ingest(binary,structural_store,"synthetic",sr["id"],compiler_root,root/"structure-initial")
        initial_graph=core("generation","--id",initial["generation_id"],authority=structural_store)
        structural_generations=[initial]
        def structural_edit(ids, replacement, endpoint, name):
            view=core("view",authority=structural_store)
            inv=core("inventory",authority=structural_store)
            request={"schema":1,"project":"synthetic","revision":inv["revision"],"snapshot_hash":inv["snapshot_hash"],"config_hash":inv["config_hash"],"inventory_hash":bridge.digest(inv),"document":"xmlfiles/demo.xml","targets":[next(t for t in inv["ids"] if t["artifact"]=="xmlfiles/demo.xml" and t["id"]==id) for id in ids],"replacement":replacement,"relation_endpoint":endpoint}
            request_file=root/f"{name}-request.json";request_file.write_bytes(bridge.encoded(request))
            proof=core("retokenize-preview","--request",request_file,authority=structural_store)
            assert proof["preview"]["execution_enabled"], proof["preview"]["blockers"]
            command={"schema":1,"project":"synthetic","command_id":name,"base_revision":view["revision"]["id"],"preimage_hash":view["revision"]["snapshot_hash"],"config_version":view["snapshot"]["config"]["version"],"label":name,"operations":[{"kind":"retokenize","request":request,"preview_hash":proof["preview_hash"]}]}
            command_file=root/f"{name}-command.json";command_file.write_bytes(bridge.encoded(command))
            revision=core("apply","--command",command_file,authority=structural_store)
            assert revision["snapshot_hash"]==proof["preview"]["candidate_snapshot_hash"]
            assert core("generations",authority=structural_store)==[]
            assert core("generation","--id",initial["generation_id"],"--historical","yes",authority=structural_store)["graph"]==initial_graph["graph"]
            expect_rejection(lambda:bridge.ingest(binary,structural_store,"synthetic",revision["id"],compiler_root,root/f"{name}-unapproved"),"current approved")
            core("review","--revision",revision["id"],"--decision","approved","--note","Synthetic remapping reviewed",authority=structural_store)
            result=bridge.ingest(binary,structural_store,"synthetic",revision["id"],compiler_root,root/name)
            actual=core("generation","--id",result["generation_id"],authority=structural_store)
            assert all(n["properties"]["source"]["start_us"] is None for n in actual["graph"]["nodes"] if n["properties"]["anchor"]["kind"]=="token")
            structural_generations.append(result)
            return actual
        split_graph=structural_edit(["w1"],[{"id":"part-a","original":"é🙂","corrected":"a🙂","normalized":"A🙂"},{"id":"part-b","original":"x","corrected":"bc","normalized":"BC"}],"part-b","structure-split")
        split_ids={n["properties"]["anchor"]["external_id"] for n in split_graph["graph"]["nodes"] if n["properties"]["anchor"]["kind"]=="token"}
        assert split_ids=={"part-a","part-b","w2","w3"}
        merged_graph=structural_edit(["part-a","part-b"],[{"id":"merged","original":"é🙂x","corrected":"a🙂bc","normalized":"A🙂BC"}],None,"structure-merge")
        merged=next(n for n in merged_graph["graph"]["nodes"] if n["properties"]["anchor"]["external_id"]=="merged")
        assert merged["properties"]["source"]["normalized"]=="A🙂BC" and merged["properties"]["source"]["original"]=="é🙂x"
        assert len(core("generations","--historical","yes",authority=structural_store))==3
        evidence = {"synthetic_only":True,"semantica_version":"0.6.8","compiler_commit":bridge.compiler_identity(compiler_root)[0],
                    "mapping":"corpus-evidence/2","nodes_per_generation":r2["node_count"],"edges_per_generation":r2["edge_count"],
                    "initial_ingestion":True,"native_reopen":True,"retry_reuses_one_generation":True,"correction_stales_prior_default_query":True,
                    "unreviewed_dispatch_denied":True,"stale_completion_denied":True,"reviewed_correction_visible":True,
                    "historical_generation_unchanged":True,"forged_projection_rejected":True,"backup_restore_graph_equal":True,
                    "review_retraction_filters_current":True,"missing_word_times_preserved":True,
                    "r1_generation":r1["generation_id"],"r2_generation":r2["generation_id"],"audio_artifact_hash":original_contract["artifact_manifest"]["Audio/synthetic.wav"]["sha256"],"hash_prefixed_relation":True,"raw_artifact_hash":original_contract["artifact_manifest"]["Raw/asr.raw.json"]["sha256"],
                    "annotation_generations":annotation_generations,"annotation_mutations_stale_current":True,
                    "repaired_span_and_relation_in_native_graph":True,"cleared_relation_removes_authored_edge":True,
                    "qualified_identity_generation":{"nodes":7,"edges":8,"token_ids_repeat_across_documents":True,"span_ids_repeat_across_sidecars":True,"sidecar_and_transcript_artifacts_bound":True},
                    "structural_generations":[{"nodes":g["node_count"],"edges":g["edge_count"]} for g in structural_generations],"split_merge_exact_native_generations":True,"retired_compiler_graph_unchanged":True,
                    "external_database":False,"model":None,"real_pilot_ingested":False}
        output.write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf-8")
        return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary",type=Path,required=True)
    parser.add_argument("--compiler-root",type=Path,required=True)
    parser.add_argument("--evidence",type=Path,required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.binary.resolve(), args.compiler_root.resolve(), args.evidence.resolve())))
