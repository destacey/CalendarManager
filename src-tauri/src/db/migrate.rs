use std::fs;
use std::path::{Path, PathBuf};

use super::error::DbError;

/// SQLite's WAL sidecars. Copying the main file alone could lose committed
/// transactions that still live in the write-ahead log.
const SIDECAR_SUFFIXES: [&str; 2] = ["-wal", "-shm"];

/// Copies a legacy database into place if there is nothing at `target` yet.
/// Returns whether a copy happened.
///
/// The original is never moved or deleted: it is the user's only other copy of
/// event types, rules and manual overrides that Microsoft Graph cannot
/// recreate. An existing `target` is never overwritten, so this cannot clobber
/// a live database.
pub fn copy_legacy_if_needed(target: &Path, candidates: &[PathBuf]) -> Result<bool, DbError> {
    if target.exists() {
        return Ok(false);
    }

    let Some(source) = candidates.iter().find(|candidate| candidate.exists()) else {
        return Ok(false);
    };

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::copy(source, target)?;

    for suffix in SIDECAR_SUFFIXES {
        let sidecar_source = with_suffix(source, suffix);
        if sidecar_source.exists() {
            fs::copy(&sidecar_source, with_suffix(target, suffix))?;
        }
    }

    Ok(true)
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-migrate-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_the_first_candidate_that_exists() {
        let dir = temp_dir("copy");
        let legacy = dir.join("legacy.db");
        fs::write(&legacy, b"legacy-bytes").unwrap();
        let target = dir.join("app").join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[legacy.clone()]).unwrap();

        assert!(copied);
        assert_eq!(fs::read(&target).unwrap(), b"legacy-bytes");
        // The original must survive — it is the user's only other copy.
        assert!(legacy.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copies_the_wal_and_shm_sidecars_too() {
        let dir = temp_dir("sidecars");
        let legacy = dir.join("legacy.db");
        fs::write(&legacy, b"main").unwrap();
        fs::write(dir.join("legacy.db-wal"), b"wal").unwrap();
        fs::write(dir.join("legacy.db-shm"), b"shm").unwrap();
        let target = dir.join("app").join("calendar.db");

        copy_legacy_if_needed(&target, &[legacy]).unwrap();

        assert_eq!(fs::read(dir.join("app").join("calendar.db-wal")).unwrap(), b"wal");
        assert_eq!(fs::read(dir.join("app").join("calendar.db-shm")).unwrap(), b"shm");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_nothing_when_the_target_already_exists() {
        let dir = temp_dir("exists");
        let legacy = dir.join("legacy.db");
        fs::write(&legacy, b"legacy").unwrap();
        let target = dir.join("calendar.db");
        fs::write(&target, b"current").unwrap();

        let copied = copy_legacy_if_needed(&target, &[legacy]).unwrap();

        assert!(!copied);
        // Critically: the live database was NOT overwritten.
        assert_eq!(fs::read(&target).unwrap(), b"current");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn does_nothing_when_no_candidate_exists() {
        let dir = temp_dir("none");
        let target = dir.join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[dir.join("nope.db")]).unwrap();

        assert!(!copied);
        assert!(!target.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn prefers_the_earlier_candidate() {
        let dir = temp_dir("order");
        let first = dir.join("first.db");
        let second = dir.join("second.db");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();
        let target = dir.join("app").join("calendar.db");

        copy_legacy_if_needed(&target, &[first, second]).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"first");

        fs::remove_dir_all(&dir).ok();
    }
}
