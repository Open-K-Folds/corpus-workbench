//! Ordered language transitions over immutable, synthetic corpus evidence.
use corpus_workbench::{
    model::{Command, Operation},
    search::{Mode, Query, Reading, Resolve, Term},
    store::{Fault, Store},
};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;

const PROJECT: &str = "languages";
const DOC: &str = "xmlfiles/mixed.xml";
const UNKNOWN_DOC: &str = "xmlfiles/unknown.xml";
const CUSTOM: &str = "  isiXhosa / local e\u{301}  ";
const AUDIO: &[u8] = b"synthetic language-transition media";
const INDEX: &[u8] = b"opaque imported offsets remain unverified";

fn source() -> String {
    format!(
        "<TEI><teiHeader><title>Synthetic language transitions</title><media url='tone.wav'/></teiHeader><text variety='xh'>\
         <u id='switch' start='2' end='6'><tok id='a1' form='left' start='2.1' end='2.4'/><tok id='a2' form='right' variety='zu' start='2.5' end='2.9'/></u>\
         <u id='reverse' start='7' end='9'><tok id='b1' form='left' variety='zu'/><tok id='b2' form='right'/></u>\
         <u id='same'><tok id='c1' form='left'/><tok id='c2' form='right'/></u>\
         <u id='literal'><tok id='d1' form=' café ' variety='{CUSTOM}'/><tok id='d2' form='right' variety='zu'/></u>\
         </text></TEI>"
    )
}

fn fixture() -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let package = tmp.path().join("package");
    for dir in ["Resources", "xmlfiles", "Audio", "CWB"] {
        fs::create_dir_all(package.join(dir)).unwrap();
    }
    fs::write(package.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(package.join(DOC), source()).unwrap();
    fs::write(
        package.join("xmlfiles/english.xml"),
        "<TEI><text variety='en'><tok id='e1' form='left'/><tok id='e2' form='right'/></text></TEI>",
    )
    .unwrap();
    fs::write(
        package.join(UNKNOWN_DOC),
        "<TEI><text><tok id='x1' form='left'/><tok id='x2' form='right' variety=''/></text></TEI>",
    )
    .unwrap();
    fs::write(package.join("Audio/tone.wav"), AUDIO).unwrap();
    fs::write(package.join("CWB/offsets"), INDEX).unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    store.import(&package, PROJECT).unwrap();
    (tmp, store)
}

fn query(store: &Store, terms: &[(&str, Option<&str>)]) -> Query {
    let head = store.head(PROJECT).unwrap();
    Query {
        schema: 1,
        project: PROJECT.into(),
        revision: head.id,
        snapshot_hash: head.snapshot_hash,
        mode: Mode::Current,
        reading: Reading::Original,
        terms: terms
            .iter()
            .map(|(text, language)| Term {
                text: (*text).into(),
                language: language.map(String::from),
            })
            .collect(),
        span: None,
        documents: vec![],
        context: 2,
        offset: 0,
        limit: 1,
    }
}

