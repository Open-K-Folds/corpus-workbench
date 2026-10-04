//! A finite reader profile, never a generic permission to reinterpret settings.
use crate::{handoff::digest, model::Snapshot, package, store::Store};
use anyhow::{ensure, Result};
use serde::Serialize;
use std::collections::BTreeMap;
pub const PROFILE: &str = "teitok-workbench-reader/1";
pub const SETTINGS_PATH: &str = "Resources/settings.xml";
pub const DEFINITION_PATH: &str = "Annotations/review_def.xml";
pub const SETTINGS: &str = include_str!("../assets/teitok-reader/settings.xml");
pub const DEFINITION: &str = include_str!("../assets/teitok-reader/review_def.xml");
pub fn files() -> BTreeMap<String, String> {
    BTreeMap::from([
        (SETTINGS_PATH.into(), SETTINGS.into()),
        (DEFINITION_PATH.into(), DEFINITION.into()),
    ])
}
pub fn profile_hash() -> Result<String> {
    digest(&(PROFILE, files()))
}
pub(crate) fn known(path: &str, bytes: &[u8]) -> bool {
    matches!(path, SETTINGS_PATH | DEFINITION_PATH)
        && files()
            .get(path)
            .is_some_and(|value| value.as_bytes() == bytes)
}
pub(crate) fn scope_blockers(snapshot: &Snapshot) -> Vec<String> {
    let mut owners = BTreeMap::<String, usize>::new();
    let mut blockers = Vec::new();
    for (path, artifact) in &snapshot.files {
        if artifact.role == "transcript" {
            let basename = path.rsplit('/').next().unwrap_or(path);
            if !path
                .strip_prefix("xmlfiles/")
                .is_some_and(|name| !name.contains('/') && name.ends_with(".xml"))
            {
                blockers.push(format!("{path}: packaged reader requires a direct, case-exact xmlfiles/*.xml transcript path"));
            }
            *owners
                .entry(format!("Annotations/review_{basename}"))
                .or_default() += 1;
        }
    }
    blockers.extend(snapshot.files.keys().filter(|path| {
        path.to_lowercase().starts_with("annotations/")
            && path.as_str() != DEFINITION_PATH
            && owners.get(path.as_str()) != Some(&1)
    }).map(|path| format!("{path}: other annotation families or noncanonical/ambiguous reader paths require their own reader configuration")));
    blockers
}
#[derive(Serialize)]
pub struct ReaderPreview {
    pub profile: String,
    pub profile_hash: String,
    pub revision: i64,
    pub snapshot_hash: String,
    pub enabled: bool,
    pub installed: bool,
    pub blockers: Vec<String>,
    pub candidate_xml: BTreeMap<String, String>,
    pub before_hashes: BTreeMap<String, Option<String>>,
}
impl Store {
    pub fn teitok_reader_preview(&self, project: &str, revision: i64) -> Result<ReaderPreview> {
        let head = self.head(project)?;
        ensure!(head.id == revision, "stale reader configuration revision");
        let snapshot = self.snapshot(&head)?;
        let mut preview = ReaderPreview {
            profile: PROFILE.into(),
            profile_hash: profile_hash()?,
            revision,
            snapshot_hash: head.snapshot_hash,
            enabled: false,
            installed: false,
            blockers: vec![],
            candidate_xml: files(),
            before_hashes: BTreeMap::new(),
        };
        for (path, candidate) in &preview.candidate_xml {
            let folded = path.to_lowercase();
            if snapshot.files.keys().any(|existing| {
                existing != path && {
                    let existing = existing.to_lowercase();
                    existing == folded
                        || existing.starts_with(&(folded.clone() + "/"))
                        || folded.starts_with(&(existing + "/"))
                }
            }) {
                preview.blockers.push(format!(
                    "{path}: case-folded file/directory collision; supplied artifacts retained"
                ));
            }
            let existing = snapshot.files.get(path);
            preview.before_hashes.insert(
                path.clone(),
                existing.map(|artifact| artifact.sha256.clone()),
            );
            if let Some(existing) = existing {
                let bytes = self.objects.read(existing)?;
                let empty_settings = path == SETTINGS_PATH
                    && std::str::from_utf8(&bytes).is_ok_and(|text| {
                        [
                            "<ttsettings/>",
                            "<ttsettings />",
                            "<ttsettings></ttsettings>",
                        ]
                        .contains(&text.trim())
                    });
                if bytes != candidate.as_bytes() && !empty_settings {
                    preview.blockers.push(format!("{path}: supplied settings/definition require an explicit decoder; original bytes retained"));
                }
            } else if path == SETTINGS_PATH {
                preview.blockers.push("Missing packaged settings".into());
            }
        }
        // TEITOK resolves exactly review_{transcript basename}, with one owner.
        // A review_ prefix alone cannot establish a supported reader family.
        preview.blockers.extend(scope_blockers(&snapshot));
        if snapshot.config.version == u32::MAX {
            preview
                .blockers
                .push("Configuration version exhausted".into());
        }
        preview.installed = preview.candidate_xml.iter().all(|(path, text)| {
            snapshot
                .files
                .get(path)
                .is_some_and(|artifact| artifact.sha256 == package::hash(text.as_bytes()))
        });
        preview.enabled = preview.blockers.is_empty() && !preview.installed;
        Ok(preview)
    }
    pub(crate) fn install_teitok_reader(
        &self,
        snapshot: &mut Snapshot,
        profile_hash: &str,
    ) -> Result<()> {
        ensure!(
            profile_hash == self::profile_hash()?,
            "reader profile hash binding mismatch"
        );
        let preview =
            self.teitok_reader_preview(&snapshot.project, self.head(&snapshot.project)?.id)?;
        ensure!(
            preview.enabled,
            "reader installation blocked: {}",
            if preview.installed {
                "already installed".into()
            } else {
                preview.blockers.join("; ")
            }
        );
        // Store.apply owns the checked base snapshot and atomic revision; do not
        // substitute a newer view if another writer advances during preparation.
        ensure!(
            preview.snapshot_hash == package::hash(&serde_json::to_vec(snapshot)?),
            "stale reader configuration basis"
        );
        for (path, text) in preview.candidate_xml {
            package::replace(&self.objects, snapshot, &path, &text)?;
        }
        snapshot.config.version = snapshot
            .config
            .version
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("configuration version exhausted"))?;
        Ok(())
    }
}
