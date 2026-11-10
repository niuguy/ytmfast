//! The browser the web player runs in: a Chromium-family browser of the
//! system's (Chromium, Chrome, Brave, Edge), with a profile of the app's own,
//! started headless for playback or in a window for signing in.
//!
//! Spotify's audio is encrypted (Widevine). Chrome and Edge ship their
//! Widevine; Chromium and Brave keep a downloaded component in the profile
//! and load it at start. A new profile has none until the browser downloads
//! it, so the app copies the component of a browser profile the user already
//! has, when there is one.
//!
//! On Unix the headless browser is driven over `--remote-debugging-pipe`
//! (fds 3 and 4), so it opens no port at all; elsewhere over a loopback
//! port, without `--remote-allow-origins` (see `cdp`).

use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};

use super::{
    cdp::{Cdp, CdpEvent},
    model::{EngineError, ErrorCode},
    paths::Paths,
};

/// Chromium's exit code when another process holds the profile
/// (`RESULT_CODE_PROFILE_IN_USE`).
pub const PROFILE_IN_USE_EXIT: i32 = 21;

pub const PLAYER_URL: &str = "https://open.spotify.com/";
pub const SIGN_IN_URL: &str = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

// --- Finding the browser -----------------------------------------------------

/// The browser to run: `SPOTISH_BROWSER`, else the first one installed in a
/// standard location or on `PATH`. On Windows Edge comes first: Chrome's
/// app-bound cookie encryption keeps its login from being reused there.
pub fn find_browser() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("SPOTISH_BROWSER").filter(|p| !p.is_empty()) {
        return Some(PathBuf::from(path));
    }
    let (names, locations) = candidates();
    for location in locations {
        if location.is_file() {
            return Some(location);
        }
    }
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Names to look for on `PATH`, and absolute install locations, in order of
/// preference.
fn candidates() -> (Vec<&'static str>, Vec<PathBuf>) {
    #[cfg(target_os = "macos")]
    {
        let apps = [
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Chromium.app/Contents/MacOS/Chromium",
            "Brave Browser.app/Contents/MacOS/Brave Browser",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ];
        let mut locations = Vec::new();
        for root in [Some(PathBuf::from("/Applications")), super::paths::in_home("Applications")].into_iter().flatten()
        {
            locations.extend(apps.iter().map(|app| root.join(app)));
        }
        (vec!["chromium", "google-chrome"], locations)
    }
    #[cfg(target_os = "windows")]
    {
        let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
            .iter()
            .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
            .collect();
        let apps = [
            r"Microsoft\Edge\Application\msedge.exe",
            r"Google\Chrome\Application\chrome.exe",
            r"BraveSoftware\Brave-Browser\Application\brave.exe",
            r"Chromium\Application\chrome.exe",
        ];
        let mut locations = Vec::new();
        for app in apps {
            locations.extend(roots.iter().map(|root| root.join(app)));
        }
        (vec!["msedge.exe", "chrome.exe", "brave.exe"], locations)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let locations = [
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/opt/google/chrome/chrome",
            "/usr/bin/brave",
            "/usr/bin/brave-browser",
            "/opt/brave.com/brave/brave",
            "/usr/bin/microsoft-edge-stable",
            "/opt/microsoft/msedge/msedge",
            "/snap/bin/chromium",
        ]
        .map(PathBuf::from)
        .to_vec();
        let names = vec![
            "chromium",
            "chromium-browser",
            "google-chrome-stable",
            "google-chrome",
            "brave",
            "brave-browser",
            "microsoft-edge-stable",
            "microsoft-edge",
        ];
        (names, locations)
    }
}

// --- Widevine ----------------------------------------------------------------

const HINT: &str = "latest-component-updated-widevine-cdm";

/// Whether the profile has a Widevine component the browser will load.
pub fn has_widevine(profile: &Path) -> bool {
    let hint = profile.join("WidevineCdm").join(HINT);
    std::fs::read_to_string(hint)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("Path").and_then(|p| p.as_str()).map(PathBuf::from))
        .is_some_and(|dir| dir.join("manifest.json").exists())
}

