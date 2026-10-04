use crate::model::*;
use anyhow::{bail, ensure, Context, Result};
use roxmltree::{Document as XmlDoc, Node};
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;

pub const MAX_XML_BYTES: usize = 16 * 1024 * 1024;

pub fn parse(text: &str) -> Result<XmlDoc<'_>> {
    ensure!(text.len() <= MAX_XML_BYTES, "XML size limit");
    ensure!(
        !text.contains("<!DOCTYPE") && !text.contains("<!ENTITY"),
        "DTD/entities disabled"
    );
    let doc = XmlDoc::parse(text).context("invalid XML")?;
    ensure!(doc.descendants().count() <= 200_000, "XML node limit");
    for n in doc.descendants() {
        ensure!(n.ancestors().count() <= 128, "XML depth limit");
        for a in n.attributes() {
            ensure!(a.value().len() <= 65536, "XML attribute limit");
        }
    }
    Ok(doc)
}
pub fn escape(text: &str) -> Result<String> {
    ensure!(text.len() <= 65536, "value too large");
    ensure!(
        text.chars()
            .all(|c| matches!(c, '\t' | '\n' | '\r') || c >= '\u{20}'),
        "invalid XML character"
    );
    Ok(text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
        .replace('\n', "&#10;")
        .replace('\r', "&#13;")
        .replace('\t', "&#9;"))
}
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 128
        && name.bytes().enumerate().all(|(i, c)| {
            c.is_ascii_alphabetic() || c == b'_' || (i > 0 && (c.is_ascii_digit() || c == b'-'))
        })
}

