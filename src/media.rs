//! System media controls, exported to TSX as `MediaControls`: media keys and
//! the system's Now Playing (MPRIS on Linux, which Waybar, GNOME and
//! `playerctl` read; the System Media Transport Controls on Windows;
//! `MPNowPlayingInfoCenter` on macOS), through the `souvlaki` crate.
//!
//! It knows nothing of the Spotify engine: TSX tells it what plays
//! (`setMetadata`, `setPlayback`) and hears the system's commands
//! (`onCommand`), which it wires to the player (`src/platform/media.ts`).
//!
//! Platform notes:
//! - Linux: registers `org.mpris.MediaPlayer2.ytmfast` on the session bus
//!   (zbus, no libdbus). One per session: a second Spotish process may not
//!   get the name, and its controls then stay silent (souvlaki's service
//!   thread ends with a logged panic; the app is unaffected).
//! - Windows: SMTC needs a top-level window of the process (`HWND`), which
//!   NSH does not expose. The controls look for one of the process's own
//!   visible windows when first used and retry on each update until one
//!   exists; without one (or where SMTC fails), they stay inactive.
//! - macOS: no window needed; the app's run loop delivers the commands.
//! - Elsewhere (mobile, web, terminal): inactive; every method is a no-op.

use std::{cell::RefCell, rc::Rc};

use nsh_core::prelude::*;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

/// What is playing, for the system's Now Playing.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct MediaMetadata {
    /// The track's title.
    pub title: Option<String>,
    /// Its artists.
    pub artist: Option<String>,
    /// Its album.
    pub album: Option<String>,
    /// The cover art (an `https:` URL).
    pub artwork_url: Option<String>,
    /// Its length in milliseconds.
    pub duration_ms: Option<f64>,
}

/// Whether it plays, and where it is.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct MediaPlayback {
    /// Playing (true) or paused (false).
    pub playing: bool,
    /// The position in milliseconds, when known.
    pub position_ms: Option<f64>,
}

/// A command from the system: a media key, a headset button, Now Playing's
/// buttons, `playerctl`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum MediaCommand {
    /// Start playing.
    Play,
    /// Pause.
    Pause,
    /// Play or pause.
    Toggle,
    /// The next track.
    Next,
    /// The previous track.
    Previous,
    /// Go to the position given in milliseconds.
    Seek,
    /// Bring the app's window to the front.
    Raise,
}

/// What the backend's thread sends: a command, or a relative seek (ms,
/// signed) that becomes an absolute `seek` from the last position.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Command {
    Do(MediaCommand, Option<f64>),
    SeekBy(f64),
}

/// How far a seek key without a distance moves.
const SEEK_STEP_MS: f64 = 10_000.0;

/// A TSX `onCommand` listener: `(command, value) => void`.
type CommandListener = Callback<(MediaCommand, Option<f64>)>;

#[derive(Default)]
struct Inner {
    next: u64,
    listeners: Vec<(u64, CommandListener)>,
    rx: Option<UnboundedReceiver<Command>>,
    /// The last position TSX reported, for relative seeks.
    position_ms: f64,
    duration_ms: Option<f64>,
}

/// The system's media controls: media keys and Now Playing. TSX reports what
/// plays and hears the commands; it holds no player state of its own.
#[class]
pub struct MediaControls {
    backend: Rc<RefCell<backend::Backend>>,
    inner: Rc<RefCell<Inner>>,
}

impl Default for MediaControls {
    fn default() -> Self {
        Self::new()
    }
}

#[class]
impl MediaControls {
    /// Registers the app with the system's media controls, where there are
    /// any (see `available`).
    pub fn new() -> Self {
        let (tx, rx) = unbounded_channel();
        MediaControls {
            backend: Rc::new(RefCell::new(backend::Backend::new(tx))),
            inner: Rc::new(RefCell::new(Inner { rx: Some(rx), ..Inner::default() })),
        }
    }

