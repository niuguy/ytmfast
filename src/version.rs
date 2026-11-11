//! The crate's API version, exported to TSX as `Version`.
//!
//! Signed OTA packages carry TSX only and run against the Rust compiled into
//! the installed app (mixed.md, "Signed packages"). `minRuntime` gates a
//! package on NSH's runtime, not on this crate, so TSX checks
//! `Version.api()` before using an export added later, and a release that
//! needs a newer crate ships as a new app build.

use nsh_core::prelude::*;

/// The API version of YTMFast's Rust exports, for TSX delivered as a signed
/// package to check what the installed app has.
#[module]
pub struct Version;

/// Raise by one with every release that adds or changes an export
/// (`YTMusic`, `MediaControls`, `SystemTheme`, `Version`); never lower it.
pub const API: u32 = 2;

#[module]
impl Version {
    /// The API version of the installed app's Rust exports: 1 has `YTMusic`,
    /// `MediaControls`, `SystemTheme` and `Version`; 2 adds `YTMusic`'s
    /// `playlistStart`, `likedSongsStart` and `tracksAfter`.
    pub fn api() -> u32 {
        API
    }

    /// The crate's version as built (`Cargo.toml`), for About screens and
    /// error reports.
    pub fn crate_version() -> String {
        env!("CARGO_PKG_VERSION").to_owned()
    }
}
