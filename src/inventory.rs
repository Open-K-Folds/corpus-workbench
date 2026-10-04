//! Read-only, exact-revision reference discovery. Enumeration is not a remapper.
use crate::{handoff::digest, model::Artifact, store::Store, xml};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const MAX_CARRIERS: usize = 100_000;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Target {
    pub artifact: String,
    pub element_start: usize,
    pub id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Carrier {
    pub artifact: String,
    pub artifact_hash: String,
    pub element_start: usize,
    pub element: String,
    pub namespace: Option<String>,
    pub xml_base: Vec<String>,
    pub kind: String,
    pub qname: String,
    pub byte_start: usize,
    pub byte_end: usize,
    pub value: String,
    pub syntax: String,
    pub resolution: String,
    pub targets: Vec<Target>,
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactCoverage {
    pub path: String,
    pub artifact: Artifact,
    pub coverage: String,
    pub reason: String,
    pub carriers: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Inventory {
    pub schema: u32,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub config_hash: String,
    pub artifacts: Vec<ArtifactCoverage>,
    pub carriers: Vec<Carrier>,
    pub ids: Vec<Target>,
    pub authority_dependencies: Value,
    pub structural_execution_enabled: bool,
    pub limitations: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preflight {
    pub schema: u32,
    pub project: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub config_hash: String,
    pub inventory_hash: String,
    pub operation: String,
    pub targets: Vec<Target>,
}

impl Store {
    pub fn reference_inventory(&self, project: &str, revision: i64) -> Result<Inventory> {
        let r = self.revision(project, revision)?;
        let snapshot = self.snapshot(&r)?;
        let docs = crate::package::documents(&self.objects, &snapshot)?;
        let mut owners: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for doc in &docs {
            for span in &doc.spans {
                owners
                    .entry(span.sidecar.clone())
                    .or_default()
                    .insert(doc.path.clone());
            }
        }
        let mut inventory = Inventory {
            schema: 1, project: project.into(), revision, snapshot_hash: r.snapshot_hash,
            config_hash: crate::package::hash(&serde_json::to_vec(&snapshot.config)?), artifacts: vec![], carriers: vec![], ids: vec![],
            // Native authority objects are dependencies, never XML rewrite targets.
            authority_dependencies: json!({"revision_history":self.history(project)?.into_iter().filter(|r|r.id<=revision).collect::<Vec<_>>(),"derived_state":"mutable review and generation eligibility is separate live preflight context","policy":"history, raw drafts, source media and prior exports are immutable; derived indexes/graphs require rebuild and exact approval"}),
            structural_execution_enabled: false,
            limitations: vec![
                "XML enumeration includes every attribute, text, comment and processing instruction; QName, namespace and original byte ranges are retained. Namespace declarations are explicit lexical carriers.".into(),
                "Resolved means exact syntactic ID lookup only; configurable XPath, custom attributes, media/base-URL rules and arbitrary dialect semantics are not inferred.".into(),
                "Non-XML artifacts and malformed XML-like sidecars are explicitly opaque. No external URI is fetched; no converter or token split/merge executes.".into(),
                "Execution requires reviewed carrier-specific rewrite rules, qualified ID mappings, schema/time/Unicode checks, index invalidation, complete round-trip evidence and atomic revision commit.".into(),
            ],
        };
        for (path, artifact) in &snapshot.files {
            let bytes = self.objects.read(artifact)?;
            let text = std::str::from_utf8(&bytes).ok();
            let extension = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            let xml_like = ["xml", "psdx", "svg", "xsd", "xsl", "xslt"]
                .contains(&extension.as_str())
                || text.is_some_and(|t| {
                    t.trim_start_matches('\u{feff}')
                        .trim_start()
                        .starts_with('<')
                });
            let before = inventory.carriers.len();
            let parsed = if xml_like {
                text.and_then(|t| xml::parse(t).ok().map(|d| (t, d)))
            } else {
                None
            };
            let (coverage, reason) = if let Some((text, tree)) = parsed {
                for node in tree.descendants().filter(|n| n.is_element()) {
                    for (qname, range) in xml::lexical_attrs(text, node.range().start)?.0 {
                        let declaration = qname == "xmlns" || qname.starts_with("xmlns:");
                        let prefix_local = qname.split_once(':');
                        let namespace = if declaration {
                            Some("http://www.w3.org/2000/xmlns/")
                        } else {
                            prefix_local.and_then(|(prefix, _)| {
                                if prefix == "xml" {
                                    Some("http://www.w3.org/XML/1998/namespace")
                                } else {
                                    node.lookup_namespace_uri(Some(prefix))
                                }
                            })
                        };
                        let local = prefix_local.map_or(qname.as_str(), |(_, local)| local);
                        let value = if declaration {
                            node.lookup_namespace_uri(qname.strip_prefix("xmlns:"))
                                .unwrap_or("")
                        } else {
                            node.attributes()
                                .find(|a| a.name() == local && a.namespace() == namespace)
                                .context("lexical attribute projection")?
                                .value()
                        };
                        let start = range.start;
                        let end = range.end;
                        let is_id = !declaration
                            && local == "id"
                            && (namespace.is_none()
                                || namespace == Some("http://www.w3.org/XML/1998/namespace"));
                        if is_id {
                            inventory.ids.push(Target {
                                artifact: path.clone(),
                                element_start: node.range().start,
                                id: value.into(),
                            });
                        }
                        inventory.carriers.push(Carrier {
                            artifact: path.clone(),
                            artifact_hash: artifact.sha256.clone(),
                            element_start: node.range().start,
                            element: node.tag_name().name().into(),
                            namespace: namespace.map(str::to_string),
                            xml_base: node
                                .ancestors()
                                .filter_map(|n| {
                                    n.attribute(("http://www.w3.org/XML/1998/namespace", "base"))
                                })
                                .map(str::to_string)
                                .collect(),
                            kind: if declaration {
                                "namespace-declaration"
                            } else {
                                "attribute"
                            }
                            .into(),
                            qname,
                            byte_start: start,
                            byte_end: end,
                            value: value.into(),
                            syntax: if is_id { "id-declaration" } else { "unknown" }.into(),
                            resolution: if is_id {
                                "declaration"
                            } else {
                                "unknown-semantics"
                            }
                            .into(),
                            targets: vec![],
                            note: "Immutable lexical carrier; no rewrite rule enabled".into(),
                        });
                        ensure!(
                            inventory.carriers.len() <= MAX_CARRIERS,
                            "reference inventory carrier limit; no partial inventory returned"
                        );
                    }
                }
                lexical_misc(text, &tree, path, artifact, &mut inventory.carriers)?;
                (
                    "xml-enumerated",
                    "All parsed lexical carriers inventoried; dialect semantics remain gated",
                )
            } else if xml_like {
                ("opaque-xml", "XML-like artifact is non-UTF-8, malformed or outside safe parser limits; bytes preserved")
            } else {
                (
                    "opaque",
                    "No verified reference decoder for this artifact; bytes preserved",
                )
            };
            ensure!(
                inventory.carriers.len() <= MAX_CARRIERS,
                "reference inventory carrier limit; no partial inventory returned"
            );
            inventory.artifacts.push(ArtifactCoverage {
                path: path.clone(),
                artifact: artifact.clone(),
                coverage: coverage.into(),
                reason: reason.into(),
                carriers: inventory.carriers.len() - before,
            });
        }
        inventory.ids.sort();
        inventory.ids.dedup();
        let mut ids: BTreeMap<(String, String), Vec<Target>> = BTreeMap::new();
        for id in &inventory.ids {
            ids.entry((id.artifact.clone(), id.id.clone()))
                .or_default()
                .push(id.clone());
        }
        for carrier in &mut inventory.carriers {
            if carrier.kind != "attribute" || carrier.syntax == "id-declaration" {
                continue;
            }
            // Namespaced lookalikes are not supported TEITOK fields.
            if carrier.namespace.is_some() {
                continue;
            }
            let name = carrier.qname.as_str();
            let known = matches!(
                name,
                "corresp"
                    | "sameAs"
                    | "relation_target"
                    | "head"
                    | "source"
                    | "target"
                    | "ref"
                    | "href"
            );
            let explicit = carrier
                .value
                .split_whitespace()
                .any(|v| v.starts_with('#') || v.contains("#"));
            if !known && !explicit {
                continue;
            }
            carrier.syntax = if known {
                "reference-candidate"
            } else {
                "explicit-fragment-candidate"
            }
            .into();
            carrier.note =
                "Syntactic lookup only; custom/configurable meaning and remapping are not proven"
                    .into();
            if !carrier.xml_base.is_empty() {
                carrier.resolution = "unknown-scope".into();
                carrier.note="Inherited xml:base requires an explicit dialect-aware URI resolver; no local scope assumed".into();
                continue;
            }
            let mut statuses = BTreeSet::new();
            for value in carrier.value.split_whitespace() {
                let scope = if name == "corresp"
                    && carrier.element == "span"
                    && snapshot.files[&carrier.artifact].role == "annotation-sidecar-or-definition"
                {
                    owners.get(&carrier.artifact).cloned().unwrap_or_default()
                } else {
                    BTreeSet::from([carrier.artifact.clone()])
                };
                let (paths, id) = if let Some((file, fragment)) = value.split_once('#') {
                    if file.is_empty() {
                        (scope, fragment)
                    } else if file.contains(':') || file.starts_with('/') || file.contains('\\') {
                        statuses.insert("external-or-unsafe");
                        continue;
                    } else if let Some(path) = relative_path(&carrier.artifact, file) {
                        (BTreeSet::from([path]), fragment)
                    } else {
                        statuses.insert("external-or-unsafe");
                        continue;
                    }
                } else if matches!(name, "href" | "ref") {
                    statuses.insert("unknown-semantics");
                    continue;
                } else {
                    (scope, value)
                };
                if paths.len() != 1 {
                    statuses.insert(if paths.is_empty() {
                        "unknown-scope"
                    } else {
                        "ambiguous"
                    });
                }
                let found: Vec<_> = paths
                    .iter()
                    .flat_map(|p| {
                        ids.get(&(p.clone(), id.to_string()))
                            .into_iter()
                            .flatten()
                            .cloned()
                    })
                    .collect();
                statuses.insert(if found.is_empty() {
                    "unresolved"
                } else if found.len() > 1 || paths.len() != 1 {
                    "ambiguous"
                } else {
                    "resolved"
                });
                carrier.targets.extend(found);
            }
            carrier.targets.sort();
            carrier.targets.dedup();
            carrier.resolution = if statuses.contains("ambiguous") {
                "ambiguous"
            } else if statuses.contains("external-or-unsafe") {
                "external-or-unsafe"
            } else if statuses.contains("unknown-scope") {
                "unknown-scope"
            } else if statuses.contains("unknown-semantics") || statuses.is_empty() {
                "unknown-semantics"
            } else if statuses.contains("unresolved") {
                "unresolved"
            } else {
                "resolved"
            }
            .into();
        }
        inventory.carriers.sort_by(|a, b| {
            (&a.artifact, a.byte_start, &a.kind).cmp(&(&b.artifact, b.byte_start, &b.kind))
        });
        Ok(inventory)
    }
    pub fn reference_preflight(&self, request: &Preflight) -> Result<Value> {
        ensure!(
            request.schema == 1 && matches!(request.operation.as_str(), "converter" | "retokenize"),
            "unsupported structural preflight"
        );
        ensure!(
            self.head(&request.project)?.id == request.revision,
            "stale preflight revision"
        );
        let inventory = self.reference_inventory(&request.project, request.revision)?;
        ensure!(
            inventory.snapshot_hash == request.snapshot_hash
                && inventory.config_hash == request.config_hash
                && digest(&inventory)? == request.inventory_hash,
            "stale reference inventory binding"
        );
        ensure!(
            !request.targets.is_empty() && request.targets.len() <= 10_000,
            "preflight requires bounded qualified targets"
        );
        let requested: BTreeSet<_> = request.targets.iter().cloned().collect();
        ensure!(
            requested.len() == request.targets.len()
                && requested.iter().all(|id| inventory.ids.contains(id)),
            "unknown or duplicate qualified preflight target"
        );
        let affected: Vec<_> = inventory
            .carriers
            .iter()
            .filter(|c| c.targets.iter().any(|id| requested.contains(id)))
            .collect();
        let unresolved: Vec<_> = inventory
            .carriers
            .iter()
            .filter(|c| !matches!(c.resolution.as_str(), "resolved" | "declaration"))
            .collect();
        Ok(
            json!({"schema":1,"request":request,"execution_enabled":false,"affected_carriers":affected,"unresolved_carriers":unresolved,"opaque_artifacts":inventory.artifacts.iter().filter(|a|a.coverage!="xml-enumerated").collect::<Vec<_>>(),"authority_dependencies":{"immutable":inventory.authority_dependencies,"live_context":{"head":self.head(&request.project)?,"reviews":self.receipt(&request.project,request.revision)?["reviews"],"generations":self.generations(&request.project,true)?}},"gates":inventory.limitations,"decision":"blocked; inventory is evidence discovery, not authorization or a remapping proof"}),
        )
    }
}
fn relative_path(source: &str, reference: &str) -> Option<String> {
    let mut parts: Vec<_> = source
        .rsplit_once('/')
        .map_or(Vec::new(), |(parent, _)| parent.split('/').collect());
    for part in reference.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    let path = parts.join("/");
    crate::package::safe_relative(&path).ok()?;
    Some(path)
}

// roxmltree coalesces text/CDATA but reports only the first piece's byte range.
// Enumerate original lexical pieces instead, using the already validated tree
// for parent scope and the shared quote-aware scanner for opening tags.
fn lexical_misc(
    text: &str,
    tree: &roxmltree::Document<'_>,
    path: &str,
    artifact: &Artifact,
    out: &mut Vec<Carrier>,
) -> Result<()> {
    let nodes: BTreeMap<_, _> = tree
        .descendants()
        .filter(|n| n.is_element())
        .map(|n| (n.range().start, n))
        .collect();
    let mut stack: Vec<roxmltree::Node<'_, '_>> = Vec::new();
    let mut pos = 0;
    while pos < text.len() {
        while stack.last().is_some_and(|n| n.range().end <= pos) {
            stack.pop();
        }
        let rest = &text[pos..];
        let (kind, end, value) = if rest.starts_with("<![CDATA[") {
            let length = rest.find("]]>").context("validated CDATA boundary")? + 3;
            ("cdata", pos + length, rest[9..length - 3].to_string())
        } else if rest.starts_with("<!--") {
            let length = rest.find("-->").context("validated comment boundary")? + 3;
            ("comment", pos + length, rest[4..length - 3].to_string())
        } else if rest.starts_with("<?") {
            let length = rest.find("?>").context("validated PI boundary")? + 2;
            (
                if rest.starts_with("<?xml ") {
                    "xml-declaration"
                } else {
                    "processing-instruction"
                },
                pos + length,
                rest[2..length - 2].to_string(),
            )
        } else if rest.starts_with("</") {
            pos += rest.find('>').context("validated closing tag")? + 1;
            continue;
        } else if rest.starts_with('<') {
            let node = nodes.get(&pos).context("validated element lexical scope")?;
            let insert = xml::lexical_attrs(text, pos)?.1;
            stack.push(*node);
            pos = insert
                + if text.as_bytes()[insert] == b'/' {
                    2
                } else {
                    1
                };
            continue;
        } else {
            let length = rest.find('<').unwrap_or(rest.len());
            let raw = &rest[..length];
            let wrapper = format!("<r>{raw}</r>");
            let decoded =
                roxmltree::Document::parse(&wrapper).context("validated lexical text decode")?;
            (
                "text",
                pos + length,
                decoded.root_element().text().unwrap_or("").to_string(),
            )
        };
        let parent = stack.last();
        out.push(Carrier {artifact:path.into(),artifact_hash:artifact.sha256.clone(),element_start:parent.map_or(pos,|n|n.range().start),element:parent.map_or("",|n|n.tag_name().name()).into(),namespace:parent.and_then(|n|n.tag_name().namespace()).map(str::to_string),xml_base:parent.map_or(Vec::new(),|n|n.ancestors().filter_map(|n|n.attribute(("http://www.w3.org/XML/1998/namespace","base"))).map(str::to_string).collect()),kind:kind.into(),qname:String::new(),byte_start:pos,byte_end:end,value,syntax:"unknown".into(),resolution:"unknown-semantics".into(),targets:vec![],note:"Original lexical piece; CDATA, entities, mixed text and markup boundaries remain distinct".into()});
        ensure!(
            out.len() <= MAX_CARRIERS,
            "reference inventory carrier limit; no partial inventory returned"
        );
        pos = end;
    }
    Ok(())
}