// Locate attributes lexically in the opening tag only. DOM is used for validation
// and projection; untouched bytes, quote style, entities and order stay original.
pub(crate) fn lexical_attrs(
    text: &str,
    start: usize,
) -> Result<(BTreeMap<String, Range<usize>>, usize)> {
    let b = text.as_bytes();
    let mut i = start + 1;
    while i < b.len() && !b[i].is_ascii_whitespace() && !matches!(b[i], b'>' | b'/') {
        i += 1;
    }
    let mut attrs = BTreeMap::new();
    loop {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        ensure!(i < b.len(), "unterminated tag");
        if matches!(b[i], b'>' | b'/') {
            return Ok((attrs, i));
        }
        let begin = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' {
            i += 1;
        }
        let name = &text[begin..i];
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        ensure!(b.get(i) == Some(&b'='), "attribute syntax");
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let quote = *b.get(i).context("attribute quote")?;
        ensure!(matches!(quote, b'\'' | b'"'), "attribute quote");
        i += 1;
        let v = i;
        while i < b.len() && b[i] != quote {
            i += 1;
        }
        ensure!(i < b.len(), "attribute terminator");
        attrs.insert(name.into(), v..i);
        i += 1;
    }
}
pub fn patch_attrs(
    text: &str,
    element: &str,
    id: &str,
    fields: &BTreeMap<String, String>,
) -> Result<String> {
    let doc = parse(text)?;
    let nodes: Vec<_> = doc
        .descendants()
        .filter(|n| {
            n.has_tag_name(element)
                && n.attribute("id")
                    .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
                    == Some(id)
        })
        .collect();
    ensure!(nodes.len() == 1, "missing or ambiguous element {id}");
    patch_node(text, nodes[0], fields)
}
pub fn patch_node(
    text: &str,
    node: Node<'_, '_>,
    fields: &BTreeMap<String, String>,
) -> Result<String> {
    let (attrs, insert) = lexical_attrs(text, node.range().start)?;
    let mut patches = Vec::new();
    let mut added = String::new();
    for (k, v) in fields {
        ensure!(valid_name(k), "unsupported attribute name");
        let v = escape(v)?;
        if let Some(r) = attrs.get(k) {
            patches.push((r.clone(), v));
        } else {
            added.push_str(&format!(" {k}=\"{v}\""));
        }
    }
    if !added.is_empty() {
        patches.push((insert..insert, added));
    }
    patches.sort_by_key(|(r, _)| std::cmp::Reverse(r.start));
    let mut result = text.to_owned();
    for (r, v) in patches {
        result.replace_range(r, &v);
    }
    parse(&result)?;
    Ok(result)
}
pub fn append_element(text: &str, xml: &str) -> Result<String> {
    let doc = parse(text)?;
    let root = doc.root_element();
    let range = root.range();
    let (attrs, insert) = lexical_attrs(text, range.start)?;
    drop(attrs);
    let mut result = text.to_owned();
    if text.as_bytes()[insert] == b'/' {
        let qname = text[range.start + 1..insert]
            .split_whitespace()
            .next()
            .context("root name")?;
        result.replace_range(insert..range.end, &format!(">\n{xml}\n</{qname}>"));
    } else {
        let close = text[range.clone()].rfind("</").context("root close")? + range.start;
        result.insert_str(close, &format!("\n{xml}\n"));
    }
    parse(&result)?;
    Ok(result)
}
// Remove only the named unqualified attributes. Keep all surrounding bytes,
// including whitespace, namespace declarations and the element's content.
pub fn remove_attrs(text: &str, element: &str, id: &str, names: &[&str]) -> Result<String> {
    let doc = parse(text)?;
    let nodes: Vec<_> = doc
        .descendants()
        .filter(|n| {
            n.has_tag_name(element)
                && n.attribute("id")
                    .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
                    == Some(id)
        })
        .collect();
    ensure!(nodes.len() == 1, "missing or ambiguous element {id}");
    let start = nodes[0].range().start;
    let (attributes, _) = lexical_attrs(text, start)?;
    let mut ranges = Vec::new();
    for name in names {
        if let Some(value) = attributes.get(*name) {
            let prefix = &text[start..value.start - 1];
            let equals = prefix.rfind('=').context("attribute equals")? + start;
            let name_end = text[start..equals].trim_end().len() + start;
            let name_start = name_end.checked_sub(name.len()).context("attribute name")?;
            ensure!(
                &text[name_start..name_end] == *name,
                "attribute name mismatch"
            );
            ranges.push(name_start..value.end + 1);
        }
    }
    ranges.sort_by_key(|r| std::cmp::Reverse(r.start));
    let mut result = text.to_owned();
    for range in ranges {
        result.replace_range(range, "");
    }
    parse(&result)?;
    Ok(result)
}
fn attrs(n: Node<'_, '_>) -> BTreeMap<String, String> {
    n.attributes()
        .map(|a| (a.name().into(), a.value().into()))
        .collect()
}
pub fn time_us(value: Option<&str>) -> Result<Option<i64>> {
    let Some(value) = value else { return Ok(None) };
    // Imported decimal seconds are interpreted without floating point rounding;
    // lexical spelling remains in the immutable XML.
    ensure!(!value.starts_with('-'), "negative media time");
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    ensure!(
        !whole.is_empty()
            && whole.bytes().all(|c| c.is_ascii_digit())
            && fraction.bytes().all(|c| c.is_ascii_digit())
            && fraction.len() <= 6,
        "unsupported time precision"
    );
    let seconds: i64 = whole.parse()?;
    let micros: i64 = format!("{fraction:0<6}").parse()?;
    Ok(Some(
        seconds
            .checked_mul(1_000_000)
            .and_then(|v| v.checked_add(micros))
            .context("time overflow")?,
    ))
}
pub fn project_document(
    project: &str,
    path: &str,
    text: &str,
    config: &Config,
) -> Result<Document> {
    let doc = parse(text)?;
    let mut ids = BTreeSet::new();
    for n in doc.descendants().filter(|n| n.is_element()) {
        if let Some(id) = n
            .attribute("id")
            .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
        {
            ensure!(ids.insert(id), "duplicate ID {id}");
        }
    }
    let mut tokens = Vec::new();
    let mut segments = Vec::new();
    let mut opaque = BTreeSet::new();
    for n in doc.descendants().filter(|n| n.is_element()) {
        let name = n.tag_name().name();
        if name == "u" {
            let id = n.attribute("id").context("utterance without stable id")?;
            let start = time_us(n.attribute("start"))?;
            let end = time_us(n.attribute("end"))?;
            if let (Some(a), Some(b)) = (start, end) {
                ensure!(a <= b, "reversed interval {id}");
            }
            segments.push(Segment {
                id: id.into(),
                start_us: start,
                end_us: end,
                attrs: attrs(n),
            });
        } else if name == "tok" {
            let id = n
                .attribute("id")
                .or_else(|| n.attribute(("http://www.w3.org/XML/1998/namespace", "id")))
                .context("token without stable id")?;
            let original = n.attribute("form").map(String::from).unwrap_or_else(|| {
                n.descendants()
                    .filter_map(|c| c.is_text().then(|| c.text()).flatten())
                    .collect::<String>()
            });
            let u = n.ancestors().find(|c| c.has_tag_name("u"));
            let explicit = n.attribute("variety");
            let inherited = n.ancestors().skip(1).find_map(|n| n.attribute("variety"));
            let effective = explicit
                .or(inherited)
                .map(String::from)
                .or_else(|| config.language_default.clone());
            let source = if explicit.is_some() {
                "token/variety"
            } else if inherited.is_some() {
                "ancestor/variety"
            } else if config.language_default.is_some() {
                "project/default"
            } else {
                "unknown"
            };
            tokens.push(Token {
                id: id.into(),
                internal_id: format!(
                    "t-{}",
                    &crate::package::hash(format!("{project}\0{path}\0{id}").as_bytes())[..24]
                ),
                original,
                corrected: n.attribute("nform").map(String::from),
                normalized: n.attribute("wb_normalized").map(String::from),
                attrs: attrs(n),
                utterance: u.and_then(|c| c.attribute("id")).map(String::from),
                start_us: time_us(n.attribute("start"))?,
                end_us: time_us(n.attribute("end"))?,
                language_effective: effective,
                language_source: source.into(),
                editable: !n.children().any(|c| c.is_element()),
            });
        } else if ![
            "TEI",
            "teiHeader",
            "fileDesc",
            "titleStmt",
            "title",
            "author",
            "publicationStmt",
            "sourceDesc",
            "p",
            "media",
            "profileDesc",
            "textClass",
            "langUsage",
            "language",
            "revisionDesc",
            "change",
            "text",
            "body",
        ]
        .contains(&name)
        {
            opaque.insert(name.into());
        }
    }
    let token_ids: BTreeSet<_> = tokens.iter().map(|t| t.id.as_str()).collect();
    for t in &tokens {
        if let Some(target) = t.attrs.get("relation_target").filter(|v| !v.is_empty()) {
            ensure!(
                token_ids.contains(target.trim_start_matches('#')),
                "dangling relation {target}"
            );
        }
        if let (Some(a), Some(b)) = (t.start_us, t.end_us) {
            ensure!(a <= b, "reversed token interval");
            if let Some(u) = segments
                .iter()
                .find(|u| Some(&u.id) == t.utterance.as_ref())
            {
                if let (Some(s), Some(e)) = (u.start_us, u.end_us) {
                    ensure!(a >= s && b <= e, "token outside parent interval");
                }
            }
        }
    }
    for n in doc.descendants().filter(|n| n.is_element()) {
        for key in ["corresp", "target", "from", "to"] {
            if let Some(v) = n.attribute(key) {
                for target in v.split_whitespace().filter_map(|v| v.strip_prefix('#')) {
                    ensure!(ids.contains(target), "dangling inline reference {target}");
                }
            }
        }
    }
    let mut metadata = BTreeMap::new();
    for key in ["title", "author", "textClass", "language"] {
        if let Some(n) = doc.descendants().find(|n| n.has_tag_name(key)) {
            metadata.insert(key.into(), n.text().unwrap_or("").into());
        }
    }
    Ok(Document {
        path: path.into(),
        title: metadata
            .get("title")
            .cloned()
            .unwrap_or_else(|| path.into()),
        tokens,
        segments,
        spans: vec![],
        media: doc
            .descendants()
            .filter(|n| n.has_tag_name("media"))
            .filter_map(|n| n.attribute("url"))
            .map(String::from)
            .collect(),
        metadata,
        opaque_elements: opaque.into_iter().collect(),
    })
}
pub fn validate_layers(config: &Config) -> Result<()> {
    let ids: BTreeSet<_> = config.layers.iter().map(|l| l.id.as_str()).collect();
    ensure!(ids.len() == config.layers.len(), "duplicate layer");
    for layer in &config.layers {
        ensure!(
            ["interval", "optional_interval", "instant", "unaligned"]
                .contains(&layer.alignment.as_str()),
            "unsupported alignment"
        );
        let mut seen = BTreeSet::new();
        let mut at = Some(layer.id.as_str());
        while let Some(id) = at {
            ensure!(seen.insert(id), "layer hierarchy cycle");
            let l = config
                .layers
                .iter()
                .find(|l| l.id == id)
                .context("missing parent layer")?;
            at = l.parent.as_deref();
        }
        // Coverage/overlap constraints need complete observed anchors. Do not
        // claim enforcement of a schema this slice cannot validate.
        if layer.coverage || !layer.overlap {
            bail!("coverage/non-overlap schema requires later validator");
        }
    }
    Ok(())
}