/// Whether `binary`'s installation ships its own Widevine (Chrome, Edge).
pub fn bundles_widevine(binary: &Path) -> bool {
    let Some(dir) = binary.parent() else { return false };
    if dir.join("WidevineCdm").is_dir() {
        return true; // Linux Chrome and Edge
    }
    // Windows: `Application\<version>\WidevineCdm`.
    let versioned = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .any(|e| e.path().join("WidevineCdm").is_dir());
    if versioned {
        return true;
    }
    // macOS: `….app/Contents/Frameworks/<framework>/Versions/<v>/Libraries/WidevineCdm`.
    let frameworks = dir.parent().map(|contents| contents.join("Frameworks"));
    frameworks.is_some_and(|frameworks| {
        std::fs::read_dir(frameworks).into_iter().flatten().filter_map(|e| e.ok()).any(|framework| {
            std::fs::read_dir(framework.path().join("Versions"))
                .into_iter()
                .flatten()
                .filter_map(|e| e.ok())
                .any(|v| v.path().join("Libraries/WidevineCdm").is_dir())
        })
    })
}

/// A dotted version (`4.10.2830.0`) as numbers, for ordering.
pub fn parse_version(name: &str) -> Option<Vec<u64>> {
    let parts: Option<Vec<u64>> = name.split('.').map(|p| p.parse::<u64>().ok()).collect();
    parts.filter(|p| !p.is_empty())
}

/// The newest version directory under `root` that has a manifest.
pub fn newest_version(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("manifest.json").exists())
        .filter_map(|p| {
            let version = parse_version(&p.file_name()?.to_string_lossy())?;
            Some((version, p))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, p)| p)
}