    /// Whether the system's media controls are in use here (false off the
    /// desktops, and on Windows until the app has a window).
    #[getter]
    pub fn available(&self) -> bool {
        self.backend.borrow_mut().ready()
    }

    /// Shows what plays in the system's Now Playing.
    pub fn set_metadata(&self, metadata: MediaMetadata) {
        self.inner.borrow_mut().duration_ms = metadata.duration_ms;
        self.backend.borrow_mut().set_metadata(&metadata);
    }

    /// Tells the system whether it plays, and where.
    pub fn set_playback(&self, playback: MediaPlayback) {
        if let Some(p) = playback.position_ms {
            self.inner.borrow_mut().position_ms = p.max(0.0);
        }
        self.backend.borrow_mut().set_playback(&playback);
    }

    /// Calls `listener` with each command from the system; for `seek`,
    /// `value` is the position to go to, in milliseconds. Call `run()`
    /// once to start delivering them.
    pub fn on_command(
        &self,
        #[args(command, value)] listener: Callback<(MediaCommand, Option<f64>)>,
    ) -> Stop {
        let inner = self.inner.clone();
        let id = {
            let mut w = inner.borrow_mut();
            let id = w.next;
            w.next += 1;
            w.listeners.push((id, listener));
            id
        };
        Stop::new(move || inner.borrow_mut().listeners.retain(|(i, _)| *i != id))
    }

    /// Delivers the system's commands to the `onCommand` listeners; resolves
    /// when the controls go. Call it once.
    pub async fn run(this: Instance<Self>) {
        let inner = this.with(|s| s.inner.clone());
        let Some(mut rx) = inner.borrow_mut().rx.take() else { return };
        while let Some(command) = rx.recv().await {
            let w = inner.borrow();
            let (command, value) = resolve(command, w.position_ms, w.duration_ms);
            for (_, cb) in &w.listeners {
                cb.post((command, value));
            }
        }
    }
}

/// The command TSX hears: relative seeks become absolute positions from
/// the last reported one; seeks are clamped to the track.
fn resolve(command: Command, position: f64, duration: Option<f64>) -> (MediaCommand, Option<f64>) {
    let clamp = |ms: f64| ms.clamp(0.0, duration.unwrap_or(f64::MAX));
    match command {
        Command::SeekBy(offset) => (MediaCommand::Seek, Some(clamp(position + offset))),
        Command::Do(MediaCommand::Seek, value) => (MediaCommand::Seek, value.map(clamp)),
        Command::Do(c, value) => (c, value),
    }
}

/// Maps a souvlaki event onto a command for TSX.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn command_of(event: souvlaki::MediaControlEvent) -> Option<Command> {
    use souvlaki::{MediaControlEvent as E, SeekDirection};
    let signed = |dir: SeekDirection, ms: f64| match dir {
        SeekDirection::Forward => ms,
        SeekDirection::Backward => -ms,
    };
    Some(match event {
        E::Play => Command::Do(MediaCommand::Play, None),
        E::Pause | E::Stop => Command::Do(MediaCommand::Pause, None),
        E::Toggle => Command::Do(MediaCommand::Toggle, None),
        E::Next => Command::Do(MediaCommand::Next, None),
        E::Previous => Command::Do(MediaCommand::Previous, None),
        E::Seek(dir) => Command::SeekBy(signed(dir, SEEK_STEP_MS)),
        E::SeekBy(dir, by) => Command::SeekBy(signed(dir, by.as_secs_f64() * 1000.0)),
        E::SetPosition(p) => Command::Do(MediaCommand::Seek, Some(p.0.as_secs_f64() * 1000.0)),
        E::Raise => Command::Do(MediaCommand::Raise, None),
        _ => return None,
    })
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
mod backend {
    use std::time::Duration;

    use souvlaki::{MediaControls, MediaPlayback as Playback, MediaPosition, PlatformConfig};

    use super::{Command, MediaMetadata, MediaPlayback, UnboundedSender, command_of};

