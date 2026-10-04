use corpus_workbench::{
    handoff::{digest, Anchor, Binding, Completion, Recipe},
    model::{Command, Operation},
    package,
    store::{Fault, Store},
};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;

fn fixture() -> (TempDir, Store, Completion, Vec<u8>) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        input.join("xmlfiles/demo.xml"),
        "<TEI><text><tok id='w-1' form='original'>original</tok></text></TEI>",
    )
    .unwrap();
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    let revision = s.import(&input, "p").unwrap();
    s.review(
        "local-owner",
        "p",
        revision.id,
        &revision.snapshot_hash,
        "approved",
        "Synthetic fixture",
    )
    .unwrap();
    let contract = s.approved_contract("p", revision.id).unwrap();
    let recipe = Recipe {
        mapping_version: "corpus-evidence/1".into(),
        adapter_hash: "a".repeat(64),
        compiler_commit: "b".repeat(40),
        compiler_source_hash: "c".repeat(64),
        compiler_version: "semantica/0.6.8".into(),
        runtime_hash: "d".repeat(64),
        ontology_hash: "e".repeat(64),
        model_hash: "f".repeat(64),
        options: BTreeMap::from([
            (
                "extraction".into(),
                "none; authored evidence mapping".into(),
            ),
            ("access".into(), "local-only".into()),
        ]),
    };
    let binding = Binding {
        schema: 1,
        authority: "research-intelligence".into(),
        project: "p".into(),
        revision: revision.id,
        snapshot_hash: revision.snapshot_hash,
        config_hash: contract["config_hash"].as_str().unwrap().into(),
        contract_hash: digest(&contract).unwrap(),
        recipe,
    };
    let lineage = json!({"project_id":"p","revision":revision.id,"bundle_hash":binding.snapshot_hash,"config_hash":binding.config_hash,"contract_hash":binding.contract_hash,"recipe_hash":digest(&binding.recipe).unwrap(),"access_policy":"local-only"});
    let doc = &contract["documents"][0];
    let document_source = json!({"path":doc["path"],"title":doc["title"],"media":doc["media"],"metadata":doc["metadata"],"opaque_elements":doc["opaque_elements"]});
    let anchors = BTreeMap::from([
        (
            "d".into(),
            Anchor {
                document: "xmlfiles/demo.xml".into(),
                kind: "document".into(),
                external_id: "xmlfiles/demo.xml".into(),
                sidecar: None,
            },
        ),
        (
            "t".into(),
            Anchor {
                document: "xmlfiles/demo.xml".into(),
                kind: "token".into(),
                external_id: "w-1".into(),
                sidecar: None,
            },
        ),
    ]);
    let mut nodes = Vec::new();
    for (id, source, kind, content) in [
        ("d", document_source, "CorpusDocument", doc["title"].clone()),
        (
            "t",
            doc["tokens"][0].clone(),
            "CorpusToken",
            json!("original"),
        ),
    ] {
        let mut properties = lineage.clone();
        properties["anchor"] = serde_json::to_value(&anchors[id]).unwrap();
        properties["source"] = source;
        properties["artifact_hash"] =
            contract["artifact_manifest"]["xmlfiles/demo.xml"]["sha256"].clone();
        properties["rights"] = contract["rights"].clone();
        properties["definition_version"] = contract["definition_version"].clone();
        properties["content"] = content;
        nodes.push(json!({"id":id,"type":kind,"properties":properties}));
    }
    let bytes = serde_json::to_vec(&json!({"nodes":nodes,"edges":[{"source_id":"t","target_id":"d","type":"partOfDocument","properties":lineage}]})).unwrap();
    let completion = Completion {
        schema: 1,
        binding,
        graph_hash: package::hash(&bytes),
        node_count: 2,
        edge_count: 1,
        anchors,
    };
    (tmp, s, completion, bytes)
}

