use corpus_workbench::package::zip_directory;
use std::fs;
use std::io::Read;
use tempfile::TempDir;

#[test]
fn complete_zip_keeps_binary_unicode_and_empty_files_with_private_permissions() {
    let root = TempDir::new().unwrap();
    let package = root.path().join("package");
    fs::create_dir_all(package.join("Raw")).unwrap();
    let files: [(&str, &[u8]); 3] = [
        ("Raw/original.bin", &[0, 255, 13, 10, 0, 42]),
        ("Raw/café.txt", "SYNTHETIC e\u{301}\r\n".as_bytes()),
        ("empty.txt", &[]),
    ];
    for (name, bytes) in files {
        fs::write(package.join(name), bytes).unwrap();
    }
    let output = root.path().join("complete.zip");
    zip_directory(&package, &output).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(output).unwrap()).unwrap();
    assert_eq!(archive.len(), files.len());
    for (name, expected) in files {
        let mut entry = archive.by_name(name).unwrap();
        assert_eq!(entry.compression(), zip::CompressionMethod::Stored);
        assert_eq!(entry.unix_mode().unwrap() & 0o7777, 0o600);
        let mut actual = Vec::new();
        entry.read_to_end(&mut actual).unwrap();
        assert_eq!(actual, expected, "preserved bytes for {name}");
    }
}

#[test]
fn complete_zip_refuses_an_existing_destination_without_changing_its_bytes() {
    let root = TempDir::new().unwrap();
    let package = root.path().join("package");
    fs::create_dir(&package).unwrap();
    fs::write(package.join("source.txt"), "SYNTHETIC source").unwrap();
    let output = root.path().join("retained.zip");
    let retained = b"SYNTHETIC retained destination";
    fs::write(&output, retained).unwrap();
    assert!(zip_directory(&package, &output).is_err());
    assert_eq!(fs::read(output).unwrap(), retained);
}
