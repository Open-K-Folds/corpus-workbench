//! Read-only lexical layout projection. It does not change canonical document/export DTOs.
use anyhow::{ensure, Result};
use roxmltree::{Document, Node};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Run {
    pub token: Option<String>,
    pub text: String,
}
#[derive(Debug, Serialize)]
pub struct Block {
    pub source_id: Option<String>,
    pub source_kind: String,
    pub anchor_token: Option<String>,
    pub sections: Vec<Section>,
    pub runs: Vec<Run>,
}
#[derive(Debug, Serialize)]
pub struct Section {
    pub id: String,
    pub kind: String,
    pub number: Option<String>,
}

fn source_id(node: Node<'_, '_>) -> Option<String> {
    node.attribute("id")
        .or_else(|| node.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
        .map(str::to_owned)
}

pub fn project(xml: &str) -> Result<Vec<Block>> {
    let doc = Document::parse(xml)?;
    let root = doc.root_element();
    let mut blocks: Vec<Block> = Vec::new();
    let mut owner = None;
    let mut seen = std::collections::BTreeSet::new();
    for node in root.descendants() {
        if node.ancestors().skip(1).any(|n| n.has_tag_name("tok")) {
            continue;
        }
        let run = if node.has_tag_name("tok") {
            let id = source_id(node).ok_or_else(|| anyhow::anyhow!("token without stable ID"))?;
            ensure!(seen.insert(id.clone()), "duplicate token identity");
            Run {
                token: Some(id),
                text: node
                    .attribute("form")
                    .map(str::to_owned)
                    .unwrap_or_else(|| {
                        node.descendants()
                            .filter_map(|n| n.text().filter(|_| n.is_text()))
                            .collect()
                    }),
            }
        } else if node.is_text() {
            if node.ancestors().any(|n| n.has_tag_name("teiHeader")) {
                continue;
            }
            Run {
                token: None,
                text: node.text().unwrap_or_default().to_owned(),
            }
        } else {
            continue;
        };
        let container = node
            .ancestors()
            .find(|n| n.has_tag_name("u") || n.has_tag_name("p"))
            .unwrap_or(root);
        if owner != Some(container.id()) {
            blocks.push(Block {
                source_id: source_id(container),
                source_kind: container.tag_name().name().to_owned(),
                anchor_token: None,
                sections: container
                    .ancestors()
                    .filter(|n| n.has_tag_name("div"))
                    .filter_map(|n| {
                        source_id(n).map(|id| Section {
                            id,
                            kind: n.attribute("type").unwrap_or("section").to_owned(),
                            number: n.attribute("n").map(str::to_owned),
                        })
                    })
                    .collect(),
                runs: Vec::new(),
            });
            owner = Some(container.id());
        }
        let block = blocks.last_mut().unwrap();
        if block.anchor_token.is_none() {
            block.anchor_token = run.token.clone();
        }
        block.runs.push(run);
    }
    // XML indentation between structural blocks is retained in the projection as well.
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn text(xml: &str) -> String {
        project(xml)
            .unwrap()
            .iter()
            .flat_map(|b| &b.runs)
            .map(|r| r.text.as_str())
            .collect()
    }
    #[test]
    fn adjacency_is_not_an_invented_space() {
        assert_eq!(
            text("<text><tok id='a'>a</tok><tok id='b'>b</tok></text>"),
            "ab"
        );
    }
    #[test]
    fn separators_entities_and_cdata_are_exact() {
        assert_eq!(
            text("<text><tok id='a'>A</tok>,  \t\n&#160;<![CDATA[<x>]]><tok id='b'>B</tok></text>"),
            "A,  \t\n\u{a0}<x>B"
        );
    }
    #[test]
    fn token_form_and_unknown_wrapper_are_distinct() {
        assert_eq!(
            text("<text><unknown><tok id='a' form='😀'>body</tok>!</unknown></text>"),
            "😀!"
        );
    }
    #[test]
    fn nested_token_body_is_not_duplicated() {
        assert_eq!(text("<text><tok id='a'><b>ab</b>c</tok></text>"), "abc");
    }
    #[test]
    fn source_ids_and_fallback_anchor_are_explicit() {
        let b = project(
            "<body><u xml:id='u1'><tok id='a'>A</tok></u><p><tok id='b'>B</tok></p></body>",
        )
        .unwrap();
        assert_eq!(b[0].source_id.as_deref(), Some("u1"));
        assert_eq!(b[1].source_id, None);
        assert_eq!(b[1].anchor_token.as_deref(), Some("b"));
    }
    #[test]
    fn duplicate_tokens_are_rejected() {
        assert!(project("<text><tok id='a'/><tok id='a'/></text>").is_err());
    }
    #[test]
    fn headers_are_not_transcript() {
        assert_eq!(text("<TEI><teiHeader><title>Metadata</title></teiHeader><text><tok id='a'>A</tok></text></TEI>"),"A");
    }
    #[test]
    fn unicode_is_not_normalized() {
        assert_eq!(text("<text><tok id='a'>é👩‍💻مرحبا</tok></text>"), "é👩‍💻مرحبا");
    }
    #[test]
    fn multiple_bodies_are_not_silently_omitted() {
        assert_eq!(text("<TEI><text><body><tok id='a'>A</tok></body><body><tok id='b'>B</tok></body></text></TEI>"), "AB");
    }
    #[test]
    fn section_references_come_from_actual_xml() {
        let blocks=project("<TEI><text><div type='chapter' id='chapter-a' n='3'><u id='u1'><tok id='a'>A</tok></u></div></text></TEI>").unwrap();
        assert_eq!(blocks[0].sections[0].id, "chapter-a");
        assert_eq!(blocks[0].sections[0].kind, "chapter");
        assert_eq!(blocks[0].sections[0].number.as_deref(), Some("3"));
    }
}