#[test]
fn generation_idempotency_binds_complete_recipe_and_output() {
    let (_tmp, mut s, c, bytes) = fixture();
    let first = s.accept_generation(&c, &bytes, Fault::None).unwrap();
    assert_eq!(first, s.accept_generation(&c, &bytes, Fault::None).unwrap());
    assert_eq!(s.generations("p", true).unwrap().len(), 1);
    let mut altered = c.clone();
    altered.binding.recipe.adapter_hash = "1".repeat(64);
    assert!(
        s.accept_generation(&altered, &bytes, Fault::None).is_err(),
        "Recipe changes must rebind every graph record"
    );
    assert_eq!(s.generations("p", false).unwrap().len(), 1);
}

#[test]
fn complete_export_preserves_generation_contract_receipt_and_graph() {
    let (tmp, mut s, c, bytes) = fixture();
    s.accept_generation(&c, &bytes, Fault::None).unwrap();
    let out = tmp.path().join("export");
    s.export("p", c.binding.revision, &out).unwrap();
    let graph = walkdir::WalkDir::new(&out)
        .into_iter()
        .map(|e| e.unwrap())
        .find(|e| e.file_name().to_str() == Some(&c.graph_hash))
        .unwrap()
        .into_path();
    assert_eq!(fs::read(&graph).unwrap(), bytes);
    let mut imported = Store::open(&tmp.path().join("imported")).unwrap();
    imported.import(&out, "p").unwrap();
    assert!(
        !imported.view("p", None).unwrap().approved,
        "Imported receipts do not grant new authority approval"
    );
    fs::remove_file(graph).unwrap();
    let mut broken = Store::open(&tmp.path().join("broken")).unwrap();
    assert!(
        broken.import(&out, "p").is_err(),
        "Declared derived objects must be present"
    );
}

#[test]
fn false_source_rights_lineage_edges_and_incomplete_graph_are_rejected() {
    for mutation in 0..7 {
        let (_tmp, mut s, mut c, bytes) = fixture();
        let mut graph: Value = serde_json::from_slice(&bytes).unwrap();
        match mutation {
            0 => graph["nodes"][1]["properties"]["source"]["start_us"] = json!(123),
            1 => graph["nodes"][1]["properties"]["content"] = json!("invented correction"),
            2 => graph["nodes"][0]["properties"]["rights"] = json!("public"),
            3 => graph["nodes"][1]["properties"]["revision"] = json!(999),
            4 => graph["edges"][0]["type"] = json!("inventedClaim"),
            5 => {
                graph["edges"] = json!([]);
                c.edge_count = 0;
            }
            _ => graph["nodes"][1]["type"] = json!("VerifiedClaim"),
        }
        let bytes = serde_json::to_vec(&graph).unwrap();
        c.graph_hash = package::hash(&bytes);
        assert!(
            s.accept_generation(&c, &bytes, Fault::None).is_err(),
            "mutation {mutation}"
        );
        assert!(s.generations("p", true).unwrap().is_empty());
    }
}

#[test]
fn correction_and_review_retraction_exclude_history_from_default_queries() {
    let (_tmp, mut s, c, bytes) = fixture();
    let generation = s.accept_generation(&c, &bytes, Fault::None).unwrap();
    let id = generation["generation_id"].as_str().unwrap();
    assert!(
        s.generation("p", id, false).unwrap()["generation"]["current"]
            .as_bool()
            .unwrap()
    );
    let head = s.head("p").unwrap();
    s.apply(
        "local-owner",
        &Command {
            schema: 1,
            project: "p".into(),
            command_id: "edit".into(),
            base_revision: head.id,
            preimage_hash: head.snapshot_hash,
            config_version: 1,
            label: "correction".into(),
            operations: vec![Operation::SetToken {
                document: "xmlfiles/demo.xml".into(),
                token: "w-1".into(),
                fields: BTreeMap::from([("nform".into(), "corrected".into())]),
            }],
        },
        Fault::None,
    )
    .unwrap();
    assert!(s.generations("p", false).unwrap().is_empty());
    assert!(s.generation("p", id, false).is_err());
    assert_eq!(
        s.generation("p", id, true).unwrap()["graph"]["nodes"][1]["properties"]["content"],
        "original"
    );
    assert!(s.accept_generation(&c, &bytes, Fault::None).is_err());
    let (_tmp, mut other, c, bytes) = fixture();
    other.accept_generation(&c, &bytes, Fault::None).unwrap();
    other
        .review(
            "local-owner",
            "p",
            c.binding.revision,
            &c.binding.snapshot_hash,
            "rejected",
            "retracted",
        )
        .unwrap();
    assert!(other.generations("p", false).unwrap().is_empty());
    assert_eq!(other.generations("p", true).unwrap().len(), 1);
}

