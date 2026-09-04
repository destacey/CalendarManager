// This half of the split copies the legacy *file* into place before a
// connection is ever opened. `schema.rs` is the other half: it runs the
// *migrations* — DDL against an already-open connection.

use std::fs;
use std::path::{Path, PathBuf};

use super::error::DbError;

/// SQLite's WAL sidecar. `-shm` is deliberately not in this list: it's a
/// shared-memory WAL index that SQLite regenerates on demand, its header
/// carries a checksum so a stale one is detected and rebuilt, and copying it
/// buys nothing.
const SIDECAR_SUFFIXES: [&str; 1] = ["-wal"];

/// SQLite's file header. Checking it stops an unrelated file that merely
/// happens to be named calendar.db from being adopted as the database.
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";

fn looks_like_sqlite(path: &Path) -> bool {
    use std::io::Read;

    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut header = [0u8; 16];
    match file.read_exact(&mut header) {
        Ok(()) => header == SQLITE_MAGIC,
        // Shorter than a header, so not a database.
        Err(_) => false,
    }
}

/// Finds the first candidate that exists and looks like a real SQLite
/// database. A candidate that exists but fails the header check is skipped
/// (and logged) rather than erroring, so one unrelated `calendar.db` doesn't
/// stop a later, valid candidate from being found.
fn find_valid_candidate(candidates: &[PathBuf]) -> Option<&PathBuf> {
    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        if looks_like_sqlite(candidate) {
            return Some(candidate);
        }
        eprintln!(
            "Skipping legacy database candidate {} — it exists but does not look like a SQLite database",
            candidate.display()
        );
    }
    None
}

/// Copies a legacy database into place if there is nothing at `target` yet.
/// Returns whether a copy happened.
///
/// The original is never moved or deleted: it is the user's only other copy of
/// event types, rules and manual overrides that Microsoft Graph cannot
/// recreate. An existing `target` is never overwritten, so this cannot clobber
/// a live database.
pub fn copy_legacy_if_needed(target: &Path, candidates: &[PathBuf]) -> Result<bool, DbError> {
    if target.exists() {
        // Either a genuinely already-migrated database, or an empty one left
        // by an interrupted earlier run. Either way `target` is never
        // overwritten here — but if a valid legacy candidate also exists,
        // that's the "did I just silently not migrate?" case and deserves a
        // loud warning rather than quietly starting the user on an empty
        // calendar.
        if let Some(candidate) = find_valid_candidate(candidates) {
            eprintln!(
                "WARNING: {} already exists, so the legacy database at {} was NOT copied over it. \
                 If {} is empty or unexpected, back it up, delete it, and restart to re-run the migration.",
                target.display(),
                candidate.display(),
                target.display(),
            );
        }
        return Ok(false);
    }

    let Some(source) = find_valid_candidate(candidates) else {
        eprintln!(
            "No valid legacy database found among the candidates checked; starting with a fresh database at {}",
            target.display()
        );
        return Ok(false);
    };
    let source = source.clone();

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    stage_and_commit(target, &source)?;
    Ok(true)
}

/// Stages the source database and its sidecars under temporary names in
/// `target`'s directory, then renames them into place with the main
/// database LAST. A rename on the same volume is atomic, and the main
/// file's presence is exactly what the `target.exists()` guard above keys
/// on — so a crash at any point during this leaves `target` absent and the
/// whole copy retries cleanly on the next launch. An orphaned sidecar left
/// behind by a crash is inert without a main file and is simply overwritten
/// by the retry.
///
/// On any error, every `.tmp` file this call created is removed so a
/// failure leaves no litter behind.
fn stage_and_commit(target: &Path, source: &Path) -> Result<(), DbError> {
    let mut staged: Vec<PathBuf> = Vec::new();

    let outcome = try_stage_and_commit(target, source, &mut staged);

    if outcome.is_err() {
        for path in &staged {
            let _ = fs::remove_file(path);
        }
    }

    outcome
}