#[test]
fn ordered_languages_filter_counts_pages_and_exact_result_proofs() {
    let (_tmp, store) = fixture();
    let before = store.view(PROJECT, None).unwrap();
    let transition = query(&store, &[("left", Some("xh")), ("right", Some("zu"))]);
    let page = store.search(&transition).unwrap();
    assert_eq!(page.result.total, 1);
    assert_eq!(page.result.hits[0].token_ids, ["a1", "a2"]);
    assert!(page.result.next_offset.is_none());
    assert_eq!(
        page.result.hits[0].matched[0].language_source,
        "ancestor/variety"
    );
    assert_eq!(
        page.result.hits[0].matched[1].language_source,
        "token/variety"
    );
    assert_eq!(page.result.binding.revision, before.revision.id);
    assert_eq!(
        page.result.binding.snapshot_hash,
        before.revision.snapshot_hash
    );
    assert_eq!(
        serde_json::to_vec(&page).unwrap(),
        serde_json::to_vec(&store.search(&transition).unwrap()).unwrap()
    );

    let mut reverse_languages = transition.clone();
    reverse_languages.terms[0].language = Some("zu".into());
    reverse_languages.terms[1].language = Some("xh".into());
    let reverse = store.search(&reverse_languages).unwrap();
    assert_eq!(reverse.result.total, 1);
    assert_eq!(reverse.result.hits[0].token_ids, ["b1", "b2"]);
    let mut reverse_terms = transition.clone();
    reverse_terms.terms.reverse();
    assert_eq!(store.search(&reverse_terms).unwrap().result.total, 0);

    let mut any_second = transition.clone();
    any_second.terms[1].language = None;
    let first = store.search(&any_second).unwrap();
    assert_eq!(first.result.total, 2);
    assert_eq!(first.result.hits[0].token_ids, ["a1", "a2"]);
    assert_eq!(first.result.next_offset, Some(1));
    any_second.offset = 1;
    let second = store.search(&any_second).unwrap();
    assert_eq!(second.result.total, 2);
    assert_eq!(second.result.hits[0].token_ids, ["c1", "c2"]);
    assert!(second.result.next_offset.is_none());

    // The same occurrence under a relaxed filter needs its own exact page proof.
    let mut any_first = transition.clone();
    any_first.terms[0].language = None;
    let relaxed = store.search(&any_first).unwrap();
    assert_eq!(relaxed.result.total, 1);
    assert_eq!(relaxed.result.hits[0].id, page.result.hits[0].id);
    assert_eq!(
        relaxed.result.binding.projection_hash,
        page.result.binding.projection_hash
    );
    assert_ne!(relaxed.result_hash, page.result_hash);
    let mut resolve = Resolve {
        query: transition,
        result_hash: page.result_hash,
        hit_id: page.result.hits[0].id.clone(),
    };
    assert!(store.resolve_search_hit(&resolve).is_ok());
    resolve.query = any_first;
    assert!(store
        .resolve_search_hit(&resolve)
        .unwrap_err()
        .to_string()
        .contains("proof mismatch"));

    let mut any = query(&store, &[("left", None), ("right", None)]);
    assert_eq!(store.search(&any).unwrap().result.total, 5);
    assert_eq!(
        store
            .search(&query(&store, &[("left", Some("en")), ("right", None)]))
            .unwrap()
            .result
            .total,
        1
    );
    any.documents = vec![UNKNOWN_DOC.into()];
    let unknown = store.search(&any).unwrap();
    assert_eq!(unknown.result.total, 1);
    assert_eq!(unknown.result.hits[0].matched[0].language, None);
    assert_eq!(
        unknown.result.hits[0].matched[1].language.as_deref(),
        Some("")
    );
    any.terms[0].language = Some("xh".into());
    assert_eq!(store.search(&any).unwrap().result.total, 0);
    let after = store.view(PROJECT, None).unwrap();
    assert_eq!(after.snapshot.files, before.snapshot.files);
    assert_eq!(after.revision.snapshot_hash, before.revision.snapshot_hash);
    assert!(after.snapshot.index_status.contains("unverified"));
}

#[test]
fn custom_languages_and_token_spelling_remain_literal_and_empty_is_not_any() {
    let (_tmp, store) = fixture();
    let exact = query(&store, &[(" café ", Some(CUSTOM)), ("right", Some("zu"))]);
    let page = store.search(&exact).unwrap();
    assert_eq!(page.result.total, 1);
    assert_eq!(page.result.hits[0].token_ids, ["d1", "d2"]);
    assert_eq!(
        page.result.hits[0].matched[0].language.as_deref(),
        Some(CUSTOM)
    );
    let exported = serde_json::to_value(&page).unwrap();
    assert_eq!(exported["result"]["query"]["terms"][0]["text"], " café ");
    assert_eq!(exported["result"]["query"]["terms"][0]["language"], CUSTOM);
    assert_eq!(exported["result"]["query"]["terms"][1]["language"], "zu");

    for changed in [
        CUSTOM.trim(),
        "  isiXhosa / local é  ",
        "  isiXhosa / local E\u{301}  ",
    ] {
        let mut q = exact.clone();
        q.terms[0].language = Some(changed.into());
        assert_eq!(store.search(&q).unwrap().result.total, 0, "{changed:?}");
    }
    let mut q = exact.clone();
    q.terms[0].text = "café".into();
    assert_eq!(store.search(&q).unwrap().result.total, 0);
    q = exact.clone();
    q.terms[0].language = Some(String::new());
    assert!(store
        .search(&q)
        .unwrap_err()
        .to_string()
        .contains("language filter length limit"));
    q.terms[0].language = None;
    assert_eq!(store.search(&q).unwrap().result.total, 1);
}