#[test]
fn generation_commit_failures_and_response_loss_have_atomic_retry() {
    for (fault, committed) in [
        (Fault::AfterStage, false),
        (Fault::BeforeCommit, false),
        (Fault::AfterCommit, true),
    ] {
        let (tmp, mut s, c, bytes) = fixture();
        assert!(s.accept_generation(&c, &bytes, fault).is_err());
        drop(s);
        let mut s = Store::open(&tmp.path().join("authority")).unwrap();
        assert_eq!(
            s.generations("p", true).unwrap().len(),
            usize::from(committed)
        );
        s.accept_generation(&c, &bytes, Fault::None).unwrap();
        assert_eq!(s.generations("p", true).unwrap().len(), 1);
        assert!(s.view("p", None).unwrap().approved);
    }
}

#[test]
fn schema_one_upgrade_and_backup_preserve_authority_and_generation_objects() {
    let (tmp, s, c, bytes) = fixture();
    s.conn
        .execute_batch("DROP TABLE derived_generations; PRAGMA user_version=1;")
        .unwrap();
    drop(s);
    let mut s = Store::open(&tmp.path().join("authority")).unwrap();
    assert!(s.view("p", None).unwrap().approved);
    assert_eq!(
        s.conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        2
    );
    let generation = s.accept_generation(&c, &bytes, Fault::None).unwrap();
    let backup = tmp.path().join("backup");
    s.backup(&backup).unwrap();
    let restored = Store::open(&backup).unwrap();
    assert_eq!(
        s.generation("p", generation["generation_id"].as_str().unwrap(), false)
            .unwrap(),
        restored
            .generation("p", generation["generation_id"].as_str().unwrap(), false)
            .unwrap()
    );
    fs::write(backup.join("objects").join(&c.graph_hash), "corrupt").unwrap();
    assert!(Store::open(&backup).is_err());
}

