use corpus_workbench::{
    model::*,
    search::*,
    store::{Fault, Store},
};
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;
fn fixture() -> (TempDir, Store) {
    let temp = TempDir::new().unwrap();
    let package = temp.path().join("package");
    for name in ["Resources", "xmlfiles", "Audio", "CWB"] {
        fs::create_dir_all(package.join(name)).unwrap();
    }
    fs::write(package.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(package.join("Audio/tone.wav"), b"synthetic media").unwrap();
    fs::write(
        package.join("CWB/stale-index"),
        b"opaque old source offsets",
    )
    .unwrap();
    fs::write(package.join("xmlfiles/a.xml"),"<TEI><teiHeader><title>SYNTHETIC Unicode</title><media url='tone.wav'/></teiHeader><text><u id='u1' start='2' end='6' who='synthetic'><tok id='a1' form='raw' nform='é' wb_normalized='é' variety='custom'>raw</tok><tok id='a2' form='🙂' variety='custom'>🙂</tok><tok id='a3' form='again'>again</tok></u><u id='u2' start='4' end='8'><tok id='a4' form='again' start='4.2' end='4.9'>again</tok><tok id='a5' form='again' start='4.7' end='5.1'>again</tok><tok id='a6' form='again'>again</tok></u></text></TEI>").unwrap();
    fs::write(package.join("xmlfiles/b.xml"),"<TEI><text><tok id='a1' form='again'>again</tok><tok id='b2' form='é'>é</tok><tok id='b3' form='🙂'>🙂</tok></text></TEI>").unwrap();
    let mut store = Store::open(&temp.path().join("authority")).unwrap();
    store.import(&package, "search").unwrap();
    (temp, store)
}
fn query(s: &Store, words: &[&str]) -> Query {
    let r = s.head("search").unwrap();
    Query {
        schema: 1,
        project: "search".into(),
        revision: r.id,
        snapshot_hash: r.snapshot_hash,
        mode: Mode::Current,
        reading: Reading::Corrected,
        terms: words
            .iter()
            .map(|s| Term {
                text: (*s).into(),
                language: None,
            })
            .collect(),
        documents: vec![],
        context: 2,
        offset: 0,
        limit: 50,
    }
}
#[test]
fn exact_unicode_readings_are_distinct_and_sources_untouched() {
    let (_temp, s) = fixture();
    let before = s.view("search", None).unwrap();
    let q = query(&s, &["é", "🙂"]);
    let a = s.search(&q).unwrap();
    assert_eq!(a.result.total, 2);
    assert_ne!(a.result.hits[0].id, a.result.hits[1].id);
    assert_eq!(a.result.hits[0].token_ids, vec!["a1", "a2"]);
    let mut original = q.clone();
    original.reading = Reading::Original;
    assert_eq!(s.search(&original).unwrap().result.total, 1);
    let mut normalized = q.clone();
    normalized.reading = Reading::Normalized;
    assert_eq!(s.search(&normalized).unwrap().result.total, 1);
    normalized.terms[0].text = "é".into();
    assert_eq!(s.search(&normalized).unwrap().result.total, 1);
    let after = s.view("search", None).unwrap();
    assert_eq!(before.snapshot.files, after.snapshot.files);
    assert_eq!(before.revision.snapshot_hash, after.revision.snapshot_hash);
    assert!(after.snapshot.index_status.contains("unverified"));
    assert_eq!(
        serde_json::to_vec(&a).unwrap(),
        serde_json::to_vec(&s.search(&q).unwrap()).unwrap()
    );
}
#[test]
fn language_and_document_filters_precede_counts() {
    let (_temp, s) = fixture();
    let mut q = query(&s, &["é", "🙂"]);
    for t in &mut q.terms {
        t.language = Some("custom".into())
    }
    assert_eq!(s.search(&q).unwrap().result.total, 1);
    q.documents = vec!["xmlfiles/b.xml".into()];
    assert_eq!(s.search(&q).unwrap().result.total, 0);
    q.terms.iter_mut().for_each(|t| t.language = None);
    assert_eq!(s.search(&q).unwrap().result.total, 1);
    q.documents[0] = "missing.xml".into();
    assert!(s.search(&q).is_err());
}
#[test]
fn boundaries_overlap_pagination_and_kwic_are_exact() {
    let (_temp, s) = fixture();
    let mut q = query(&s, &["again", "again"]);
    q.limit = 1;
    let first = s.search(&q).unwrap();
    assert_eq!(first.result.total, 2);
    assert_eq!(first.result.next_offset, Some(1));
    assert!(first.result.hits[0].left.is_empty());
    assert_eq!(first.result.hits[0].token_ids, vec!["a4", "a5"]);
    q.offset = 1;
    let second = s.search(&q).unwrap();
    assert_eq!(second.result.total, 2);
    assert_eq!(second.result.next_offset, None);
    assert_eq!(second.result.hits[0].token_ids, vec!["a5", "a6"]);
    assert_eq!(second.result.hits[0].left[0].id, "a4");
    q.offset = 5;
    assert!(s.search(&q).unwrap().result.hits.is_empty());
    let q = query(&s, &["again", "é"]);
    let hits = s.search(&q).unwrap();
    assert_eq!(hits.result.total, 1);
    assert_eq!(hits.result.hits[0].document, "xmlfiles/b.xml");
    assert_eq!(hits.result.hits[0].corpus_start, 6);
}
#[test]
fn audio_uses_observed_word_or_complete_utterance_intervals() {
    let (_temp, s) = fixture();
    let a = s.search(&query(&s, &["é", "🙂"])).unwrap();
    let audio = a.result.hits[0].audio.as_ref().unwrap();
    assert_eq!(audio.basis, "utterance_interval");
    assert_eq!((audio.start_us, audio.end_us), (2_000_000, 6_000_000));
    assert!(a.result.hits[1].audio.is_none());
    let a = s.search(&query(&s, &["again", "again"])).unwrap();
    let word = a.result.hits[0].audio.as_ref().unwrap();
    assert_eq!(word.basis, "word_intervals");
    assert_eq!((word.start_us, word.end_us), (4_200_000, 5_100_000));
    assert_eq!(
        a.result.hits[1].audio.as_ref().unwrap().basis,
        "utterance_interval"
    );
}
#[test]
fn editing_invalidates_current_hits_while_explicit_history_remains_exact() {
    let (_temp, mut s) = fixture();
    let q = query(&s, &["é"]);
    let first = s.search(&q).unwrap();
    let old = s.view("search", None).unwrap();
    s.apply(
        "local-owner",
        &Command {
            schema: 1,
            project: "search".into(),
            command_id: "correction".into(),
            base_revision: old.revision.id,
            preimage_hash: old.revision.snapshot_hash,
            config_version: old.snapshot.config.version,
            label: "Synthetic correction".into(),
            operations: vec![Operation::SetToken {
                document: "xmlfiles/a.xml".into(),
                token: "a1".into(),
                fields: BTreeMap::from([("nform".into(), "new".into())]),
            }],
        },
        Fault::None,
    )
    .unwrap();
    assert!(s.search(&q).unwrap_err().to_string().contains("stale"));
    assert!(s
        .resolve_search_hit(&Resolve {
            query: q.clone(),
            result_hash: first.result_hash,
            hit_id: first.result.hits[0].id.clone()
        })
        .is_err());
    let mut historical = q;
    historical.mode = Mode::Historical;
    let old_again = s.search(&historical).unwrap();
    assert_eq!(old_again.result.total, 2);
    assert_eq!(
        old_again.result.binding.projection_hash,
        first.result.binding.projection_hash
    );
    assert_eq!(old_again.result.hits[0].id, first.result.hits[0].id);
    let resolved = s
        .resolve_search_hit(&Resolve {
            query: historical,
            result_hash: old_again.result_hash,
            hit_id: old_again.result.hits[0].id.clone(),
        })
        .unwrap();
    assert_eq!(resolved["historical"], true);
    assert_eq!(resolved["binding"]["revision"], old.revision.id);
    let mut new = query(&s, &["new"]);
    new.reading = Reading::Normalized;
    assert_eq!(s.search(&new).unwrap().result.total, 1);
    assert_ne!(
        s.search(&new).unwrap().result.binding.projection_hash,
        old_again.result.binding.projection_hash
    );
}
