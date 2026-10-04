use corpus_workbench::{
    handoff::digest,
    inventory::{Inventory, Preflight},
    model::{Command, Operation},
    store::{Fault, Store},
};
use std::fs;
use tempfile::TempDir;
const DOC:&str="<TEI><text><tok id='w1' form='SYNTHETIC'>SYNTHETIC</tok><tok id='w2' form='ONLY'>ONLY</tok></text></TEI>";
fn fixture(extra: &[(&str, &[u8])]) -> (TempDir, Store, Inventory) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    for (path, bytes) in [
        ("Resources/settings.xml", b"<ttsettings/>".as_slice()),
        ("xmlfiles/demo.xml", DOC.as_bytes()),
    ]
    .into_iter()
    .chain(extra.iter().copied())
    {
        let file = input.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, bytes).unwrap();
    }
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    let r = store.import(&input, "p").unwrap();
    let inv = store.reference_inventory("p", r.id).unwrap();
    (tmp, store, inv)
}
fn request(inv: &Inventory) -> Preflight {
    Preflight {
        schema: 1,
        project: inv.project.clone(),
        revision: inv.revision,
        snapshot_hash: inv.snapshot_hash.clone(),
        config_hash: inv.config_hash.clone(),
        inventory_hash: digest(inv).unwrap(),
        operation: "retokenize".into(),
        targets: vec![inv
            .ids
            .iter()
            .find(|id| id.artifact == "xmlfiles/demo.xml" && id.id == "w1")
            .unwrap()
            .clone()],
    }
}
fn edit(s: &mut Store) {
    let v = s.view("p", None).unwrap();
    s.apply(
        "local-owner",
        &Command {
            schema: 1,
            project: "p".into(),
            command_id: "edit".into(),
            base_revision: v.revision.id,
            preimage_hash: v.revision.snapshot_hash,
            config_version: v.snapshot.config.version,
            label: "Synthetic revision".into(),
            operations: vec![Operation::DefineLanguage {
                value: "synthetic-custom".into(),
                description: "Synthetic label".into(),
            }],
        },
        Fault::None,
    )
    .unwrap();
}
#[test]
fn every_artifact_is_hashed_and_opaque_formats_are_explicit() {
    let (_tmp, s, inv) = fixture(&[
        ("Other/unknown.data", b"<opaque ref='#none'/>"),
        (
            "Annotations/parser.psdx",
            b"<forest Id='F1'><eTree Parent='F1'/></forest>",
        ),
        ("Other/broken.psdx", b"<broken"),
        ("Raw/draft.json", b"{\"text\":\"SYNTHETIC\"}"),
        ("Other/binary.bin", &[0, 255, 17]),
    ]);
    let view = s.view("p", None).unwrap();
    assert_eq!(inv.artifacts.len(), view.snapshot.files.len());
    for a in &inv.artifacts {
        assert_eq!(a.artifact, view.snapshot.files[&a.path]);
    }
    assert_eq!(
        inv.artifacts
            .iter()
            .find(|a| a.path.ends_with("parser.psdx"))
            .unwrap()
            .coverage,
        "xml-enumerated"
    );
    assert_eq!(
        inv.artifacts
            .iter()
            .find(|a| a.path.ends_with("broken.psdx"))
            .unwrap()
            .coverage,
        "opaque-xml"
    );
    assert!(inv
        .artifacts
        .iter()
        .any(|a| a.path == "Raw/draft.json" && a.coverage == "opaque"));
    assert!(!inv.structural_execution_enabled);
}
#[test]
fn namespace_declarations_implicit_xml_namespace_and_entities_have_exact_ranges() {
    let source="<TEI xmlns:x='urn:synthetic'><text><tok xml:id='w1' form='é🧑🏽' xml:lang='xh'>é🧑🏽</tok><x:note x:id='opaque' ref='&#35;w1' x:ref='#w1'/></text></TEI>";
    let (_tmp, _s, inv) = fixture(&[("xmlfiles/demo.xml", source.as_bytes())]);
    assert!(inv
        .carriers
        .iter()
        .any(|c| c.qname == "xmlns:x" && c.kind == "namespace-declaration"));
    let c = inv.carriers.iter().find(|c| c.qname == "xml:id").unwrap();
    assert_eq!(
        c.namespace.as_deref(),
        Some("http://www.w3.org/XML/1998/namespace")
    );
    let c = inv.carriers.iter().find(|c| c.qname == "ref").unwrap();
    assert_eq!(&source[c.byte_start..c.byte_end], "&#35;w1");
    assert_eq!(c.value, "#w1");
    assert_eq!(c.resolution, "resolved");
    assert_eq!(
        inv.carriers
            .iter()
            .find(|c| c.qname == "x:ref")
            .unwrap()
            .resolution,
        "unknown-semantics"
    );
    assert!(!inv.ids.iter().any(|i| i.id == "opaque"));
}
#[test]
fn all_mixed_text_cdata_comments_pi_and_outside_whitespace_are_enumerated() {
    let source="<?xml version='1.0'?>\n<?test href='demo.xml#w1'?>\n<TEI><text><tok id='w1' form='SYNTHETIC'>SYNTHETIC</tok><note>prefix<![CDATA[#w1]]>suffix &amp; tail<hi/>after</note><!-- #w1 --></text></TEI>\n";
    let (_tmp, _s, inv) = fixture(&[("xmlfiles/demo.xml", source.as_bytes())]);
    for lexical in [
        "prefix",
        "<![CDATA[#w1]]>",
        "suffix &amp; tail",
        "after",
        "<!-- #w1 -->",
        "<?test href='demo.xml#w1'?>",
        "<?xml version='1.0'?>",
    ] {
        assert!(
            inv.carriers
                .iter()
                .any(|c| &source[c.byte_start..c.byte_end] == lexical),
            "Missing lexical piece {lexical}"
        );
    }
    assert!(inv
        .carriers
        .iter()
        .any(|c| c.kind == "cdata" && c.value == "#w1" && c.resolution == "unknown-semantics"));
    assert!(inv
        .carriers
        .iter()
        .any(|c| c.kind == "text" && c.value == "suffix & tail"));
    assert!(inv
        .carriers
        .iter()
        .any(|c| c.byte_end == source.len() && c.value == "\n"));
}
#[test]
fn long_attribute_assignment_whitespace_does_not_corrupt_byte_ranges() {
    let source = format!(
        "<TEI><text><tok id{}={} 'w1' form='SYNTHETIC'>SYNTHETIC</tok></text></TEI>",
        " ".repeat(300),
        " ".repeat(300)
    );
    let (_tmp, _s, inv) = fixture(&[("xmlfiles/demo.xml", source.as_bytes())]);
    let c = inv.carriers.iter().find(|c| c.qname == "id").unwrap();
    assert_eq!(&source[c.byte_start..c.byte_end], "w1");
}
#[test]
fn local_relative_external_missing_and_base_dependent_scopes_stay_distinct() {
    let source=DOC.replace("</text>","<ref target='other.xml#w1'/><ref target='https://example.invalid/doc#w1'/><ref target='../../outside#w1'/><ref target='#missing'/><note xml:base='https://example.invalid/'><ref target='other.xml#w1'/></note></text>");
    let (_tmp, _s, inv) = fixture(&[
        ("Other/source.xml", source.as_bytes()),
        ("Other/other.xml", DOC.as_bytes()),
    ]);
    let refs: Vec<_> = inv
        .carriers
        .iter()
        .filter(|c| c.qname == "target")
        .collect();
    assert_eq!(
        refs.iter().filter(|c| c.resolution == "resolved").count(),
        1
    );
    assert_eq!(
        refs.iter()
            .find(|c| c.resolution == "resolved")
            .unwrap()
            .targets[0]
            .artifact,
        "Other/other.xml"
    );
    assert_eq!(
        refs.iter()
            .filter(|c| c.resolution == "external-or-unsafe")
            .count(),
        2
    );
    assert!(refs.iter().any(|c| c.resolution == "unresolved"));
    assert!(refs
        .iter()
        .any(|c| c.resolution == "unknown-scope" && !c.xml_base.is_empty()));
}
#[test]
fn shared_sidecar_reference_scope_is_ambiguous_even_when_bare_ids_match() {
    let (_tmp, _s, inv) = fixture(&[
        ("xmlfiles/sub/demo.xml", DOC.as_bytes()),
        (
            "Annotations/review_demo.xml",
            b"<spanGrp><span id='s1' corresp='#w1'/></spanGrp>",
        ),
    ]);
    let c = inv.carriers.iter().find(|c| c.qname == "corresp").unwrap();
    assert_eq!(c.resolution, "ambiguous");
    assert_eq!(c.targets.len(), 2);
}
#[test]
fn relation_only_spans_and_legacy_character_coordinates_are_lossless_and_read_only() {
    let spans="<spanGrp><span id='s1' corresp='#w1' idx='1-3'>SYNTHETIC</span><span id='s2' corresp='#w2'/><span id='r1' source='#s1' target='#s2'/></spanGrp>";
    let (tmp, mut s, inv) = fixture(&[("Annotations/review_demo.xml", spans.as_bytes())]);
    for name in ["source", "target"] {
        let c = inv.carriers.iter().find(|c| c.qname == name).unwrap();
        assert_eq!(c.resolution, "resolved");
        assert_eq!(c.targets[0].artifact, "Annotations/review_demo.xml");
    }
    assert_eq!(
        inv.carriers
            .iter()
            .find(|c| c.qname == "idx")
            .unwrap()
            .resolution,
        "unknown-semantics"
    );
    let v = s.view("p", None).unwrap();
    assert_eq!(v.documents[0].spans.len(), 2);
    assert!(v
        .issues
        .iter()
        .any(|i| i.code == "opaque-preserved" && i.blocking));
    assert!(s
        .review(
            "local-owner",
            "p",
            v.revision.id,
            &v.revision.snapshot_hash,
            "approved",
            "unsupported relation"
        )
        .is_err());
    let out = tmp.path().join("export");
    s.export("p", v.revision.id, &out).unwrap();
    assert_eq!(
        fs::read(out.join("Annotations/review_demo.xml")).unwrap(),
        spans.as_bytes()
    );
    let mut reopened = Store::open(&tmp.path().join("reopen")).unwrap();
    reopened.import(&out, "p").unwrap();
    assert_eq!(
        reopened.view("p", None).unwrap().documents[0].spans.len(),
        2
    );
}
#[test]
fn definition_suffix_is_not_used_to_claim_a_resolved_sidecar_scope() {
    let (_tmp, mut s, inv) = fixture(&[
        ("xmlfiles/def.xml", DOC.as_bytes()),
        (
            "Annotations/review_def.xml",
            b"<spanGrp><span id='s1' corresp='#w1'/></spanGrp>",
        ),
    ]);
    let c = inv.carriers.iter().find(|c| c.qname == "corresp").unwrap();
    assert_eq!(c.resolution, "unknown-scope");
    assert!(c.targets.is_empty());
    let v = s.view("p", None).unwrap();
    assert!(v
        .issues
        .iter()
        .any(|i| i.code == "ambiguous-annotation-definition" && i.blocking));
    let command = Command {
        schema: 1,
        project: "p".into(),
        command_id: "reserved".into(),
        base_revision: v.revision.id,
        preimage_hash: v.revision.snapshot_hash,
        config_version: v.snapshot.config.version,
        label: "Synthetic reserved sidecar".into(),
        operations: vec![Operation::AddSpan {
            document: "xmlfiles/def.xml".into(),
            id: "new-span".into(),
            token_ids: vec!["w1".into()],
            fields: Default::default(),
            character: None,
        }],
    };
    assert!(s
        .apply("local-owner", &command, Fault::None)
        .unwrap_err()
        .to_string()
        .contains("reserved annotation definition"));
}