    /// The souvlaki controls, created on first use where they need a window
    /// (Windows), at once elsewhere.
    pub struct Backend {
        controls: Option<MediaControls>,
        tx: UnboundedSender<Command>,
        /// Gave up (an error other than a missing window).
        failed: bool,
        metadata: Option<MediaMetadata>,
        playback: Option<MediaPlayback>,
    }

    impl Backend {
        pub fn new(tx: UnboundedSender<Command>) -> Self {
            let mut b = Backend { controls: None, tx, failed: false, metadata: None, playback: None };
            b.ready();
            b
        }

        /// Creates the controls if they are not yet; whether they exist.
        pub fn ready(&mut self) -> bool {
            if self.controls.is_some() {
                return true;
            }
            if self.failed {
                return false;
            }
            let Some(hwnd) = super::window::hwnd() else { return false };
            let config = PlatformConfig {
                dbus_name: "ytmfast",
                display_name: "Spotish",
                hwnd,
            };
            let mut controls = match MediaControls::new(config) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("media controls: unavailable: {e:?}");
                    self.failed = true;
                    return false;
                }
            };
            let tx = self.tx.clone();
            if let Err(e) = controls.attach(move |event| {
                if let Some(command) = command_of(event) {
                    let _ = tx.send(command);
                }
            }) {
                log::warn!("media controls: cannot listen: {e:?}");
                self.failed = true;
                return false;
            }
            self.controls = Some(controls);
            // Replay what TSX reported before the controls existed.
            if let Some(m) = self.metadata.clone() {
                self.set_metadata(&m);
            }
            if let Some(p) = self.playback.clone() {
                self.set_playback(&p);
            }
            true
        }

        pub fn set_metadata(&mut self, m: &MediaMetadata) {
            self.metadata = Some(m.clone());
            if !self.ready() {
                return;
            }
            let Some(controls) = self.controls.as_mut() else { return };
            fn nonempty(s: &Option<String>) -> Option<&str> {
                s.as_deref().filter(|s| !s.is_empty())
            }
            let result = controls.set_metadata(souvlaki::MediaMetadata {
                title: nonempty(&m.title),
                artist: nonempty(&m.artist),
                album: nonempty(&m.album),
                cover_url: nonempty(&m.artwork_url),
                duration: m
                    .duration_ms
                    .filter(|d| d.is_finite() && *d > 0.0)
                    .map(|d| Duration::from_millis(d as u64)),
            });
            if let Err(e) = result {
                log::debug!("media controls: metadata: {e:?}");
            }
        }

        pub fn set_playback(&mut self, p: &MediaPlayback) {
            self.playback = Some(p.clone());
            if !self.ready() {
                return;
            }
            let Some(controls) = self.controls.as_mut() else { return };
            let progress = p
                .position_ms
                .filter(|ms| ms.is_finite() && *ms >= 0.0)
                .map(|ms| MediaPosition(Duration::from_millis(ms as u64)));
            let state = if p.playing { Playback::Playing { progress } } else { Playback::Paused { progress } };
            if let Err(e) = controls.set_playback(state) {
                log::debug!("media controls: playback: {e:?}");
            }
        }
    }
}

/// Finding the window souvlaki needs on Windows; `Some(None)` elsewhere
/// (no window needed).
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod window {
    pub fn hwnd() -> Option<Option<*mut std::ffi::c_void>> {
        Some(None)
    }
}

#[cfg(target_os = "windows")]
mod window {
    use std::ffi::c_void;

    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, TRUE},
        System::Threading::GetCurrentProcessId,
        UI::WindowsAndMessaging::{EnumWindows, GetWindow, GW_OWNER, GetWindowThreadProcessId, IsWindowVisible},
    };

    /// A visible, unowned top-level window of this process, or `None`
    /// until there is one.
    pub fn hwnd() -> Option<Option<*mut c_void>> {
        unsafe extern "system" fn visit(hwnd: HWND, found: LPARAM) -> i32 {
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut pid);
                if pid == GetCurrentProcessId() && IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() {
                    *(found as *mut HWND) = hwnd;
                    return 0; // stop
                }
            }
            TRUE
        }
        let mut found: HWND = std::ptr::null_mut();
        unsafe { EnumWindows(Some(visit), &mut found as *mut HWND as LPARAM) };
        (!found.is_null()).then_some(Some(found as *mut c_void))
    }
}

