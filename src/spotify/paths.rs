//! Where Spotish keeps its files: the browser profile (and with it the
//! sign-in), the Chromium log and the login-import marker. One data
//! directory per OS, from the `dirs` crate:
//!
//! - Linux: `$XDG_DATA_HOME/spotish` (`~/.local/share/spotish`)
//! - macOS: `~/Library/Application Support/dev.huacnlee.spotish`
//! - Windows: `%LOCALAPPDATA%\Spotish`
//!
//! `SPOTISH_DATA_DIR` overrides it (tests, a second instance).

use std::path::{Path, PathBuf};

/// The app's directories.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    /// Everything of the app's lives under it.
    pub data: PathBuf,
}

impl Paths {
    /// The platform's data directory for Spotish.
    pub fn platform() -> Paths {
        if let Some(dir) = std::env::var_os("SPOTISH_DATA_DIR").filter(|d| !d.is_empty()) {
            return Paths::at(PathBuf::from(dir));
        }
        Paths::at(default_data_dir().unwrap_or_else(|| PathBuf::from(".spotish")))
    }

    /// Paths under `data`.
    pub fn at(data: impl Into<PathBuf>) -> Paths {
        Paths { data: data.into() }
    }

    /// The browser's profile (`--user-data-dir`).
    pub fn profile(&self) -> PathBuf {
        self.data.join("browser")
    }

    /// The directory of the app's logs.
    pub fn logs(&self) -> PathBuf {
        self.data.join("logs")
    }

    /// The browser's stderr log.
    pub fn browser_log(&self) -> PathBuf {
        self.logs().join("chromium.log")
    }

    /// The marker that says the one-time login import is settled (done, or
    /// made moot by a sign-in or sign-out).
    pub fn import_marker(&self) -> PathBuf {
        self.data.join("login-import.done")
    }
}

#[cfg(target_os = "macos")]
fn default_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("dev.huacnlee.spotish"))
}

#[cfg(target_os = "windows")]
fn default_data_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("Spotish"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn default_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("spotish"))
}

/// The user's home, for well-known browser locations.
pub fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

/// `path` relative to the home directory, when there is one.
pub fn in_home(path: impl AsRef<Path>) -> Option<PathBuf> {
    home().map(|h| h.join(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lays_out_the_data_dir() {
        let paths = Paths::at("/data/spotish");
        assert_eq!(paths.profile(), PathBuf::from("/data/spotish/browser"));
        assert_eq!(paths.browser_log(), PathBuf::from("/data/spotish/logs/chromium.log"));
        assert_eq!(paths.import_marker(), PathBuf::from("/data/spotish/login-import.done"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn keeps_the_linux_location() {
        // The profile stays where earlier versions kept it.
        if std::env::var_os("SPOTISH_DATA_DIR").is_none() {
            let data = Paths::platform().data;
            assert!(data.ends_with("spotish"), "{}", data.display());
        }
    }
}