/// The Widevine component directories of the user's other browsers.
fn widevine_sources() -> Vec<PathBuf> {
    let mut profiles = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(support) = dirs::data_dir() {
        for p in ["Google/Chrome", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge"] {
            profiles.push(support.join(p));
        }
    }
    #[cfg(target_os = "windows")]
    if let Some(local) = dirs::data_local_dir() {
        for p in [
            r"Microsoft\Edge\User Data",
            r"Google\Chrome\User Data",
            r"Chromium\User Data",
            r"BraveSoftware\Brave-Browser\User Data",
        ] {
            profiles.push(local.join(p));
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    if let Some(config) = dirs::config_dir() {
        for p in ["chromium", "google-chrome", "BraveSoftware/Brave-Browser", "microsoft-edge"] {
            profiles.push(config.join(p));
        }
    }
    profiles.into_iter().map(|p| p.join("WidevineCdm")).collect()
}

/// Copies the newest Widevine version under `source` (a `WidevineCdm`
/// directory) into `profile`, and points the profile's hint at it.
pub fn copy_widevine_from(source: &Path, profile: &Path) -> Result<(), String> {
    let version = newest_version(source).ok_or("no Widevine version")?;
    let target_root = profile.join("WidevineCdm");
    let target = target_root.join(version.file_name().ok_or("no version name")?);
    copy_dir(&version, &target).map_err(|e| e.to_string())?;
    let hint = serde_json::json!({ "Path": target.to_string_lossy() }).to_string();
    std::fs::write(target_root.join(HINT), hint).map_err(|e| e.to_string())
}

/// Copies another browser's Widevine component into `profile`; true when it
/// has one afterwards.
pub fn adopt_widevine(profile: &Path) -> bool {
    if has_widevine(profile) {
        return true;
    }
    for source in widevine_sources() {
        if copy_widevine_from(&source, profile).is_ok() {
            log::info!("using the Widevine component of {}", source.display());
            return true;
        }
    }
    false
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

// --- The profile lock ----------------------------------------------------------

/// Who holds a profile, from its `SingletonLock` (`<host>-<pid>`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockHolder {
    pub host: String,
    pub pid: u32,
}

/// Reads a `SingletonLock` symlink's target. Host names may contain `-`; the
/// pid is what follows the last one.
pub fn parse_singleton_lock(target: &str) -> Option<LockHolder> {
    let (host, pid) = target.rsplit_once('-')?;
    let pid = pid.parse::<u32>().ok().filter(|p| *p > 0)?;
    Some(LockHolder { host: host.to_owned(), pid })
}

/// The live process on this machine holding `profile`, if any. A stale lock
/// (its process gone) is not a holder: the browser clears it at start.
pub fn profile_holder(profile: &Path) -> Option<LockHolder> {
    let target = std::fs::read_link(profile.join("SingletonLock")).ok()?;
    let holder = parse_singleton_lock(&target.to_string_lossy())?;
    (holder.host == hostname()? && process_alive(holder.pid)).then_some(holder)
}

/// The error for a profile another process holds.
pub fn profile_in_use(pid: Option<u32>) -> EngineError {
    let by = pid.map(|p| format!("process {p}")).unwrap_or_else(|| "another browser".into());
    EngineError::new(
        ErrorCode::ProfileInUse,
        format!("Spotish's browser profile is in use by {by}. Quit it (or another Spotish) and Spotish starts again."),
    )
}

#[cfg(unix)]
fn hostname() -> Option<String> {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer is valid for its length.
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    if rc != 0 {
        return None;
    }
    let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
    Some(String::from_utf8_lossy(&buf[..end]).into_owned())
}

#[cfg(not(unix))]
fn hostname() -> Option<String> {
    // Chromium on Windows locks the profile with a file, not this symlink.
    None
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else { return false };
    // SAFETY: signal 0 only checks that the process exists.
    let rc = unsafe { libc::kill(pid, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_alive(_pid: u32) -> bool {
    false
}

// --- The browser's log ---------------------------------------------------------

/// A log file that keeps about `limit` bytes: past half of it, the file
/// becomes `<name>.1` (replacing the older one) and a new one starts.
pub struct RotatingLog {
    path: PathBuf,
    limit: u64,
    file: Option<std::fs::File>,
    written: u64,
}

impl RotatingLog {
    pub fn open(path: PathBuf, limit: u64) -> RotatingLog {
        let mut log = RotatingLog { path, limit, file: None, written: 0 };
        log.reopen();
        log
    }

    fn reopen(&mut self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        self.file = std::fs::OpenOptions::new().create(true).append(true).open(&self.path).ok();
        self.written = std::fs::metadata(&self.path).map(|m| m.len()).unwrap_or(0);
        if self.written >= self.limit / 2 {
            self.rotate();
        }
    }

    fn rotate(&mut self) {
        self.file = None;
        let mut old = self.path.as_os_str().to_owned();
        old.push(".1");
        let _ = std::fs::rename(&self.path, PathBuf::from(old));
        self.file = std::fs::OpenOptions::new().create(true).append(true).open(&self.path).ok();
        self.written = 0;
    }

    pub fn line(&mut self, line: &str) {
        if self.written >= self.limit / 2 {
            self.rotate();
        }
        if let Some(file) = &mut self.file
            && writeln!(file, "{line}").is_ok()
        {
            self.written += line.len() as u64 + 1;
        }
    }
}

/// Copies a child's stderr into the rotating log, on a thread of its own.
fn log_stderr(stderr: impl std::io::Read + Send + 'static, path: PathBuf, header: String) {
    let _ = std::thread::Builder::new().name("spotish-browser-log".into()).spawn(move || {
        let mut log = RotatingLog::open(path, 1 << 20);
        log.line(&header);
        for line in BufReader::new(stderr).lines() {
            match line {
                Ok(line) => log.line(&line),
                Err(_) => break,
            }
        }
    });
}

// --- Running it ----------------------------------------------------------------

/// Why the browser did not start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartError {
    pub error: EngineError,
    /// Retrying will not help until something changes (no browser, the
    /// profile held by another process).
    pub permanent: bool,
}

impl StartError {
    pub fn transient(message: impl Into<String>) -> StartError {
        StartError { error: EngineError::new(ErrorCode::Internal, message), permanent: false }
    }
    pub fn permanent(error: EngineError) -> StartError {
        StartError { error, permanent: true }
    }
}

/// What a browser that exited at once says about why.
pub fn classify_exit(status: ExitStatus) -> StartError {
    if status.code() == Some(PROFILE_IN_USE_EXIT) {
        return StartError::permanent(profile_in_use(None));
    }
    StartError::transient(format!("the browser quit at start ({status}); see its log for why"))
}

/// A running browser; it is stopped when dropped.
pub struct Browser {
    child: Child,
    started: Instant,
}

/// Features the headless player turns off on top of the ones every start does:
/// site isolation, and the browser's own UI (the omnibox popup), which
/// `--headless=new` still loads.
const HEADLESS_DISABLED_FEATURES: &[&str] = &[
    "IsolateOrigins",
    "site-per-process",
    "OptimizationHints",
    "PreloadTopChromeWebUI",
    "WebUIOmniboxPopup",
    "WebUIOmniboxAimPopup",
    "WebUIOmniboxFullPopup",
];

impl Browser {
    fn command(binary: &Path, paths: &Paths, disabled_features: &[&str]) -> Result<Command, StartError> {
        let profile = paths.profile();
        std::fs::create_dir_all(&profile).map_err(|e| StartError::transient(format!("{}: {e}", profile.display())))?;
        if let Some(holder) = profile_holder(&profile) {
            return Err(StartError::permanent(profile_in_use(Some(holder.pid))));
        }
        let mut command = Command::new(binary);
        command
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("--no-first-run")
            .arg("--disable-extensions")
            .arg("--no-default-browser-check")
            .arg(format!("--disable-features={}", [&["Translate", "MediaRouter"][..], disabled_features].concat().join(",")))
            .arg("--autoplay-policy=no-user-gesture-required");
        // No --password-store override: use the system keyring, the same store
        // the user's own browser uses, so cookies persist across restarts and
        // an imported login decrypts.
        command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        Ok(command)
    }

    fn spawn(mut command: Command, binary: &Path, paths: &Paths, what: &str) -> Result<Browser, StartError> {
        let mut child = command.spawn().map_err(|e| StartError::transient(format!("{}: {e}", binary.display())))?;
        if let Some(stderr) = child.stderr.take() {
            log_stderr(stderr, paths.browser_log(), format!("--- {what}: {} (pid {})", binary.display(), child.id()));
        }
        Ok(Browser { child, started: Instant::now() })
    }

    /// Starts `binary` headless on the profile, connected for automation.
    pub fn start_headless(
        binary: &Path,
        paths: &Paths,
        events: mpsc::Sender<CdpEvent>,
    ) -> Result<(Browser, Arc<Cdp>), StartError> {
        // Nobody sees this browser or its page: the app draws its own covers
        // and controls. Turn off what only a visible browser needs, which
        // takes the browser from about 650 MB to about 500 MB (PSS) on Linux.
        let mut command = Browser::command(binary, paths, HEADLESS_DISABLED_FEATURES)?;
        command
            .arg("--headless=new")
            // The desktop layout, which has the player's whole bar.
            .arg("--window-size=1280,900")
            // One renderer for the page and its frames, not one per site.
            .arg("--disable-site-isolation-trials")
            .arg("--renderer-process-limit=1")
            // The page's images and animations are never shown.
            .arg("--blink-settings=imagesEnabled=false")
            .arg("--force-prefers-reduced-motion");
        #[cfg(unix)]
        {
            let pipes = unix::Pipes::new().map_err(|e| StartError::transient(format!("debugging pipe: {e}")))?;
            command.arg("--remote-debugging-pipe").arg("about:blank");
            pipes.hand_to(&mut command);
            unix::die_with_parent(&mut command);
            let spawned = Browser::spawn(command, binary, paths, "player");
            let (reader, writer) = pipes.into_ours();
            let browser = spawned?;
            let cdp = Cdp::over_pipe(reader, writer, events).map_err(StartError::transient)?;
            Ok((browser, Arc::new(cdp)))
        }
        #[cfg(not(unix))]
        {
            let port_file = paths.profile().join("DevToolsActivePort");
            let _ = std::fs::remove_file(&port_file);
            command.arg("--remote-debugging-port=0").arg("about:blank");
            let mut browser = Browser::spawn(command, binary, paths, "player")?;
            let deadline = Instant::now() + Duration::from_secs(20);
            let url = loop {
                if let Ok(text) = std::fs::read_to_string(&port_file) {
                    let mut lines = text.lines();
                    if let (Some(port), Some(path)) = (lines.next(), lines.next())
                        && let Ok(port) = port.trim().parse::<u16>()
                    {
                        break format!("ws://127.0.0.1:{port}{}", path.trim());
                    }
                }
                if let Some(status) = browser.exited() {
                    return Err(classify_exit(status));
                }
                if Instant::now() > deadline {
                    return Err(StartError::transient("the browser did not open its DevTools port"));
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            let cdp = Cdp::over_websocket(&url, events).map_err(StartError::transient)?;
            Ok((browser, Arc::new(cdp)))
        }
    }

    /// Opens the sign-in window: an ordinary browser window with no
    /// debugging at all, so Google, Apple and Facebook sign-in work (a
    /// debugging port makes Google refuse the browser). Closing it is a
    /// clean quit, which flushes the new session's cookies to disk.
    pub fn start_sign_in(binary: &Path, paths: &Paths) -> Result<Browser, StartError> {
        let mut command = Browser::command(binary, paths, &[])?;
        command.arg("--window-size=520,760").arg(format!("--app={SIGN_IN_URL}"));
        #[cfg(unix)]
        unix::die_with_parent(&mut command);
        Browser::spawn(command, binary, paths, "sign-in")
    }

    /// How it ended, once it has.
    pub fn exited(&mut self) -> Option<ExitStatus> {
        self.child.try_wait().ok().flatten()
    }

    /// How long it has run.
    pub fn uptime(&self) -> Duration {
        self.started.elapsed()
    }

    /// The process id.
    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// Waits up to `timeout` for it to exit on its own (after a clean
    /// `Browser.close`), so its cookie writes land before it goes.
    pub fn wait_for_exit(&mut self, timeout: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.exited() {
                return Some(status);
            }
            if Instant::now() >= deadline {
                return None;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        if self.exited().is_some() {
            return;
        }
        // A polite stop first (Chromium shuts down cleanly on SIGTERM).
        #[cfg(unix)]
        if let Ok(pid) = i32::try_from(self.child.id()) {
            // SAFETY: signals our own child.
            unsafe {
                libc::kill(pid, libc::SIGTERM);
            }
        }
        #[cfg(not(unix))]
        let _ = self.child.kill();
        if self.wait_for_exit(Duration::from_secs(4)).is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(unix)]
mod unix {
    use std::{
        fs::File,
        os::{
            fd::{FromRawFd, RawFd},
            unix::process::CommandExt,
        },
        process::Command,
    };

    /// The two pipes of `--remote-debugging-pipe`: the browser reads
    /// commands on its fd 3 and writes answers on its fd 4.
    pub struct Pipes {
        /// (browser's read end → fd 3, our write end)
        commands: (RawFd, RawFd),
        /// (our read end, browser's write end → fd 4)
        answers: (RawFd, RawFd),
    }

    fn pipe() -> std::io::Result<(RawFd, RawFd)> {
        let mut fds = [0 as RawFd; 2];
        // SAFETY: `fds` has room for both ends.
        if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        for fd in fds {
            // Close-on-exec, so no other child inherits them; the browser
            // gets its ends through `dup2`, which clears the flag.
            // SAFETY: fd is ours.
            unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
        }
        Ok((fds[0], fds[1]))
    }

    impl Pipes {
        pub fn new() -> std::io::Result<Pipes> {
            let commands = pipe()?;
            let answers = pipe().inspect_err(|_| {
                // SAFETY: closing what we opened.
                unsafe {
                    libc::close(commands.0);
                    libc::close(commands.1);
                }
            })?;
            Ok(Pipes { commands, answers })
        }

        /// Arranges for the child to get the browser's ends as fds 3 and 4.
        pub fn hand_to(&self, command: &mut Command) {
            let (read, write) = (self.commands.0, self.answers.1);
            // SAFETY: only async-signal-safe calls (fcntl, dup2, close) run
            // between fork and exec.
            unsafe {
                command.pre_exec(move || {
                    // Move both out of the way first, so neither is clobbered
                    // when one of them already is fd 3 or 4.
                    let r = libc::fcntl(read, libc::F_DUPFD_CLOEXEC, 10);
                    let w = libc::fcntl(write, libc::F_DUPFD_CLOEXEC, 10);
                    if r < 0 || w < 0 || libc::dup2(r, 3) < 0 || libc::dup2(w, 4) < 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    libc::close(r);
                    libc::close(w);
                    Ok(())
                });
            }
        }

        /// Our ends (read answers, write commands); the browser's ends are
        /// closed here, so its exit shows as end of file.
        pub fn into_ours(self) -> (File, File) {
            // SAFETY: each fd is ours and closed or owned exactly once.
            unsafe {
                libc::close(self.commands.0);
                libc::close(self.answers.1);
                (File::from_raw_fd(self.answers.0), File::from_raw_fd(self.commands.1))
            }
        }
    }

    /// On Linux the browser gets SIGTERM when the thread that started it
    /// (the session's) ends, however the app ends. `getppid` after `prctl`
    /// closes the race with a parent that died before it. Elsewhere the
    /// engine's shutdown and the profile-lock check cover it.
    pub fn die_with_parent(command: &mut Command) {
        #[cfg(target_os = "linux")]
        {
            // SAFETY: getpid is always safe.
            let parent = unsafe { libc::getpid() };
            // SAFETY: prctl and getppid are async-signal-safe.
            unsafe {
                command.pre_exec(move || {
                    libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                    if libc::getppid() != parent {
                        libc::_exit(0);
                    }
                    Ok(())
                });
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = command;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("spotish-chrome-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn orders_widevine_versions_numerically() {
        assert_eq!(parse_version("4.10.2830.0"), Some(vec![4, 10, 2830, 0]));
        assert_eq!(parse_version("latest-component-updated-widevine-cdm"), None);
        assert_eq!(parse_version(""), None);
        assert!(parse_version("4.10.2830.0") > parse_version("4.9.9999.9"));

        let root = scratch("widevine");
        for v in ["4.9.9999.9", "4.10.2830.0", "4.10.300.0", "junk"] {
            std::fs::create_dir_all(root.join(v)).unwrap();
            std::fs::write(root.join(v).join("manifest.json"), "{}").unwrap();
        }
        // Newer, but without a manifest: skipped.
        std::fs::create_dir_all(root.join("5.0.0.0")).unwrap();
        assert_eq!(newest_version(&root), Some(root.join("4.10.2830.0")));

        let profile = root.join("profile");
        copy_widevine_from(&root, &profile).unwrap();
        assert!(has_widevine(&profile));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn reads_singleton_locks() {
        assert_eq!(parse_singleton_lock("myhost-1234"), Some(LockHolder { host: "myhost".into(), pid: 1234 }));
        assert_eq!(
            parse_singleton_lock("my-laptop.local-77"),
            Some(LockHolder { host: "my-laptop.local".into(), pid: 77 })
        );
        assert_eq!(parse_singleton_lock("nohyphen"), None);
        assert_eq!(parse_singleton_lock("host-abc"), None);
        assert_eq!(parse_singleton_lock("host-0"), None);
    }

    #[cfg(unix)]
    #[test]
    fn finds_a_live_holder_only() {
        let profile = scratch("lock");
        let host = hostname().unwrap();
        // This test's own process: alive, on this host.
        std::os::unix::fs::symlink(format!("{host}-{}", std::process::id()), profile.join("SingletonLock")).unwrap();
        assert_eq!(profile_holder(&profile).map(|h| h.pid), Some(std::process::id()));
        std::fs::remove_file(profile.join("SingletonLock")).unwrap();
        // Another host's lock, and a dead pid: not held.
        std::os::unix::fs::symlink("elsewhere-1", profile.join("SingletonLock")).unwrap();
        assert_eq!(profile_holder(&profile), None);
        std::fs::remove_file(profile.join("SingletonLock")).unwrap();
        std::os::unix::fs::symlink(format!("{host}-{}", i32::MAX - 7), profile.join("SingletonLock")).unwrap();
        assert_eq!(profile_holder(&profile), None);
        let _ = std::fs::remove_dir_all(&profile);
        let e = profile_in_use(Some(42));
        assert_eq!(e.code, ErrorCode::ProfileInUse);
        assert!(e.message.contains("process 42"));
    }

    #[cfg(unix)]
    #[test]
    fn exit_21_is_a_profile_in_use() {
        use std::os::unix::process::ExitStatusExt;
        let held = classify_exit(ExitStatus::from_raw(21 << 8));
        assert!(held.permanent);
        assert_eq!(held.error.code, ErrorCode::ProfileInUse);
        let crashed = classify_exit(ExitStatus::from_raw(1 << 8));
        assert!(!crashed.permanent);
    }

    #[test]
    fn the_log_keeps_about_its_limit() {
        let dir = scratch("log");
        let path = dir.join("chromium.log");
        let mut log = RotatingLog::open(path.clone(), 1000);
        for n in 0..200 {
            log.line(&format!("line {n:04} of the browser's stderr"));
        }
        let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        let older = dir.join("chromium.log.1");
        assert!(size(&path) <= 600, "{}", size(&path));
        assert!(size(&older) <= 600);
        assert!(std::fs::read_to_string(&path).unwrap().contains("line 0199"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Starts a real browser (needs one installed); never run by default.
    #[test]
    #[ignore = "starts Chromium"]
    fn starts_a_headless_browser_over_the_pipe() {
        let Some(binary) = find_browser() else { return };
        let dir = scratch("browser");
        let paths = Paths::at(&dir);
        let (events, _heard) = mpsc::channel();
        let (mut browser, cdp) = Browser::start_headless(&binary, &paths, events).unwrap();
        let version = cdp.call(None, "Browser.getVersion", serde_json::json!({}), Duration::from_secs(20)).unwrap();
        assert!(version["product"].is_string());
        let _ = cdp.call(None, "Browser.close", serde_json::json!({}), Duration::from_secs(5));
        browser.wait_for_exit(Duration::from_secs(5));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