#[test]
fn duplicate_ids_in_opaque_xml_are_ambiguous_and_identical_bytes_keep_path_identity() {
    let source = b"<opaque><n id='n'/><n id='n'/><ref target='#n'/></opaque>";
    let (_tmp, _s, inv) = fixture(&[("Other/a.xml", source), ("Other/b.xml", source)]);
    let refs: Vec<_> = inv
        .carriers
        .iter()
        .filter(|c| c.qname == "target")
        .collect();
    assert_eq!(refs.len(), 2);
    assert_ne!(refs[0].artifact, refs[1].artifact);
    assert_eq!(refs[0].artifact_hash, refs[1].artifact_hash);
    assert!(refs
        .iter()
        .all(|c| c.resolution == "ambiguous" && c.targets.len() == 2));
}
#[test]
fn historical_inventory_is_deterministic_after_later_edits_reviews_and_generations() {
    let (_tmp, mut s, inv) = fixture(&[]);
    let old = digest(&inv).unwrap();
    edit(&mut s);
    let v = s.view("p", None).unwrap();
    s.review(
        "local-owner",
        "p",
        v.revision.id,
        &v.revision.snapshot_hash,
        "approved",
        "Synthetic only",
    )
    .unwrap();
    assert_eq!(
        digest(&s.reference_inventory("p", inv.revision).unwrap()).unwrap(),
        old
    );
    assert_ne!(
        digest(&s.reference_inventory("p", v.revision.id).unwrap()).unwrap(),
        old
    );
}
#[test]
fn preflight_reports_impact_without_writing_and_always_blocks_execution() {
    let (_tmp, s, inv) = fixture(&[
        (
            "Annotations/review_demo.xml",
            b"<spanGrp><span id='s1' corresp='#w1'/></spanGrp>",
        ),
        ("Raw/draft.json", b"{}"),
    ]);
    let before = s.head("p").unwrap();
    let objects = fs::read_dir(&s.objects.root).unwrap().count();
    let report = s.reference_preflight(&request(&inv)).unwrap();
    assert_eq!(report["execution_enabled"], false);
    assert_eq!(report["affected_carriers"].as_array().unwrap().len(), 1);
    assert!(!report["unresolved_carriers"].as_array().unwrap().is_empty());
    assert!(!report["opaque_artifacts"].as_array().unwrap().is_empty());
    assert_eq!(s.head("p").unwrap().snapshot_hash, before.snapshot_hash);
    assert_eq!(fs::read_dir(&s.objects.root).unwrap().count(), objects);
}
#[test]
fn preflight_rejects_stale_forged_unqualified_duplicate_and_unsupported_requests() {
    let (_tmp, mut s, inv) = fixture(&[]);
    for field in 0..6 {
        let mut req = request(&inv);
        match field {
            0 => req.snapshot_hash = "0".repeat(64),
            1 => req.config_hash = "0".repeat(64),
            2 => req.inventory_hash = "0".repeat(64),
            3 => req.targets[0].artifact = "Other/a.xml".into(),
            4 => req.targets.push(req.targets[0].clone()),
            _ => req.operation = "execute".into(),
        };
        assert!(s.reference_preflight(&req).is_err());
    }
    edit(&mut s);
    assert!(s
        .reference_preflight(&request(&inv))
        .unwrap_err()
        .to_string()
        .contains("stale"));
    assert!(s
        .reference_inventory("different-project", inv.revision)
        .is_err());
}
#[test]
fn configured_pointers_ordinals_and_unknown_attributes_are_preserved_as_separate_carriers() {
    let source = DOC.replace(
        "form='SYNTHETIC'",
        "form='SYNTHETIC' head='w2' ohead='2' deps='2:obj' customTokens='#w2 #w1' unknown='w1'",
    );
    let (_tmp, _s, inv) = fixture(&[("xmlfiles/demo.xml", source.as_bytes())]);
    assert_eq!(
        inv.carriers
            .iter()
            .find(|c| c.qname == "head")
            .unwrap()
            .resolution,
        "resolved"
    );
    for name in ["ohead", "deps", "unknown"] {
        assert_eq!(
            inv.carriers
                .iter()
                .find(|c| c.qname == name)
                .unwrap()
                .resolution,
            "unknown-semantics"
        );
    }
    assert_eq!(
        inv.carriers
            .iter()
            .find(|c| c.qname == "customTokens")
            .unwrap()
            .targets
            .len(),
        2
    );
}
#[test]
fn unsupported_encoding_and_quarantined_code_never_acquire_reference_safety() {
    let (_tmp, s, inv) = fixture(&[
        (
            "Annotations/parser.psdx",
            &[255, 254, 60, 0, 97, 0, 47, 0, 62, 0],
        ),
        ("Other/inert.php", b"<?php echo 'SYNTHETIC INERT'; ?>"),
    ]);
    assert!(inv
        .artifacts
        .iter()
        .any(|a| a.path.ends_with("parser.psdx") && a.coverage == "opaque-xml"));
    assert!(inv
        .artifacts
        .iter()
        .any(|a| a.artifact.role == "inert-compatibility-dependency"));
    assert_eq!(
        s.reference_preflight(&request(&inv)).unwrap()["execution_enabled"],
        false
    );
}

