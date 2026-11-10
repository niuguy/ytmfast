//! YTMFast's Rust crate: the engine that runs and drives YouTube Music's web
//! player (`ytmusic`), exported to the TSX UI as the `YTMusic` class
//! (`exports`). The screens are TSX (`App.tsx`); this crate ships in the
//! binary and does the work TSX cannot: processes, sockets and the browser.

pub mod audio;
pub mod exports;
pub mod media;
pub mod ytmusic;
pub mod theme;
pub mod version;

use nsh_core::prelude::*;

pub use audio::AudioMeter;
pub use exports::YTMusic;
pub use media::MediaControls;
pub use theme::SystemTheme;
pub use version::Version;

/// The most the decoded images (covers, avatars) keep in memory. NSH decodes
/// each at the size it is shown and keeps the downloads on disk, but holds
/// the images that left the screen until its budget (a sixteenth of the
/// machine's memory, up to 256 MiB) fills. A small one keeps little more
/// than what is shown: an image shown again is decoded again from the disk
/// cache.
const IMAGE_MEMORY: usize = 32 << 20;

/// The most the covers' encoded bytes keep in memory (NSH's default is 32
/// MiB on the desktops). They are what a decode at another size reads; the
/// disk cache has every download anyway, so a few dozen recent covers
/// (tens of KB each) are enough, and the rest are read from disk again.
const ENCODED_MEMORY: usize = 8 << 20;

/// The crate's UI set: what `App.tsx` imports from `ytmfast/native`.
#[native_module("ytmfast/native")]
fn native(registry: &mut Registry) {
    nsh_core::image::budget().set_limit(IMAGE_MEMORY.min(nsh_core::image::default_budget()));
    let loader = nsh_core::image::loader::loader();
    loader.set_encoded_limit(ENCODED_MEMORY.min(loader.encoded_limit()));
    registry
        .class::<YTMusic>()
        .class::<MediaControls>()
        .class::<SystemTheme>()
        .class::<AudioMeter>()
        .module::<Version>();
}