fn try_stage_and_commit(target: &Path, source: &Path, staged: &mut Vec<PathBuf>) -> Result<(), DbError> {
    let mut sidecar_renames: Vec<(PathBuf, PathBuf)> = Vec::new();

    for suffix in SIDECAR_SUFFIXES {
        let sidecar_source = with_suffix(source, suffix);
        if sidecar_source.exists() {
            let sidecar_final = with_suffix(target, suffix);
            let tmp = tmp_path(&sidecar_final);
            fs::copy(&sidecar_source, &tmp)?;
            staged.push(tmp.clone());
            sidecar_renames.push((tmp, sidecar_final));
        }
    }

    let main_tmp = tmp_path(target);
    fs::copy(source, &main_tmp)?;
    staged.push(main_tmp.clone());

    // Sidecars first...
    for (tmp, final_path) in sidecar_renames {
        fs::rename(&tmp, &final_path)?;
    }

    // ...main database last: its presence is the "copy completed" signal
    // that `target.exists()` keys on.
    fs::rename(&main_tmp, target)?;

    Ok(())
}

fn tmp_path(final_path: &Path) -> PathBuf {
    let mut name = final_path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{}.tmp", uuid::Uuid::new_v4()));
    final_path.with_file_name(name)
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

    /// Creates a real, minimal SQLite database at `path` with one row so it
    /// has a genuine header and is distinguishable from other fixtures.
    fn write_valid_sqlite(path: &Path, marker: &str) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(&format!(
            "CREATE TABLE marker (v TEXT); INSERT INTO marker VALUES ('{marker}');"
        ))
        .unwrap();
        drop(conn);
    }

    fn tmp_files_in(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "tmp"))
            .collect()
    }

    #[test]
    fn copies_the_first_candidate_that_exists() {
        let dir = temp_dir("copy");
        let legacy = dir.join("legacy.db");
        write_valid_sqlite(&legacy, "primary");
        let target = dir.join("app").join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[legacy.clone()]).unwrap();

        assert!(copied);
        assert_eq!(fs::read(&target).unwrap(), fs::read(&legacy).unwrap());
        // The original must survive — it is the user's only other copy.
        assert!(legacy.exists());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_tmp_files_remain_after_a_successful_copy() {
        let dir = temp_dir("no-litter");
        let legacy = dir.join("legacy.db");
        write_valid_sqlite(&legacy, "primary");
        fs::write(dir.join("legacy.db-wal"), b"wal").unwrap();
        let target_dir = dir.join("app");
        let target = target_dir.join("calendar.db");

        copy_legacy_if_needed(&target, &[legacy]).unwrap();

        assert!(tmp_files_in(&target_dir).is_empty(), "leftover .tmp files in target dir");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn copies_the_wal_sidecar() {
        let dir = temp_dir("sidecars");
        let legacy = dir.join("legacy.db");
        write_valid_sqlite(&legacy, "primary");
        fs::write(dir.join("legacy.db-wal"), b"wal").unwrap();
        fs::write(dir.join("legacy.db-shm"), b"shm").unwrap();
        let target = dir.join("app").join("calendar.db");

        copy_legacy_if_needed(&target, &[legacy]).unwrap();

        assert_eq!(fs::read(dir.join("app").join("calendar.db-wal")).unwrap(), b"wal");
        // -shm is regenerated by SQLite on demand; copying it buys nothing.
        assert!(!dir.join("app").join("calendar.db-shm").exists());

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
        write_valid_sqlite(&first, "first");
        write_valid_sqlite(&second, "second");
        let target = dir.join("app").join("calendar.db");

        copy_legacy_if_needed(&target, &[first.clone(), second]).unwrap();

        assert_eq!(fs::read(&target).unwrap(), fs::read(&first).unwrap());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_candidate_that_is_not_really_sqlite_is_skipped() {
        let dir = temp_dir("invalid-first");
        let bogus = dir.join("first.db");
        fs::write(&bogus, b"not a database, just a file named calendar.db").unwrap();
        let real = dir.join("second.db");
        write_valid_sqlite(&real, "real");
        let target = dir.join("app").join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[bogus, real.clone()]).unwrap();

        assert!(copied);
        assert_eq!(fs::read(&target).unwrap(), fs::read(&real).unwrap());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nothing_is_copied_when_no_candidate_is_valid() {
        let dir = temp_dir("all-invalid");
        let bogus1 = dir.join("first.db");
        let bogus2 = dir.join("second.db");
        fs::write(&bogus1, b"nope").unwrap();
        fs::write(&bogus2, b"also nope").unwrap();
        let target = dir.join("app").join("calendar.db");

        let copied = copy_legacy_if_needed(&target, &[bogus1, bogus2]).unwrap();

        assert!(!copied);
        assert!(!target.exists());

        fs::remove_dir_all(&dir).ok();
    }
}