#[test]
fn language_edits_stale_current_proofs_but_history_preserves_audio_and_export() {
    let (tmp, mut store) = fixture();
    let before = store.view(PROJECT, None).unwrap();
    let current = query(&store, &[("left", Some("xh")), ("right", Some("zu"))]);
    let page = store.search(&current).unwrap();
    let audio = page.result.hits[0].audio.as_ref().unwrap();
    assert_eq!(audio.path, "Audio/tone.wav");
    assert_eq!(
        audio.artifact_hash,
        before.snapshot.files[&audio.path].sha256
    );
    assert_eq!((audio.start_us, audio.end_us), (2_100_000, 2_900_000));
    assert_eq!(audio.basis, "word_intervals");

    store
        .apply(
            "local-owner",
            &Command {
                schema: 1,
                project: PROJECT.into(),
                command_id: "language-correction".into(),
                base_revision: before.revision.id,
                preimage_hash: before.revision.snapshot_hash,
                config_version: before.snapshot.config.version,
                label: "Synthetic language correction".into(),
                operations: vec![
                    Operation::DefineLanguage {
                        value: "zu".into(),
                        description: "Synthetic exact language value".into(),
                    },
                    Operation::SetToken {
                        document: DOC.into(),
                        token: "a1".into(),
                        fields: BTreeMap::from([("variety".into(), "zu".into())]),
                    },
                ],
            },
            Fault::None,
        )
        .unwrap();
    assert!(store
        .search(&current)
        .unwrap_err()
        .to_string()
        .contains("stale"));
    assert!(store
        .resolve_search_hit(&Resolve {
            query: current.clone(),
            result_hash: page.result_hash.clone(),
            hit_id: page.result.hits[0].id.clone(),
        })
        .is_err());
    assert_eq!(
        store
            .search(&query(
                &store,
                &[("left", Some("xh")), ("right", Some("zu"))]
            ))
            .unwrap()
            .result
            .total,
        0
    );

    let mut historical = current;
    historical.mode = Mode::Historical;
    let retained = store.search(&historical).unwrap();
    assert_eq!(retained.result.total, 1);
    assert_eq!(retained.result.hits[0].id, page.result.hits[0].id);
    assert_eq!(
        retained.result.binding.projection_hash,
        page.result.binding.projection_hash
    );
    assert_eq!(
        serde_json::to_value(&retained.result.hits[0]).unwrap(),
        serde_json::to_value(&page.result.hits[0]).unwrap()
    );
    let resolved = store
        .resolve_search_hit(&Resolve {
            query: historical,
            result_hash: retained.result_hash,
            hit_id: retained.result.hits[0].id.clone(),
        })
        .unwrap();
    assert_eq!(resolved["historical"], true);
    assert_eq!(resolved["binding"]["revision"], before.revision.id);
    assert_eq!(resolved["hit"]["matched"][0]["language"], "xh");
    assert_eq!(resolved["hit"]["matched"][1]["language"], "zu");
    let export = tmp.path().join("historical-export");
    store.export(PROJECT, before.revision.id, &export).unwrap();
    assert_eq!(fs::read(export.join(DOC)).unwrap(), source().as_bytes());
    assert_eq!(fs::read(export.join("Audio/tone.wav")).unwrap(), AUDIO);
    assert_eq!(fs::read(export.join("CWB/offsets")).unwrap(), INDEX);
}
