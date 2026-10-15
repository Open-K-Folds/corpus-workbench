use corpus_workbench::{
    model::{Command, Operation},
    store::{Fault, Store},
};
use rusqlite::params;
use std::{collections::BTreeMap, fs};
use tempfile::TempDir;

fn fixture() -> (TempDir, Store) {
    let tmp = TempDir::new().unwrap();
    let input = tmp.path().join("input");
    fs::create_dir_all(input.join("Resources")).unwrap();
    fs::create_dir_all(input.join("xmlfiles")).unwrap();
    fs::write(input.join("Resources/settings.xml"), "<ttsettings/>").unwrap();
    fs::write(
        input.join("xmlfiles/demo.xml"),
        "<TEI><text><u id='u-1'><tok id='w-1' form='synthetic'>synthetic</tok></u></text></TEI>",
    )
    .unwrap();
    let mut store = Store::open(&tmp.path().join("authority")).unwrap();
    store.import(&input, "p").unwrap();
    (tmp, store)
}

#[test]
fn current_exact_review_history_is_empty_then_persists_the_complete_record() {
    let (tmp, mut store) = fixture();
    let revision = store.head("p").unwrap();
    let initial = store.reviews("p", None).unwrap();
    assert_eq!(initial.revision, revision.id);
    assert_eq!(initial.snapshot_hash, revision.snapshot_hash);
    assert!(initial.reviews.is_empty());

    let receipt = store
        .review(
            "local-owner",
            "p",
            revision.id,
            &revision.snapshot_hash,
            "approved",
            "Synthetic review rationale, retained exactly.\nSecond line 😀",
        )
        .unwrap();
    let history = store.reviews("p", Some(revision.id)).unwrap();
    assert_eq!(history.reviews.len(), 1);
    let record = &history.reviews[0];
    assert_eq!(record.id, receipt["review_id"].as_i64().unwrap());
    assert_eq!(record.revision, revision.id);
    assert_eq!(record.snapshot_hash, revision.snapshot_hash);
    assert_eq!(record.actor, "local-owner");
    assert_eq!(record.decision, "approved");
    assert_eq!(record.scope, "full");
    assert_eq!(
        record.note,
        "Synthetic review rationale, retained exactly.\nSecond line 😀"
    );
    assert!(record.created_at.ends_with('Z'));
    assert!(record.self_review);
    assert_eq!(history, store.reviews("p", None).unwrap());
    drop(store);
    let reopened = Store::open(&tmp.path().join("authority")).unwrap();
    assert_eq!(history, reopened.reviews("p", None).unwrap());
}

#[test]
fn repeated_decisions_are_returned_latest_first_without_rewriting_history() {
    let (_tmp, mut store) = fixture();
    let revision = store.head("p").unwrap();
    let decisions = ["approved", "rejected", "needs-adjudication"];
    let mut ids = Vec::new();
    for decision in decisions {
        let receipt = store
            .review(
                "local-owner",
                "p",
                revision.id,
                &revision.snapshot_hash,
                decision,
                &format!("Synthetic {decision} rationale"),
            )
            .unwrap();
        ids.push(receipt["review_id"].as_i64().unwrap());
    }
    let history = store.reviews("p", None).unwrap();
    assert_eq!(
        history.reviews.iter().map(|r| r.id).collect::<Vec<_>>(),
        ids.into_iter().rev().collect::<Vec<_>>()
    );
    assert_eq!(
        history
            .reviews
            .iter()
            .map(|r| r.decision.as_str())
            .collect::<Vec<_>>(),
        decisions.into_iter().rev().collect::<Vec<_>>()
    );
    for record in &history.reviews {
        assert_eq!(
            record.note,
            format!("Synthetic {} rationale", record.decision)
        );
    }
    assert!(!store.view("p", None).unwrap().approved);
}

#[test]
fn new_and_restored_revisions_do_not_inherit_historical_review_decisions() {
    let (_tmp, mut store) = fixture();
    let original = store.head("p").unwrap();
    store
        .review(
            "local-owner",
            "p",
            original.id,
            &original.snapshot_hash,
            "approved",
            "Synthetic original review",
        )
        .unwrap();
    let historical = store.reviews("p", Some(original.id)).unwrap();
    let edited = store
        .apply(
            "local-owner",
            &Command {
                schema: 1,
                project: "p".into(),
                command_id: "synthetic-review-edit".into(),
                base_revision: original.id,
                preimage_hash: original.snapshot_hash,
                config_version: 1,
                label: "Synthetic correction after review".into(),
                operations: vec![Operation::SetToken {
                    document: "xmlfiles/demo.xml".into(),
                    token: "w-1".into(),
                    fields: BTreeMap::from([("nform".into(), "corrected".into())]),
                }],
            },
            Fault::None,
        )
        .unwrap();
    let current = store.reviews("p", None).unwrap();
    assert_eq!(current.revision, edited.id);
    assert_eq!(current.snapshot_hash, edited.snapshot_hash);
    assert!(current.reviews.is_empty());
    assert!(!store.view("p", None).unwrap().approved);
    assert_eq!(historical, store.reviews("p", Some(original.id)).unwrap());

    let restored = store
        .apply(
            "local-owner",
            &Command {
                schema: 1,
                project: "p".into(),
                command_id: "synthetic-review-restore".into(),
                base_revision: edited.id,
                preimage_hash: edited.snapshot_hash,
                config_version: 1,
                label: "Synthetic restore preserves independent review history".into(),
                operations: vec![Operation::Restore {
                    revision: original.id,
                }],
            },
            Fault::None,
        )
        .unwrap();
    let current = store.reviews("p", None).unwrap();
    assert_eq!(current.revision, restored.id);
    assert!(current.reviews.is_empty());
    assert_eq!(historical, store.reviews("p", Some(original.id)).unwrap());
    assert!(!store.view("p", None).unwrap().approved);
}

#[test]
fn review_reads_authorize_project_and_filter_the_exact_snapshot() {
    let (tmp, mut store) = fixture();
    let revision = store.head("p").unwrap();
    store
        .review(
            "local-owner",
            "p",
            revision.id,
            &revision.snapshot_hash,
            "rejected",
            "Synthetic in-scope decision",
        )
        .unwrap();
    let foreign = store.import(&tmp.path().join("input"), "other").unwrap();
    store
        .review(
            "local-owner",
            "other",
            foreign.id,
            &foreign.snapshot_hash,
            "approved",
            "Synthetic separate project decision",
        )
        .unwrap();
    assert!(store.reviews("p", Some(foreign.id)).is_err());
    assert!(store.reviews("other", Some(revision.id)).is_err());
    assert!(store.reviews("missing", None).is_err());
    assert!(store.reviews("p", Some(i64::MAX)).is_err());

    // A ledger row with the same revision but a different hash is not a
    // decision about this immutable snapshot and must never be displayed.
    store
        .conn
        .execute(
            "INSERT INTO reviews(project,revision,snapshot_hash,actor,decision,scope,note) VALUES(?,?,?,'local-owner','approved','full','synthetic different hash')",
            params!["p", revision.id, "0".repeat(64)],
        )
        .unwrap();
    let history = store.reviews("p", Some(revision.id)).unwrap();
    assert_eq!(history.reviews.len(), 1);
    assert_eq!(history.reviews[0].decision, "rejected");
    assert_eq!(history.reviews[0].note, "Synthetic in-scope decision");
    assert_eq!(history.reviews[0].snapshot_hash, revision.snapshot_hash);
    assert_eq!(store.reviews("other", None).unwrap().reviews.len(), 1);
}
