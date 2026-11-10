//! The system theme, exported to TSX as `SystemTheme`: the colors of the
//! current [Omarchy](https://omarchy.org) theme, and a listener for when the
//! user switches themes. TSX maps the palette onto the app's tokens
//! (`src/platform/theme.ts`); this side only finds, reads and watches it.
//!
//! Omarchy keeps the current theme in `~/.local/state/omarchy/current/theme`
//! (older releases: `~/.config/omarchy/current/theme`, a symlink), with its
//! palette in `colors.toml`: `mode = "dark" | "light"` and `key = "#rrggbb"`
//! pairs (`background`, `foreground`, `accent`, `muted`, `selection`, the
//! `*_background` / `*_foreground` steps, named ANSI colors, and on some
//! themes `color0`..`color15`). Switching themes rewrites
//! `current/theme.generation`, which is what the watcher waits for.

use std::{
    cell::RefCell,
    collections::BTreeMap,
    path::{Path, PathBuf},
    rc::Rc,
};

use nsh_core::prelude::*;
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

/// Light or dark, as the theme says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PropEnum)]
pub enum ColorMode {
    /// A light theme.
    Light,
    /// A dark theme.
    Dark,
}

/// A system theme's palette.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SystemPalette {
    /// Whether the theme is light or dark.
    pub mode: ColorMode,
    /// The theme's colors by its own names (`background`, `foreground`,
    /// `accent`, `muted`, `selection`, `dark_background`, `red`,
    /// `color0`, …), each a `#rrggbb` (or `#rrggbbaa`) string.
    pub colors: BTreeMap<String, String>,
}

/// Parses an Omarchy `colors.toml`. Only `#hex` string values are kept;
/// `mode` defaults to dark (Omarchy's own default) when missing.
pub fn parse_colors(text: &str) -> Option<SystemPalette> {
    let table: toml::Table = text.parse().ok()?;
    let mode = match table.get("mode").and_then(|v| v.as_str()) {
        Some("light") => ColorMode::Light,
        _ => ColorMode::Dark,
    };
    let colors: BTreeMap<String, String> = table
        .iter()
        .filter_map(|(key, value)| {
            let s = value.as_str()?.trim();
            is_hex_color(s).then(|| (key.clone(), s.to_ascii_lowercase()))
        })
        .collect();
    // A palette without these two is not one we can map.
    (colors.contains_key("background") && colors.contains_key("foreground"))
        .then_some(SystemPalette { mode, colors })
}

fn is_hex_color(s: &str) -> bool {
    let Some(hex) = s.strip_prefix('#') else { return false };
    matches!(hex.len(), 3 | 4 | 6 | 8) && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// The `current` directories Omarchy may use, newest layout first.
fn current_dirs() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return Vec::new() };
    let state = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/state"));
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    vec![state.join("omarchy/current"), config.join("omarchy/current")]
}

/// The first `current` directory that has a theme palette.
fn active_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    current_dirs().into_iter().find(|d| d.join("theme/colors.toml").is_file())
}

fn read_palette(dir: &Path) -> Option<SystemPalette> {
    parse_colors(&std::fs::read_to_string(dir.join("theme/colors.toml")).ok()?)
}

#[derive(Default)]
struct Inner {
    next: u64,
    listeners: Vec<(u64, Callback<Option<SystemPalette>>)>,
    rx: Option<UnboundedReceiver<()>>,
}

/// The system's theme: Omarchy's current palette, read from its
/// `colors.toml`, and a listener for theme switches. On other systems
/// `current()` is `null` and nothing is ever heard.
#[class]
pub struct SystemTheme {
    dir: Option<PathBuf>,
    inner: Rc<RefCell<Inner>>,
    _watcher: Option<watch::Watcher>,
}

impl Default for SystemTheme {
    fn default() -> Self {
        Self::new()
    }
}

#[class]
impl SystemTheme {
    /// Finds the system theme and starts watching it (Omarchy on Linux).
    pub fn new() -> Self {
        let dir = active_dir();
        let (tx, rx) = unbounded_channel();
        let _watcher = dir.as_deref().and_then(|d| watch::Watcher::start(d, tx));
        SystemTheme {
            dir,
            inner: Rc::new(RefCell::new(Inner { rx: Some(rx), ..Inner::default() })),
            _watcher,
        }
    }

    /// Whether a system theme was found (Omarchy is installed and has a
    /// current theme).
    #[getter]
    pub fn available(&self) -> bool {
        self.dir.is_some()
    }

    /// The current palette, or `null` without a system theme (or when its
    /// file cannot be read).
    pub fn current(&self) -> Option<SystemPalette> {
        read_palette(self.dir.as_deref()?)
    }

