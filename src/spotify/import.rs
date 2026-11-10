//! The one-time import of an existing browser's Spotify login
//! (`SPOTISH_PROFILE`): its cookies, the key they are encrypted with
//! (`Local State`) and its Widevine component are copied into Spotish's own
//! profile, once.
//!
//! "Once" is a marker file in the data directory. The import runs only while
//! the marker is absent *and* Spotish's profile has no cookies of its own; a
//! sign-in or sign-out writes the marker, so a sign-out is never undone by a
//! re-import and a fresh sign-in is never overwritten.
//!
//! The cookie database is copied with SQLite's backup API into a staging
//! file that is checked and then renamed into place, after the target's
//! stale `-wal`/`-shm` sidecars are removed (a stale WAL would otherwise be
//! replayed onto the new database). Copying the files of a running browser
//! one by one can tear them.

use std::{
    io,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags};

use super::{chrome, paths::Paths};

/// Where Chromium keeps the cookie database inside a profile, newest first.
const COOKIE_DBS: [&str; 2] = ["Default/Network/Cookies", "Default/Cookies"];

/// What [`import_once`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The marker says the import is settled.
    Settled,
    /// Spotish's profile has cookies of its own (the marker is written now).
    HasOwnLogin,
    /// No `SPOTISH_PROFILE` to import from.
    NoSource,
    /// The source has no cookie database; nothing was marked, so a later
    /// start with a fixed `SPOTISH_PROFILE` tries again.
    NothingToImport,
    /// The login was imported, and the marker written.
    Imported,
    /// The copy failed; nothing was marked.
    Failed(String),
}

/// Whether the one-time import is settled.
pub fn settled(paths: &Paths) -> bool {
    paths.import_marker().exists()
}

/// Settles the import for good: after a sign-in or sign-out, or once it ran.
pub fn settle(paths: &Paths, why: &str) {
    let marker = paths.import_marker();
    if let Some(parent) = marker.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&marker, format!("{why}\n")) {
        log::warn!("could not write {}: {e}", marker.display());
    }
}

/// Whether `profile` has a cookie database.
pub fn has_cookies(profile: &Path) -> bool {
    COOKIE_DBS.iter().any(|db| profile.join(db).is_file())
}

/// Imports the login of `source` (a Chromium profile directory) into
/// `paths`'s profile, unless the import is settled or Spotish has a login of
/// its own.
pub fn import_once(paths: &Paths, source: Option<&Path>) -> Outcome {
    if settled(paths) {
        return Outcome::Settled;
    }
    let target = paths.profile();
    if has_cookies(&target) {
        settle(paths, "own login");
        return Outcome::HasOwnLogin;
    }
    let Some(source) = source else { return Outcome::NoSource };
    let Some(from) = COOKIE_DBS.iter().find(|db| source.join(db).is_file()) else {
        log::warn!("SPOTISH_PROFILE={}: no cookies found to reuse", source.display());
        return Outcome::NothingToImport;
    };
    let result = (|| -> Result<(), String> {
        copy_database(&source.join(from), &target.join(from)).map_err(|e| format!("cookies: {e}"))?;
        // The cookies' key; without it they do not decrypt.
        let local_state = source.join("Local State");
        if local_state.is_file() {
            copy_atomically(&local_state, &target.join("Local State")).map_err(|e| format!("Local State: {e}"))?;
        }
        if !chrome::has_widevine(&target) {
            let _ = chrome::copy_widevine_from(&source.join("WidevineCdm"), &target);
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            settle(paths, "imported");
            log::info!("imported the Spotify login from {}", source.display());
            Outcome::Imported
        }
        Err(e) => {
            log::warn!("could not import the login from {}: {e}", source.display());
            Outcome::Failed(e)
        }
    }
}

/// `SPOTISH_PROFILE`, when set.
pub fn source_from_env() -> Option<PathBuf> {
    std::env::var_os("SPOTISH_PROFILE").filter(|p| !p.is_empty()).map(PathBuf::from)
}

/// Copies the SQLite database `from` to `to` consistently: a backup into a
/// staging file next to `to`, checked, then renamed over `to` once `to`'s
/// sidecars are gone.
pub fn copy_database(from: &Path, to: &Path) -> Result<(), String> {
    let dir = to.parent().ok_or("no parent directory")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let staging = sibling(to, "spotish-staging");
    remove_with_sidecars(&staging);
    // A running browser may hold its database locked (Chromium uses
    // exclusive locking); then back up a private copy of the database and its
    // WAL instead, which SQLite reconciles when it opens them.
    if let Err(live) = backup(from, &staging, false) {
        log::info!("backing up {} directly failed ({live}); copying it first", from.display());
        remove_with_sidecars(&staging);
        let scratch = sibling(to, "spotish-scratch");
        remove_with_sidecars(&scratch);
        let copied = (|| -> Result<(), String> {
            std::fs::copy(from, &scratch).map_err(|e| e.to_string())?;
            let wal = with_suffix(from, "-wal");
            if wal.is_file() {
                std::fs::copy(&wal, with_suffix(&scratch, "-wal")).map_err(|e| e.to_string())?;
            }
            // Opened writable, so SQLite recovers the copied WAL into it.
            backup(&scratch, &staging, true)
        })();
        remove_with_sidecars(&scratch);
        copied.inspect_err(|_| remove_with_sidecars(&staging))?;
    }
    if let Err(e) = verify(&staging) {
        remove_with_sidecars(&staging);
        return Err(e);
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        let stale = with_suffix(to, suffix);
        if stale.exists() {
            std::fs::remove_file(&stale).map_err(|e| format!("{}: {e}", stale.display()))?;
        }
    }
    std::fs::rename(&staging, to).map_err(|e| e.to_string())?;
    // A backup leaves no sidecars, but be sure none of the staging's remain.
    remove_with_sidecars(&staging);
    Ok(())
}

/// Backs `from` up into `to`. The other browser's own database is opened
/// read-only (`writable: false`), so Spotish never writes to it.
fn backup(from: &Path, to: &Path, writable: bool) -> Result<(), String> {
    let mode = if writable { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    let source =
        Connection::open_with_flags(from, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| e.to_string())?;
    source.busy_timeout(std::time::Duration::from_millis(1500)).map_err(|e| e.to_string())?;
    source.backup(rusqlite::MAIN_DB, to, None).map_err(|e| e.to_string())
}

/// Checks that `db` is a whole SQLite database with a `cookies` table.
fn verify(db: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("the copied database is damaged: {check}"));
    }
    let tables: i64 = conn
        .query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'cookies'", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if tables == 0 {
        return Err("the copied database has no cookies table".into());
    }
    Ok(())
}

