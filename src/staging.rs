use std::{fs, io, path::Path};

// On Windows, a reader without FILE_SHARE_DELETE on a child can temporarily
// block both the directory rename (error 5) and recursive cleanup (error 32).
fn try_staging_operation(mut action: impl FnMut() -> io::Result<()>) -> io::Result<()> {
    #[cfg(windows)]
    for delay in [20, 40, 80, 160, 320, 640] {
        match action() {
            Err(error) if matches!(error.raw_os_error(), Some(5 | 32 | 33)) => {
                std::thread::sleep(std::time::Duration::from_millis(delay));
            }
            result => return result,
        }
    }
    action()
}

pub fn publish_directory(stage: &Path, destination: &Path) -> io::Result<()> {
    try_staging_operation(|| {
        match fs::symlink_metadata(destination) {
            Ok(_) => return Err(io::ErrorKind::AlreadyExists.into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        fs::rename(stage, destination)
    })
}

pub fn remove_private_directory(path: &Path) -> io::Result<()> {
    try_staging_operation(|| fs::remove_dir_all(path))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{fs::OpenOptions, os::windows::fs::OpenOptionsExt, thread, time::Duration};

    #[test]
    fn publication_and_cleanup_wait_for_a_child_reader() {
        let root = tempfile::tempdir().unwrap();
        let stage = root.path().join("stage");
        let destination = root.path().join("published");
        fs::create_dir(&stage).unwrap();
        fs::write(stage.join("source.xml"), "original bytes").unwrap();
        let reader = |dir: &Path| {
            OpenOptions::new()
                .read(true)
                .share_mode(3)
                .open(dir.join("source.xml"))
                .unwrap()
        };
        let release = |handle| {
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(150));
                drop(handle);
            })
        };

        let handle = reader(&stage);
        assert!(fs::rename(&stage, &destination).is_err());
        let thread = release(handle);
        publish_directory(&stage, &destination).unwrap();
        thread.join().unwrap();
        assert_eq!(
            fs::read(destination.join("source.xml")).unwrap(),
            b"original bytes"
        );
        fs::create_dir(&stage).unwrap();
        assert_eq!(
            publish_directory(&stage, &destination).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );

        let handle = reader(&destination);
        assert!(fs::remove_dir_all(&destination).is_err());
        let thread = release(handle);
        remove_private_directory(&destination).unwrap();
        thread.join().unwrap();
        assert!(!destination.exists());
    }
}