#[test]
fn unassociated_span_sidecars_are_preserved_but_cannot_be_approved_or_compiled() {
    for path in [
        "Annotations/review_other.xml",
        "Annotations/review_other.XML",
        "annotations/review_other.xml",
    ] {
        for sidecar in [
            b"<spanGrp><span id='s1' corresp='#w1'/></spanGrp>".as_slice(),
            b"<spanGrp><span id='r1' source='#missing' target='#absent'/></spanGrp>",
        ] {
            let (tmp, mut s, inv) = fixture(&[(path, sidecar)]);
            let v = s.view("p", None).unwrap();
            assert!(v
                .issues
                .iter()
                .any(|i| i.code == "ambiguous-annotation-association" && i.blocking));
            assert!(s
                .review(
                    "local-owner",
                    "p",
                    v.revision.id,
                    &v.revision.snapshot_hash,
                    "approved",
                    "Synthetic unassociated evidence"
                )
                .is_err());
            // An old approval never bypasses today's compiler validation.
            s.conn.execute("INSERT INTO reviews(project,revision,snapshot_hash,actor,decision,scope,note) VALUES('p',?,?,'local-owner','approved','full','Synthetic pre-upgrade')",rusqlite::params![v.revision.id,v.revision.snapshot_hash]).unwrap();
            assert!(s
                .approved_contract_for_mapping("p", v.revision.id, "corpus-evidence/2")
                .is_err());
            let out = tmp.path().join("export");
            s.export("p", v.revision.id, &out).unwrap();
            assert_eq!(fs::read(out.join(path)).unwrap(), sidecar);
            assert!(!inv.structural_execution_enabled);
        }
    }
}