/// Copies a small file through a temporary sibling and a rename.
fn copy_atomically(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let staging = sibling(to, "spotish-staging");
    std::fs::copy(from, &staging)?;
    std::fs::rename(&staging, to)
}

fn sibling(path: &Path, tag: &str) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{name}.{tag}"))
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn remove_with_sidecars(path: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(with_suffix(path, suffix));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory under `TMPDIR` (never a fixed `/tmp` path).
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spotish-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn cookie_db(path: &Path, value: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS cookies (name TEXT, value TEXT)").unwrap();
        conn.execute("INSERT INTO cookies VALUES ('sp_dc', ?1)", [value]).unwrap();
    }

    fn read_cookie(path: &Path) -> String {
        let conn = Connection::open(path).unwrap();
        conn.query_row("SELECT value FROM cookies WHERE name = 'sp_dc'", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn imports_once_then_never_again() {
        let dir = scratch("once");
        let source = dir.join("source");
        cookie_db(&source.join("Default/Network/Cookies"), "secret");
        std::fs::write(source.join("Local State"), "{\"os_crypt\":{}}").unwrap();
        let paths = Paths::at(dir.join("data"));

        assert_eq!(import_once(&paths, None), Outcome::NoSource);
        assert!(!settled(&paths));
        assert_eq!(import_once(&paths, Some(&source)), Outcome::Imported);
        assert!(settled(&paths));
        assert_eq!(read_cookie(&paths.profile().join("Default/Network/Cookies")), "secret");
        assert!(paths.profile().join("Local State").is_file());

        // Signed out: the profile's cookies go, the marker stays, and the
        // next start does not bring the old login back.
        std::fs::remove_file(paths.profile().join("Default/Network/Cookies")).unwrap();
        settle(&paths, "signed out");
        assert_eq!(import_once(&paths, Some(&source)), Outcome::Settled);
        assert!(!has_cookies(&paths.profile()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_own_login_settles_the_import() {
        let dir = scratch("own");
        let source = dir.join("source");
        cookie_db(&source.join("Default/Network/Cookies"), "theirs");
        let paths = Paths::at(dir.join("data"));
        cookie_db(&paths.profile().join("Default/Network/Cookies"), "mine");
        assert_eq!(import_once(&paths, Some(&source)), Outcome::HasOwnLogin);
        assert!(settled(&paths));
        assert_eq!(read_cookie(&paths.profile().join("Default/Network/Cookies")), "mine");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_source_without_cookies_is_not_settled() {
        let dir = scratch("empty");
        let source = dir.join("source");
        std::fs::create_dir_all(&source).unwrap();
        let paths = Paths::at(dir.join("data"));
        assert_eq!(import_once(&paths, Some(&source)), Outcome::NothingToImport);
        assert!(!settled(&paths));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_copy_replaces_stale_sidecars() {
        let dir = scratch("sidecars");
        let from = dir.join("from/Cookies");
        cookie_db(&from, "fresh");
        let to = dir.join("to/Cookies");
        cookie_db(&to, "stale");
        // A stale WAL of the old target, which must not replay onto the copy.
        std::fs::write(with_suffix(&to, "-wal"), b"garbage that is not a wal").unwrap();
        std::fs::write(with_suffix(&to, "-shm"), b"garbage").unwrap();
        copy_database(&from, &to).unwrap();
        assert!(!with_suffix(&to, "-wal").exists() || read_cookie(&to) == "fresh");
        assert_eq!(read_cookie(&to), "fresh");
        assert!(!sibling(&to, "spotish-staging").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_damaged_source_is_refused() {
        let dir = scratch("damaged");
        let from = dir.join("from/Cookies");
        std::fs::create_dir_all(from.parent().unwrap()).unwrap();
        std::fs::write(&from, b"this is not a database").unwrap();
        let to = dir.join("to/Cookies");
        assert!(copy_database(&from, &to).is_err());
        assert!(!to.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