/// No system media controls on this target.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod backend {
    use super::{Command, MediaMetadata, MediaPlayback, UnboundedSender};

    pub struct Backend;

    impl Backend {
        pub fn new(_tx: UnboundedSender<Command>) -> Self {
            Backend
        }
        pub fn ready(&mut self) -> bool {
            false
        }
        pub fn set_metadata(&mut self, _m: &MediaMetadata) {}
        pub fn set_playback(&mut self, _p: &MediaPlayback) {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_seeks_are_clamped_to_the_track() {
        let at = |ms| resolve(Command::Do(MediaCommand::Seek, Some(ms)), 0.0, Some(200_000.0));
        assert_eq!(at(42_000.0), (MediaCommand::Seek, Some(42_000.0)));
        assert_eq!(at(500_000.0), (MediaCommand::Seek, Some(200_000.0)));
    }

    #[test]
    fn relative_seeks_start_from_the_last_position() {
        assert_eq!(resolve(Command::SeekBy(10_000.0), 30_000.0, Some(200_000.0)), (MediaCommand::Seek, Some(40_000.0)));
        assert_eq!(resolve(Command::SeekBy(-10_000.0), 5_000.0, None), (MediaCommand::Seek, Some(0.0)));
    }

    #[test]
    fn other_commands_pass_through() {
        assert_eq!(resolve(Command::Do(MediaCommand::Next, None), 1.0, None), (MediaCommand::Next, None));
    }

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    #[test]
    fn maps_souvlaki_events() {
        use souvlaki::{MediaControlEvent as E, MediaPosition, SeekDirection};
        use std::time::Duration;
        assert_eq!(command_of(E::Toggle), Some(Command::Do(MediaCommand::Toggle, None)));
        assert_eq!(command_of(E::Stop), Some(Command::Do(MediaCommand::Pause, None)));
        assert_eq!(
            command_of(E::SetPosition(MediaPosition(Duration::from_millis(1500)))),
            Some(Command::Do(MediaCommand::Seek, Some(1500.0)))
        );
        assert_eq!(command_of(E::SeekBy(SeekDirection::Backward, Duration::from_secs(5))), Some(Command::SeekBy(-5000.0)));
        assert_eq!(command_of(E::Seek(SeekDirection::Forward)), Some(Command::SeekBy(10_000.0)));
        assert_eq!(command_of(E::SetVolume(0.5)), None);
    }

    /// Registers on the real session bus and reads the metadata back as
    /// Waybar would. Needs a D-Bus session: `cargo test -- --ignored mpris`.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn mpris_publishes_metadata() {
        let (tx, _rx) = unbounded_channel();
        let mut b = backend::Backend::new(tx);
        assert!(b.ready());
        b.set_metadata(&MediaMetadata {
            title: Some("When The Sun Hits".into()),
            artist: Some("Slowdive".into()),
            album: Some("Souvlaki".into()),
            artwork_url: None,
            duration_ms: Some(290_000.0),
        });
        b.set_playback(&MediaPlayback { playing: true, position_ms: Some(1_000.0) });
        std::thread::sleep(std::time::Duration::from_millis(500));
        let get = |prop: &str| {
            let out = std::process::Command::new("busctl")
                .args(["--user", "get-property", "org.mpris.MediaPlayer2.ytmfast", "/org/mpris/MediaPlayer2"])
                .args(["org.mpris.MediaPlayer2.Player", prop])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).into_owned()
        };
        let metadata = get("Metadata");
        assert!(metadata.contains("When The Sun Hits"), "{metadata}");
        assert!(get("PlaybackStatus").contains("Playing"));
    }
}