#[test]
fn ambiguous_legacy_span_generation_is_historical_only_after_upgrade() {
    let (tmp, base, mut completion, bytes) = fixture();
    let mut contract = base
        .approved_contract("p", completion.binding.revision)
        .unwrap();
    let annotations = tmp.path().join("input/Annotations");
    fs::create_dir(&annotations).unwrap();
    for (name, label) in [("a_demo.xml", "FIRST"), ("b_demo.xml", "SECOND")] {
        fs::write(
            annotations.join(name),
            format!("<spanGrp><span id='s1' corresp='#w-1' label='{label}'/></spanGrp>"),
        )
        .unwrap();
    }
    let authority = tmp.path().join("legacy");
    let mut s = Store::open(&authority).unwrap();
    let r = s.import(&tmp.path().join("input"), "p").unwrap();
    s.review(
        "local-owner",
        "p",
        r.id,
        &r.snapshot_hash,
        "approved",
        "Synthetic legacy fixture",
    )
    .unwrap();
    let view = s.view("p", None).unwrap();
    assert!(s
        .approved_contract("p", r.id)
        .unwrap_err()
        .to_string()
        .contains("ambiguous span IDs"));
    // Reconstruct the mapping-v1 contract/graph accepted before this guard.
    // Its one SECOND span node silently omitted the FIRST sidecar judgment.
    contract["revision"] = serde_json::to_value(&r).unwrap();
    contract["bundle_hash"] = json!(r.snapshot_hash);
    contract["documents"] = serde_json::to_value(&view.documents).unwrap();
    contract["artifact_manifest"] = serde_json::to_value(&view.snapshot.files).unwrap();
    contract["review"] = s.receipt("p", r.id).unwrap()["reviews"]
        .as_array()
        .unwrap()
        .last()
        .unwrap()
        .clone();
    completion.binding.revision = r.id;
    completion.binding.snapshot_hash = r.snapshot_hash.clone();
    completion.binding.contract_hash = digest(&contract).unwrap();
    let lineage = json!({"project_id":"p","revision":r.id,"bundle_hash":r.snapshot_hash,"config_hash":completion.binding.config_hash,"contract_hash":completion.binding.contract_hash,"recipe_hash":digest(&completion.binding.recipe).unwrap(),"access_policy":"local-only"});
    let mut graph: Value = serde_json::from_slice(&bytes).unwrap();
    for node in graph["nodes"].as_array_mut().unwrap() {
        for (key, value) in lineage.as_object().unwrap() {
            node["properties"][key] = value.clone();
        }
    }
    for edge in graph["edges"].as_array_mut().unwrap() {
        edge["properties"] = lineage.clone();
    }
    let anchor = Anchor {
        document: "xmlfiles/demo.xml".into(),
        kind: "span".into(),
        external_id: "s1".into(),
        sidecar: None,
    };
    completion.anchors.insert("s".into(), anchor.clone());
    let mut properties = lineage.clone();
    properties["anchor"] = serde_json::to_value(anchor).unwrap();
    properties["source"] = serde_json::to_value(&view.documents[0].spans[1]).unwrap();
    properties["artifact_hash"] = json!(view.snapshot.files["xmlfiles/demo.xml"].sha256);
    properties["rights"] = json!(view.snapshot.config.rights);
    properties["definition_version"] = json!(view.snapshot.config.version);
    properties["content"] = json!("SECOND");
    graph["nodes"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"s","type":"CorpusSpan","properties":properties}));
    for (target, kind) in [("d", "partOfDocument"), ("t", "anchorsToken")] {
        graph["edges"]
            .as_array_mut()
            .unwrap()
            .push(json!({"source_id":"s","target_id":target,"type":kind,"properties":lineage}));
    }
    let bytes = serde_json::to_vec(&graph).unwrap();
    completion.graph_hash = package::hash(&bytes);
    completion.node_count = 3;
    completion.edge_count = 3;
    assert!(s
        .accept_generation(&completion, &bytes, Fault::None)
        .unwrap_err()
        .to_string()
        .contains("ambiguous span IDs"));
    // Emulate a pre-upgrade row; current writes still require the API above.
    s.objects
        .put(&serde_json::to_vec(&contract).unwrap(), "compiler-contract")
        .unwrap();
    s.objects.put(&bytes, "compiler-graph").unwrap();
    let receipt = s
        .objects
        .put(
            &serde_json::to_vec(&completion).unwrap(),
            "compiler-receipt",
        )
        .unwrap();
    let id = digest(&completion.binding).unwrap();
    s.conn.execute("INSERT INTO derived_generations(id,project,revision,snapshot_hash,recipe_hash,receipt_hash,graph_hash) VALUES(?,'p',?,?,?,?,?)",rusqlite::params![id,r.id,r.snapshot_hash,digest(&completion.binding.recipe).unwrap(),receipt.sha256,completion.graph_hash]).unwrap();
    drop(s);
    let s = Store::open(&authority).unwrap();
    assert!(s.generations("p", false).unwrap().is_empty());
    assert!(s.generation("p", &id, false).is_err());
    let historical = s.generation("p", &id, true).unwrap();
    assert_eq!(historical["generation"]["current"], false);
    assert_eq!(historical["graph"], graph);
    assert_eq!(historical["contract"], contract);
    assert_eq!(
        digest(&historical["receipt"]).unwrap(),
        digest(&completion).unwrap()
    );
    // The same exact approved revision may now receive a qualified v2 graph.
    let mut s = s;
    let contract2 = s
        .approved_contract_for_mapping("p", r.id, "corpus-evidence/2")
        .unwrap();
    let mut c2 = completion.clone();
    c2.binding.contract_hash = digest(&contract2).unwrap();
    c2.binding.recipe.mapping_version = "corpus-evidence/2".into();
    c2.anchors.remove("s");
    let lineage2 = json!({"project_id":"p","revision":r.id,"bundle_hash":r.snapshot_hash,"config_hash":c2.binding.config_hash,"contract_hash":c2.binding.contract_hash,"recipe_hash":digest(&c2.binding.recipe).unwrap(),"access_policy":"local-only"});
    let mut graph2 = graph.clone();
    graph2["nodes"]
        .as_array_mut()
        .unwrap()
        .retain(|n| n["id"] != "s");
    graph2["edges"]
        .as_array_mut()
        .unwrap()
        .retain(|e| e["source_id"] != "s");
    for node in graph2["nodes"].as_array_mut().unwrap() {
        for (k, v) in lineage2.as_object().unwrap() {
            node["properties"][k] = v.clone();
        }
        node["properties"]["transcript_hash"] =
            json!(view.snapshot.files["xmlfiles/demo.xml"].sha256);
    }
    for edge in graph2["edges"].as_array_mut().unwrap() {
        edge["properties"] = lineage2.clone();
    }
    for (index, span) in view.documents[0].spans.iter().enumerate() {
        let id = format!("span-{index}");
        let anchor = Anchor {
            document: "xmlfiles/demo.xml".into(),
            kind: "span".into(),
            external_id: span.id.clone(),
            sidecar: Some(span.sidecar.clone()),
        };
        c2.anchors.insert(id.clone(), anchor.clone());
        let mut properties = lineage2.clone();
        properties["anchor"] = serde_json::to_value(anchor).unwrap();
        properties["source"] = serde_json::to_value(span).unwrap();
        properties["artifact_hash"] = json!(view.snapshot.files[&span.sidecar].sha256);
        properties["transcript_hash"] = json!(view.snapshot.files["xmlfiles/demo.xml"].sha256);
        properties["rights"] = json!(view.snapshot.config.rights);
        properties["definition_version"] = json!(view.snapshot.config.version);
        graph2["nodes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id,"type":"CorpusSpan","properties":properties}));
        for (target, kind) in [("d", "partOfDocument"), ("t", "anchorsToken")] {
            graph2["edges"]
                .as_array_mut()
                .unwrap()
                .push(json!({"source_id":id,"target_id":target,"type":kind,"properties":lineage2}));
        }
    }
    let bytes2 = serde_json::to_vec(&graph2).unwrap();
    c2.graph_hash = package::hash(&bytes2);
    c2.node_count = 4;
    c2.edge_count = 5;
    let inventory_before = digest(&s.reference_inventory("p", r.id).unwrap()).unwrap();
    for mutation in 0..4 {
        let mut bad = c2.clone();
        let mut forged = graph2.clone();
        match mutation {
            0 => bad.anchors.get_mut("span-0").unwrap().sidecar = None,
            1 => {
                bad.anchors.get_mut("span-0").unwrap().sidecar =
                    Some("Annotations/nonexistent.xml".into())
            }
            2 => {
                forged["nodes"][2]["properties"]["artifact_hash"] =
                    json!(view.snapshot.files["xmlfiles/demo.xml"].sha256)
            }
            _ => {
                forged["edges"].as_array_mut().unwrap().pop();
            }
        }
        let bytes = serde_json::to_vec(&forged).unwrap();
        bad.graph_hash = package::hash(&bytes);
        assert!(s.accept_generation(&bad, &bytes, Fault::None).is_err());
    }
    let fresh = s.accept_generation(&c2, &bytes2, Fault::None).unwrap();
    assert_eq!(s.generations("p", false).unwrap().len(), 1);
    assert_eq!(s.generations("p", true).unwrap().len(), 2);
    assert_eq!(s.generation("p", &id, true).unwrap(), historical);
    assert_eq!(
        digest(&s.reference_inventory("p", r.id).unwrap()).unwrap(),
        inventory_before
    );
    let exported = tmp.path().join("mixed-export");
    s.export("p", r.id, &exported).unwrap();
    let mut imported = Store::open(&tmp.path().join("mixed-import")).unwrap();
    imported.import(&exported, "p").unwrap();
    assert_eq!(fresh["node_count"], 4);
    assert_eq!(fresh["edge_count"], 5);
}