    /// Calls `listener` with the new palette (or `null`) after the user
    /// switches themes. Changes are debounced. Call `run()` once to start
    /// delivering them.
    pub fn on_change(&self, #[args(palette)] listener: Callback<Option<SystemPalette>>) -> Stop {
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

    /// Delivers theme changes to the `onChange` listeners; resolves when
    /// watching ends (at once without a system theme). Call it once.
    pub async fn run(this: Instance<Self>) {
        let (inner, dir) = this.with(|s| (s.inner.clone(), s.dir.clone()));
        let Some(mut rx) = inner.borrow_mut().rx.take() else { return };
        let Some(dir) = dir else { return };
        while rx.recv().await.is_some() {
            let palette = read_palette(&dir);
            for (_, cb) in &inner.borrow().listeners {
                cb.post(palette.clone());
            }
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
mod watch {
    use std::{
        path::Path,
        sync::mpsc,
        time::Duration,
    };

    use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
    use tokio::sync::mpsc::UnboundedSender;

    /// How long the files must stay quiet before a change is reported:
    /// a theme switch rewrites dozens of files in `current/theme`.
    const QUIET: Duration = Duration::from_millis(300);

    /// Watches Omarchy's `current` directory (and its `theme` directory)
    /// and sends one `()` per settled change. Dropped, it stops.
    pub struct Watcher {
        _inner: RecommendedWatcher,
    }

    impl Watcher {
        pub fn start(current: &Path, out: UnboundedSender<()>) -> Option<Self> {
            let (tx, rx) = mpsc::channel::<()>();
            let mut inner = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if event.is_ok_and(|e| !e.kind.is_access()) {
                    let _ = tx.send(());
                }
            })
            .map_err(|e| log::warn!("system theme: cannot watch: {e}"))
            .ok()?;
            // `current` sees `theme.generation` and the `theme` directory
            // being replaced; `theme` (recursive, following the symlink on
            // older layouts) sees files rewritten in place.
            inner
                .watch(current, RecursiveMode::NonRecursive)
                .map_err(|e| log::warn!("system theme: cannot watch {}: {e}", current.display()))
                .ok()?;
            let theme = current.join("theme");
            if let Err(e) = inner.watch(&theme, RecursiveMode::NonRecursive) {
                log::debug!("system theme: not watching {}: {e}", theme.display());
            }
            std::thread::Builder::new()
                .name("spotish-theme-watch".into())
                .spawn(move || {
                    // Ends when the watcher (and so `tx`) is dropped.
                    while rx.recv().is_ok() {
                        while rx.recv_timeout(QUIET).is_ok() {}
                        if out.send(()).is_err() {
                            return;
                        }
                    }
                })
                .ok()?;
            Some(Watcher { _inner: inner })
        }
    }
}

/// Without a system theme to watch (no `notify` on this target).
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod watch {
    use std::path::Path;

    use tokio::sync::mpsc::UnboundedSender;

    pub struct Watcher;

    impl Watcher {
        pub fn start(_current: &Path, _out: UnboundedSender<()>) -> Option<Self> {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ADVENTURE: &str = include_str!("platform/fixtures/adventure.colors.toml");
    const LATTE: &str = include_str!("platform/fixtures/catppuccin-latte.colors.toml");
    const PORSCHE: &str = include_str!("platform/fixtures/porsche-911.colors.toml");

    #[test]
    fn parses_a_dark_palette() {
        let p = parse_colors(ADVENTURE).unwrap();
        assert_eq!(p.mode, ColorMode::Dark);
        assert_eq!(p.colors["background"], "#040404");
        assert_eq!(p.colors["accent"], "#5da602");
        assert_eq!(p.colors["dark_foreground"], "#777b80");
        assert!(!p.colors.contains_key("mode"));
    }

    #[test]
    fn parses_a_light_palette() {
        let p = parse_colors(LATTE).unwrap();
        assert_eq!(p.mode, ColorMode::Light);
        assert_eq!(p.colors["foreground"], "#4c4f69");
    }

    #[test]
    fn keeps_only_hex_colors_and_lowercases() {
        let p = parse_colors(PORSCHE).unwrap();
        assert_eq!(p.colors["accent"], "#9c2331");
        assert_eq!(p.colors["color15"], "#f5eedc");
        // `rgba(...) 45deg` borders are not colors we can use.
        assert!(!p.colors.contains_key("hyprland_active_border"));
        let upper = parse_colors("background = \"#ABCDEF\"\nforeground = \"#FFF\"").unwrap();
        assert_eq!(upper.colors["background"], "#abcdef");
        assert_eq!(upper.mode, ColorMode::Dark);
    }

    #[test]
    fn rejects_what_is_not_a_palette() {
        assert!(parse_colors("not toml = = =").is_none());
        assert!(parse_colors("mode = \"dark\"\naccent = \"#ffffff\"").is_none());
    }

    /// A theme switch (Omarchy rewrites `theme.generation` and the files in
    /// `theme/`) is reported once, after the files settle.
    #[cfg(target_os = "linux")]
    #[test]
    fn reports_a_theme_switch_once() {
        let current = std::env::temp_dir().join(format!("spotish-theme-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&current);
        std::fs::create_dir_all(current.join("theme")).unwrap();
        std::fs::write(current.join("theme/colors.toml"), ADVENTURE).unwrap();
        std::fs::write(current.join("theme.generation"), "1").unwrap();

        let (tx, mut rx) = unbounded_channel();
        let watcher = watch::Watcher::start(&current, tx).expect("watching");
        std::fs::write(current.join("theme/colors.toml"), LATTE).unwrap();
        std::fs::write(current.join("theme.generation"), "2").unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while rx.try_recv().is_err() {
            assert!(std::time::Instant::now() < deadline, "no change reported");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        // Debounced: the burst of writes is one change.
        std::thread::sleep(std::time::Duration::from_millis(600));
        assert!(rx.try_recv().is_err());
        assert_eq!(read_palette(&current).unwrap().mode, ColorMode::Light);

        drop(watcher);
        let _ = std::fs::remove_dir_all(&current);
    }
}