#[test]
fn legacy_anchor_serialization_omits_new_scope_and_preserves_digest() {
    let old = json!({"document":"xmlfiles/demo.xml","kind":"span","external_id":"s1"});
    let anchor: Anchor = serde_json::from_value(old.clone()).unwrap();
    assert!(anchor.sidecar.is_none());
    assert_eq!(serde_json::to_value(&anchor).unwrap(), old);
    assert_eq!(digest(&anchor).unwrap(), digest(&old).unwrap());
}
#[test]
fn unsupported_mapping_never_grants_approved_contract() {
    let (_tmp, s, c, _bytes) = fixture();
    assert!(s
        .approved_contract_for_mapping("p", c.binding.revision, "corpus-evidence/3")
        .is_err());
}
#[test]
fn retokenization_preserves_prior_compiler_ids_graphs_and_exact_receipts() {
    use corpus_workbench::retokenize::{Reading, RetokenizeRequest};
    let (tmp, mut s, completion, bytes) = fixture();
    let generation = s
        .accept_generation(&completion, &bytes, Fault::None)
        .unwrap();
    let id = generation["generation_id"].as_str().unwrap();
    let old = s.generation("p", id, true).unwrap();
    let inv = s.reference_inventory("p", s.head("p").unwrap().id).unwrap();
    let request = RetokenizeRequest {
        schema: 1,
        project: "p".into(),
        revision: inv.revision,
        snapshot_hash: inv.snapshot_hash.clone(),
        config_hash: inv.config_hash.clone(),
        inventory_hash: digest(&inv).unwrap(),
        document: "xmlfiles/demo.xml".into(),
        targets: vec![inv.ids.iter().find(|t| t.id == "w-1").unwrap().clone()],
        replacement: vec![
            Reading {
                id: "successor-a".into(),
                original: "orig".into(),
                corrected: None,
                normalized: None,
            },
            Reading {
                id: "successor-b".into(),
                original: "inal".into(),
                corrected: None,
                normalized: None,
            },
        ],
        relation_endpoint: None,
    };
    let preview = s.retokenization_preview(&request).unwrap();
    assert!(preview.execution_enabled, "{:?}", preview.blockers);
    let view = s.view("p", None).unwrap();
    let c = Command {
        schema: 1,
        project: "p".into(),
        command_id: "split".into(),
        base_revision: view.revision.id,
        preimage_hash: view.revision.snapshot_hash,
        config_version: view.snapshot.config.version,
        label: "Split synthetic token".into(),
        operations: vec![Operation::Retokenize {
            request,
            preview_hash: digest(&preview).unwrap(),
        }],
    };
    s.apply("local-owner", &c, Fault::None).unwrap();
    assert!(s.generations("p", false).unwrap().is_empty());
    assert!(s.generation("p", id, false).is_err());
    let historical = s.generation("p", id, true).unwrap();
    for key in ["graph", "receipt", "contract"] {
        assert_eq!(historical[key], old[key]);
    }
    assert_eq!(s.generations("p", true).unwrap().len(), 1);
    let out = tmp.path().join("structural-export");
    s.export("p", s.head("p").unwrap().id, &out).unwrap();
    let namespace = fs::read_dir(out.join("Workbench/exports"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        fs::read(
            namespace
                .join("history-objects")
                .join(&completion.graph_hash)
        )
        .unwrap(),
        bytes
    );
    let backup = tmp.path().join("structural-backup");
    s.backup(&backup).unwrap();
    let restored = Store::open(&backup).unwrap();
    let historical = restored.generation("p", id, true).unwrap();
    assert_eq!(historical["graph"], old["graph"]);
}
