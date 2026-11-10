//! The session with the web player: one thread that keeps a browser running
//! the player, installs the bridge in it, and answers the app's requests.
//!
//! The app talks to it through [`Session`] (a `Send` handle) and reads it
//! through a `watch` of [`Snapshot`]: the player's state, the health, whether
//! an account is signed in, and a counter of the player's new auth tokens.
//!
//! The thread never blocks on the player for a request: a command's
//! `Runtime.evaluate` is sent without waiting, and its answer comes back to
//! the thread as a request of its own ([`Request::Evaluated`]). Every phase
//! (starting, running, signing in, waiting to retry) handles every request.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, mpsc},
    thread::JoinHandle,
    time::{Duration, Instant},
};

use serde_json::{Value, json};
use tokio::sync::{oneshot, watch};

use super::{
    bridge::{self, Coalesce, Command, Message, Unread},
    cdp::{self, Cdp, CdpError, CdpEvent},
    chrome::{self, Browser, StartError},
    import,
    model::{EngineError, ErrorCode, Health, Player},
    paths::Paths,
};

/// What a command answers: the bridge's JSON, or why not.
pub type Answer = Result<Value, EngineError>;

/// What the session publishes; TSX's listeners hear its changes.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Snapshot {
    /// The player's state (empty until the bridge reports one).
    pub player: Player,
    /// Where the session is.
    pub health: Health,
    /// Whether a Spotify account is signed in, from the session cookie;
    /// `None` while unknown.
    pub signed_in: Option<bool>,
    /// Counts the player's new auth tokens: data that failed may now load.
    pub auth: u64,
}

/// What the session is asked.
pub enum Request {
    /// Runs a bridge command.
    Command { command: Command, reply: oneshot::Sender<Answer> },
    /// Opens the sign-in window.
    SignIn,
    /// Closes the sign-in window without signing in.
    CancelSignIn,
    /// Signs out of Spotify.
    SignOut,
    /// Tries to start the player again now.
    Retry,
    /// Replaces the bridge's source.
    SetBridge(String),
    /// Closes the browser and ends the thread; `ack` hears when it has.
    Shutdown(mpsc::Sender<()>),
    /// (Internal) a command's evaluation answered.
    Evaluated { token: u64, result: Result<Value, CdpError> },
    /// (Internal) the cookie check answered; `None` when it failed.
    Cookies(Option<bool>),
}

/// A handle to the session; cheap to clone, usable from any thread.
#[derive(Clone)]
pub struct Session {
    requests: mpsc::Sender<Request>,
}

impl Session {
    /// Starts the session with the real web player.
    pub fn start(paths: Paths) -> (Session, watch::Receiver<Snapshot>, JoinHandle<()>) {
        let (requests, queue) = mpsc::channel();
        let (out, state) = watch::channel(Snapshot::default());
        let me = requests.clone();
        let thread = std::thread::Builder::new()
            .name("spotish-session".into())
            .spawn(move || {
                Runner {
                    queue,
                    me,
                    out,
                    paths,
                    bridge: bridge::BUNDLED.to_owned(),
                    backoff: Backoff::default(),
                    next_token: 1,
                }
                .run()
            })
            .expect("the session thread starts");
        (Session { requests }, state, thread)
    }

    /// A session that answers from `answer` with no browser (tests, and
    /// `SPOTISH_DEMO=1`): ready at once, signed in. `control` applies a
    /// control to the player's state, and says whether it changed it.
    pub fn fake(
        answer: impl Fn(&Command) -> Answer + Send + 'static,
        control: impl Fn(&mut Player, &Command) -> bool + Send + 'static,
        player: Player,
    ) -> (Session, watch::Receiver<Snapshot>, JoinHandle<()>) {
        let (requests, queue) = mpsc::channel::<Request>();
        let (out, state) = watch::channel(Snapshot { player, health: Health::ready(), signed_in: Some(true), auth: 0 });
        let thread = std::thread::Builder::new()
            .name("spotish-fake-session".into())
            .spawn(move || {
                while let Ok(request) = queue.recv() {
                    match request {
                        Request::Command { command, reply } => {
                            let result = answer(&command);
                            if result.is_ok() {
                                out.send_if_modified(|s| control(&mut s.player, &command));
                            }
                            let _ = reply.send(result);
                        }
                        Request::Shutdown(ack) => {
                            let _ = ack.send(());
                            return;
                        }
                        _ => {}
                    }
                }
            })
            .expect("the session thread starts");
        (Session { requests }, state, thread)
    }

    /// Runs `command` in the bridge; the receiver hears its answer.
    pub fn command(&self, command: Command) -> oneshot::Receiver<Answer> {
        let (reply, answer) = oneshot::channel();
        if let Err(mpsc::SendError(Request::Command { reply, .. })) =
            self.requests.send(Request::Command { command, reply })
        {
            let _ = reply.send(Err(EngineError::new(ErrorCode::Internal, "the engine has stopped")));
        }
        answer
    }

    fn send(&self, request: Request) {
        let _ = self.requests.send(request);
    }

    /// Opens the sign-in window (the player stops until it closes).
    pub fn sign_in(&self) {
        self.send(Request::SignIn);
    }

    /// Closes the sign-in window without signing in.
    pub fn cancel_sign_in(&self) {
        self.send(Request::CancelSignIn);
    }

    /// Signs the player out of Spotify.
    pub fn sign_out(&self) {
        self.send(Request::SignOut);
    }

    /// Starts the player again now, after a failure.
    pub fn retry(&self) {
        self.send(Request::Retry);
    }

    /// Replaces the bridge's source for the next page loads, and in the
    /// live page.
    pub fn set_bridge(&self, source: String) {
        self.send(Request::SetBridge(source));
    }

    /// Asks the session to close the browser and end; waits up to
    /// `timeout`. True when it ended in time.
    pub fn shutdown(&self, timeout: Duration) -> bool {
        let (ack, done) = mpsc::channel();
        if self.requests.send(Request::Shutdown(ack)).is_err() {
            return true;
        }
        done.recv_timeout(timeout).is_ok()
    }
}

// --- Retrying ------------------------------------------------------------------

/// The delays between attempts after transient failures: 1 s, doubling to a
/// minute, reset once the player has run well for a while.
#[derive(Debug, Default)]
pub struct Backoff {
    failures: u32,
}

impl Backoff {
    /// The delay before the next attempt (and counts a failure).
    pub fn next_delay(&mut self) -> Duration {
        let delay = Duration::from_secs(1u64 << self.failures.min(6)).min(Duration::from_secs(60));
        self.failures = self.failures.saturating_add(1);
        delay
    }

    pub fn reset(&mut self) {
        self.failures = 0;
    }
}

// --- The thread ----------------------------------------------------------------

/// What the thread does next.
enum Next {
    Player,
    SignIn,
    /// Shows `error` and waits: until `delay` passes (transient), or until
    /// what caused it changes (permanent).
    Wait {
        error: EngineError,
        permanent: bool,
        delay: Duration,
    },
    /// Ends the thread, acknowledging a shutdown.
    Exit(Option<mpsc::Sender<()>>),
}

/// The player's page: the flat session commands go to.
struct Page {
    session: String,
    target: String,
    script: Option<String>,
}

/// A command on its way to the bridge.
struct InFlight {
    command: Command,
    replies: Vec<oneshot::Sender<Answer>>,
    retried: bool,
    deadline: Instant,
}

/// A merged control: whether one is on its way, and the latest value asked
/// for since.
#[derive(Default)]
struct Slot {
    busy: bool,
    next: Option<(Command, Vec<oneshot::Sender<Answer>>)>,
}

/// The state of a running player.
struct Live {
    cdp: Arc<Cdp>,
    page: Page,
    ready: bool,
    ready_since: Option<Instant>,
    main_frame: Option<String>,
    inflight: HashMap<u64, InFlight>,
    /// Data asked for before the player was ready.
    waiting_ready: Vec<InFlight>,
    /// Commands whose page navigated under them, to retry once in the next.
    waiting_context: Vec<InFlight>,
    slots: HashMap<Coalesce, Slot>,
    cookie_check: Option<Instant>,
    last_cookie_check: Option<Instant>,
    last_widevine_check: Instant,
    playing: bool,
    widevine_at_start: bool,
    widevine_reported: bool,
    started: Instant,
    version_warned: bool,
}

impl Live {
    fn new(cdp: Arc<Cdp>, page: Page, widevine_at_start: bool) -> Live {
        Live {
            cdp,
            page,
            ready: false,
            ready_since: None,
            main_frame: None,
            inflight: HashMap::new(),
            waiting_ready: Vec::new(),
            waiting_context: Vec::new(),
            slots: HashMap::new(),
            cookie_check: None,
            last_cookie_check: None,
            last_widevine_check: Instant::now(),
            playing: false,
            widevine_at_start,
            widevine_reported: false,
            started: Instant::now(),
            version_warned: false,
        }
    }

    /// Answers everything waiting with `error`.
    fn fail_all(&mut self, error: &EngineError) {
        let waiting = self
            .inflight
            .drain()
            .map(|(_, f)| f)
            .chain(self.waiting_ready.drain(..))
            .chain(self.waiting_context.drain(..));
        for f in waiting {
            reply_all(f.replies, Err(error.clone()));
        }
        for (_, slot) in self.slots.drain() {
            if let Some((_, replies)) = slot.next {
                reply_all(replies, Err(error.clone()));
            }
        }
    }
}

fn reply_all(replies: Vec<oneshot::Sender<Answer>>, answer: Answer) {
    for reply in replies {
        let _ = reply.send(answer.clone());
    }
}

/// How often the session cookie is checked.
const COOKIE_EVERY: Duration = Duration::from_secs(8);
/// How long a browser without Widevine may run before that is reported.
const WIDEVINE_GRACE: Duration = Duration::from_secs(120);
/// A sign-in window that ends sooner did not let anyone sign in.
const SIGN_IN_MIN: Duration = Duration::from_secs(2);

struct Runner {
    queue: mpsc::Receiver<Request>,
    me: mpsc::Sender<Request>,
    out: watch::Sender<Snapshot>,
    paths: Paths,
    bridge: String,
    backoff: Backoff,
    next_token: u64,
}

impl Runner {
    fn run(mut self) {
        let mut next = Next::Player;
        loop {
            next = match next {
                Next::Player => self.player(),
                Next::SignIn => self.sign_in(),
                Next::Wait { error, permanent, delay } => self.wait(error, permanent, delay),
                Next::Exit(ack) => {
                    log::info!("session: ended");
                    if let Some(ack) = ack {
                        let _ = ack.send(());
                    }
                    return;
                }
            };
        }
    }

    fn health(&self, health: Health) {
        self.out.send_if_modified(|s| {
            let changed = s.health != health;
            s.health = health;
            changed
        });
    }

    fn signed_in(&self, now: Option<bool>) {
        self.out.send_if_modified(|s| {
            let changed = s.signed_in != now;
            s.signed_in = now;
            changed
        });
    }

    fn failed(&mut self, failure: StartError) -> Next {
        log::error!("the player did not start: {}", failure.error);
        if failure.permanent {
            Next::Wait { error: failure.error, permanent: true, delay: Duration::from_secs(30) }
        } else {
            let delay = self.backoff.next_delay();
            Next::Wait { error: failure.error, permanent: false, delay }
        }
    }

    fn no_browser() -> StartError {
        StartError::permanent(EngineError::new(
            ErrorCode::NoBrowser,
            "Spotish plays through Chromium, Google Chrome, Brave or Microsoft Edge, and none is installed. Install one, or set SPOTISH_BROWSER to its path.",
        ))
    }

    /// Signs out with no browser running: the profile's cookie databases go.
    fn sign_out_offline(&self) {
        let profile = self.paths.profile();
        if let Some(holder) = chrome::profile_holder(&profile) {
            log::warn!("cannot sign out: the profile is in use by process {}", holder.pid);
            return;
        }
        for db in ["Default/Network/Cookies", "Default/Cookies"] {
            for suffix in ["", "-wal", "-shm", "-journal"] {
                let _ = std::fs::remove_file(profile.join(format!("{db}{suffix}")));
            }
        }
        import::settle(&self.paths, "signed out");
        self.signed_in(Some(false));
        self.out.send_modify(|s| s.player = Player::default());
    }

    // --- Waiting ------------------------------------------------------------

    fn wait(&mut self, error: EngineError, permanent: bool, delay: Duration) -> Next {
        self.health(Health::failed(error.clone()));
        let until = Instant::now() + delay;
        let mut checked = Instant::now();
        loop {
            let left = until.saturating_duration_since(Instant::now());
            match self.queue.recv_timeout(left.min(Duration::from_millis(200))) {
                Ok(Request::Command { reply, .. }) => {
                    let answer = if permanent {
                        error.clone()
                    } else {
                        EngineError::new(ErrorCode::NotReady, "the player is restarting")
                    };
                    let _ = reply.send(Err(answer));
                }
                Ok(Request::SignIn) => {
                    if matches!(error.code, ErrorCode::NoBrowser | ErrorCode::ProfileInUse) {
                        log::warn!("cannot sign in: {error}");
                    } else {
                        return Next::SignIn;
                    }
                }
                Ok(Request::SignOut) => self.sign_out_offline(),
                Ok(Request::Retry) => {
                    self.backoff.reset();
                    return Next::Player;
                }
                Ok(Request::SetBridge(source)) => self.bridge = source,
                Ok(Request::Shutdown(ack)) => return Next::Exit(Some(ack)),
                Ok(Request::CancelSignIn | Request::Evaluated { .. } | Request::Cookies(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return Next::Exit(None),
            }
            if permanent {
                // Look again, cheaply, whether what stopped it went away.
                if checked.elapsed() >= Duration::from_secs(2) {
                    checked = Instant::now();
                    let cleared = match error.code {
                        ErrorCode::NoBrowser => chrome::find_browser().is_some(),
                        // Where the lock can be read, wait for it to go;
                        // elsewhere, try again when `delay` passes.
                        ErrorCode::ProfileInUse if cfg!(unix) => {
                            chrome::profile_holder(&self.paths.profile()).is_none()
                        }
                        _ => Instant::now() >= until,
                    };
                    if cleared {
                        return Next::Player;
                    }
                }
            } else if Instant::now() >= until {
                return Next::Player;
            }
        }
    }

    // --- Signing in -----------------------------------------------------------

    /// Runs the sign-in window: an ordinary browser window, with no
    /// automation and no bridge. The user signs in and closes the window; a
    /// window the user closes is a clean quit, which flushes the session's
    /// cookies to disk, so the login survives a restart.
    fn sign_in(&mut self) -> Next {
        let Some(binary) = chrome::find_browser() else { return self.failed(Runner::no_browser()) };
        log::info!("sign-in: opening the login window");
        self.health(Health::signing_in());
        let mut browser = match Browser::start_sign_in(&binary, &self.paths) {
            Ok(browser) => browser,
            Err(failure) => return self.failed(failure),
        };
        loop {
            match self.queue.recv_timeout(Duration::from_millis(150)) {
                Ok(Request::Command { reply, .. }) => {
                    let _ = reply.send(Err(EngineError::new(ErrorCode::NotReady, "signing in")));
                }
                // Cancel: close the window and go back without a new session.
                Ok(Request::CancelSignIn) => {
                    drop(browser);
                    return Next::Player;
                }
                Ok(Request::SignOut) => log::info!("sign-out ignored while the sign-in window is open"),
                Ok(Request::SetBridge(source)) => self.bridge = source,
                Ok(Request::Shutdown(ack)) => {
                    drop(browser);
                    return Next::Exit(Some(ack));
                }
                Ok(Request::SignIn | Request::Retry | Request::Evaluated { .. } | Request::Cookies(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return Next::Exit(None),
            }
            if let Some(status) = browser.exited() {
                let lived = browser.uptime();
                return match sign_in_outcome(status.success(), status.code(), lived, &self.paths.browser_log()) {
                    Ok(()) => {
                        // A sign-in settles the one-time import: it never
                        // overwrites this login.
                        import::settle(&self.paths, "signed in");
                        self.backoff.reset();
                        Next::Player
                    }
                    Err(failure) => {
                        let mut next = self.failed(failure);
                        if let Next::Wait { delay, permanent: false, .. } = &mut next {
                            *delay = Duration::from_secs(10);
                        }
                        next
                    }
                };
            }
        }
    }

    // --- The player -----------------------------------------------------------

    fn player(&mut self) -> Next {
        let Some(binary) = chrome::find_browser() else { return self.failed(Runner::no_browser()) };
        let profile = self.paths.profile();
        if let Some(holder) = chrome::profile_holder(&profile) {
            return self.failed(StartError::permanent(chrome::profile_in_use(Some(holder.pid))));
        }
        let outcome = import::import_once(&self.paths, import::source_from_env().as_deref());
        log::debug!("login import: {outcome:?}");
        chrome::adopt_widevine(&profile);
        let widevine_at_start = chrome::has_widevine(&profile) || chrome::bundles_widevine(&binary);
        log::info!("player: starting {} (headless)", binary.display());
        self.health(Health::starting());
        let (events, heard) = mpsc::channel();
        let (mut browser, cdp) = match Browser::start_headless(&binary, &self.paths, events) {
            Ok(started) => started,
            Err(failure) => return self.failed(failure),
        };
        let page = match self.prepare(&cdp, &mut browser) {
            Ok(page) => page,
            Err(failure) => return self.failed(failure),
        };
        let mut live = Live::new(cdp, page, widevine_at_start);
        let next = self.run_player(&mut live, &heard, &mut browser);
        let why = match &next {
            Next::SignIn => EngineError::new(ErrorCode::NotReady, "signing in"),
            Next::Exit(_) => EngineError::new(ErrorCode::NotReady, "the engine is stopping"),
            _ => EngineError::new(ErrorCode::NotReady, "the player is restarting"),
        };
        live.fail_all(&why);
        next
    }

    /// Connects to the browser's page and sets it up: the bridge before the
    /// player's scripts, the binding it posts through, a desktop user agent;
    /// then loads the player.
    fn prepare(&self, cdp: &Cdp, browser: &mut Browser) -> Result<Page, StartError> {
        let t = Duration::from_secs(15);
        // A failed call during setup: the browser's exit status says more.
        let fail = |browser: &mut Browser, e: CdpError| -> StartError {
            match browser.wait_for_exit(Duration::from_millis(700)) {
                Some(status) => chrome::classify_exit(status),
                None => StartError::transient(format!("the browser did not answer: {e}")),
            }
        };
        let version =
            cdp.call(None, "Browser.getVersion", json!({}), Duration::from_secs(25)).map_err(|e| fail(browser, e))?;
        let targets = cdp.call(None, "Target.getTargets", json!({}), t).map_err(|e| fail(browser, e))?;
        let existing = targets["targetInfos"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|t| t["type"] == "page")
            .and_then(|t| t["targetId"].as_str())
            .map(str::to_owned);
        let target = match existing {
            Some(target) => target,
            None => cdp
                .call(None, "Target.createTarget", json!({ "url": "about:blank" }), t)
                .map_err(|e| fail(browser, e))?["targetId"]
                .as_str()
                .ok_or_else(|| StartError::transient("the browser made no page"))?
                .to_owned(),
        };
        let attached = cdp
            .call(None, "Target.attachToTarget", json!({ "targetId": target, "flatten": true }), t)
            .map_err(|e| fail(browser, e))?;
        let session =
            attached["sessionId"].as_str().ok_or_else(|| StartError::transient("no page session"))?.to_owned();
        let s = Some(session.as_str());
        let call = |method: &str, params: Value| cdp.call(s, method, params, t);
        (|| -> Result<Option<String>, CdpError> {
            call("Page.enable", json!({}))?;
            call("Runtime.enable", json!({}))?;
            call("Runtime.addBinding", json!({ "name": "spotishEvent" }))?;
            let script = call("Page.addScriptToEvaluateOnNewDocument", json!({ "source": self.bridge }))?;
            if let Some(agent) = version["userAgent"].as_str() {
                call(
                    "Emulation.setUserAgentOverride",
                    json!({ "userAgent": agent.replace("HeadlessChrome", "Chrome") }),
                )?;
            }
            call("Page.navigate", json!({ "url": chrome::PLAYER_URL }))?;
            Ok(script["identifier"].as_str().map(str::to_owned))
        })()
        .map(|script| Page { session: session.clone(), target, script })
        .map_err(|e| fail(browser, e))
    }

    /// Closes the browser cleanly (its cookie writes land on disk).
    fn close(live: &Live, browser: &mut Browser) {
        // Bounded so that a shutdown at exit fits the engine's wait.
        let _ = live.cdp.call(None, "Browser.close", json!({}), Duration::from_secs(3));
        if browser.wait_for_exit(Duration::from_secs(4)).is_none() {
            log::warn!("the browser (pid {}) did not close in time; stopping it", browser.pid());
        }
    }

    fn run_player(&mut self, live: &mut Live, heard: &mpsc::Receiver<CdpEvent>, browser: &mut Browser) -> Next {
        loop {
            match self.queue.recv_timeout(Duration::from_millis(50)) {
                Ok(Request::Command { command, reply }) => self.command(live, command, reply),
                Ok(Request::Evaluated { token, result }) => self.evaluated(live, token, result),
                Ok(Request::Cookies(result)) => {
                    live.cookie_check = None;
                    match result {
                        Some(now) => self.signed_in(Some(now)),
                        None => log::debug!("the cookie check failed; signed-in state unchanged"),
                    }
                }
                Ok(Request::SignIn) => {
                    // Flush the player's cookies before the sign-in window
                    // opens the same profile.
                    Runner::close(live, browser);
                    return Next::SignIn;
                }
                Ok(Request::SignOut) => {
                    let t = Duration::from_secs(5);
                    let cdp = &live.cdp;
                    let _ = cdp.call(None, "Storage.clearCookies", json!({}), t);
                    let _ = cdp.call(Some(&live.page.session), "Network.clearBrowserCookies", json!({}), t);
                    let _ = cdp.call(
                        None,
                        "Storage.clearDataForOrigin",
                        json!({ "origin": "https://open.spotify.com", "storageTypes": "all" }),
                        t,
                    );
                    // Never import the old login again.
                    import::settle(&self.paths, "signed out");
                    Runner::close(live, browser);
                    self.signed_in(Some(false));
                    self.out.send_modify(|s| s.player = Player::default());
                    self.backoff.reset();
                    return Next::Player;
                }
                Ok(Request::CancelSignIn) => {}
                Ok(Request::Retry) => {
                    if !live.ready {
                        self.navigate(live);
                    }
                }
                Ok(Request::SetBridge(source)) => {
                    self.bridge = source;
                    self.install_bridge(live);
                }
                Ok(Request::Shutdown(ack)) => {
                    Runner::close(live, browser);
                    return Next::Exit(Some(ack));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    Runner::close(live, browser);
                    return Next::Exit(None);
                }
            }

            while let Ok(event) = heard.try_recv() {
                if let Some(next) = self.event(live, event) {
                    return next;
                }
            }

            live.cdp.expire();
            self.expire_waiting(live);

            if let Some(status) = browser.exited() {
                log::warn!("the player browser exited ({status}); starting it again");
                let failure = if status.code() == Some(chrome::PROFILE_IN_USE_EXIT) {
                    chrome::classify_exit(status)
                } else {
                    StartError::transient(format!("the browser quit ({status})"))
                };
                return self.failed(failure);
            }

            if let Some(since) = live.ready_since
                && since.elapsed() >= Duration::from_secs(60)
            {
                self.backoff.reset();
            }

            let due = live.last_cookie_check.is_none_or(|at| at.elapsed() >= COOKIE_EVERY);
            if due && live.cookie_check.is_none() {
                self.check_cookies(live);
            }
            // The cookie check's own deadline answers it; this is a guard.
            if live.cookie_check.is_some_and(|at| at.elapsed() > Duration::from_secs(10)) {
                live.cookie_check = None;
            }

            if !live.widevine_at_start && live.last_widevine_check.elapsed() >= Duration::from_secs(8) {
                live.last_widevine_check = Instant::now();
                let profile = self.paths.profile();
                // The browser downloaded Widevine for a new profile: it loads
                // it at the next start, so restart once nothing plays.
                if chrome::has_widevine(&profile) {
                    if !live.playing {
                        log::info!("Widevine is installed; starting the player again to load it");
                        Runner::close(live, browser);
                        return Next::Player;
                    }
                } else if !live.widevine_reported && live.started.elapsed() >= WIDEVINE_GRACE {
                    live.widevine_reported = true;
                    self.health(Health::failed(EngineError::new(
                        ErrorCode::NoWidevine,
                        "The browser has no Widevine component, so Spotify cannot play. Install Google Chrome, or open Spotify once in your Chromium so it downloads Widevine.",
                    )));
                }
            }
        }
    }

    fn navigate(&self, live: &Live) {
        live.cdp.send(
            Some(&live.page.session),
            "Page.navigate",
            json!({ "url": chrome::PLAYER_URL }),
            Duration::from_secs(15),
            Box::new(|result| {
                if let Err(e) = result {
                    log::warn!("reloading the player failed: {e}");
                }
            }),
        );
    }

    /// Installs `self.bridge` for the next page loads, and in the live page.
    fn install_bridge(&self, live: &mut Live) {
        let t = Duration::from_secs(5);
        let s = Some(live.page.session.as_str());
        if let Some(old) = live.page.script.take() {
            let _ = live.cdp.call(s, "Page.removeScriptToEvaluateOnNewDocument", json!({ "identifier": old }), t);
        }
        match live.cdp.call(s, "Page.addScriptToEvaluateOnNewDocument", json!({ "source": self.bridge }), t) {
            Ok(v) => live.page.script = v["identifier"].as_str().map(str::to_owned),
            Err(e) => log::warn!("could not install the new bridge for page loads: {e}"),
        }
        live.cdp.send(
            s,
            "Runtime.evaluate",
            json!({ "expression": bridge::reinstall_expression(&self.bridge) }),
            Duration::from_secs(10),
            Box::new(|result| match result {
                Ok(v) => {
                    if let Some(text) = cdp::exception_text(&v) {
                        log::warn!("the new bridge threw as it installed: {text}");
                    }
                }
                Err(e) => log::warn!("could not install the new bridge in the page: {e}"),
            }),
        );
        log::info!("bridge replaced ({} bytes)", self.bridge.len());
    }

    fn check_cookies(&self, live: &mut Live) {
        live.cookie_check = Some(Instant::now());
        live.last_cookie_check = Some(Instant::now());
        let me = self.me.clone();
        live.cdp.send(
            None,
            "Storage.getCookies",
            json!({}),
            Duration::from_secs(5),
            Box::new(move |result| {
                let _ = me.send(Request::Cookies(result.ok().map(|v| has_session_cookie(&v))));
            }),
        );
    }

    fn command(&mut self, live: &mut Live, command: Command, reply: oneshot::Sender<Answer>) {
        if !live.ready {
            if command.is_data() {
                let deadline = Instant::now() + command.timeout();
                live.waiting_ready.push(InFlight { command, replies: vec![reply], retried: false, deadline });
            } else {
                let _ = reply.send(Err(EngineError::new(ErrorCode::NotReady, "the player is still loading")));
            }
            return;
        }
        if let Some(key) = command.coalesce() {
            let slot = live.slots.entry(key).or_default();
            if slot.busy {
                match &mut slot.next {
                    Some((latest, replies)) => {
                        *latest = command;
                        replies.push(reply);
                    }
                    None => slot.next = Some((command, vec![reply])),
                }
                return;
            }
            slot.busy = true;
        }
        self.issue(live, command, vec![reply], false);
    }

    fn issue(&mut self, live: &mut Live, command: Command, replies: Vec<oneshot::Sender<Answer>>, retried: bool) {
        let token = self.next_token;
        self.next_token += 1;
        let me = self.me.clone();
        let timeout = command.timeout();
        live.cdp.send(
            Some(&live.page.session),
            "Runtime.evaluate",
            json!({ "expression": command.expression(), "awaitPromise": true, "returnByValue": true }),
            timeout,
            Box::new(move |result| {
                let _ = me.send(Request::Evaluated { token, result });
            }),
        );
        live.inflight.insert(token, InFlight { command, replies, retried, deadline: Instant::now() + timeout });
    }

    fn evaluated(&mut self, live: &mut Live, token: u64, result: Result<Value, CdpError>) {
        let Some(mut f) = live.inflight.remove(&token) else { return };
        let answer = match evaluation(&f.command, result) {
            Evaluation::Answer(answer) => answer,
            Evaluation::ContextLost(text) if !f.retried => {
                log::info!("{} lost its page ({text}); retrying it in the next one", f.command.name());
                f.retried = true;
                live.waiting_context.push(f);
                return;
            }
            Evaluation::ContextLost(text) => {
                Err(EngineError::new(ErrorCode::NotReady, format!("the page reloaded: {text}")))
            }
        };
        if let Err(e) = &answer {
            log::debug!("{} failed: {e}", f.command.name());
        }
        reply_all(f.replies, answer);
        if let Some(key) = f.command.coalesce() {
            let slot = live.slots.entry(key).or_default();
            slot.busy = false;
            if let Some((command, replies)) = slot.next.take() {
                slot.busy = true;
                self.issue(live, command, replies, false);
            }
        }
    }

    /// Times out what waits for the player to load, or for a new page.
    fn expire_waiting(&self, live: &mut Live) {
        let now = Instant::now();
        let (overdue, kept): (Vec<_>, Vec<_>) = live.waiting_ready.drain(..).partition(|f| f.deadline <= now);
        live.waiting_ready = kept;
        for f in overdue {
            reply_all(f.replies, Err(EngineError::new(ErrorCode::NotReady, "the player did not load in time")));
        }
        let (overdue, kept): (Vec<_>, Vec<_>) = live.waiting_context.drain(..).partition(|f| f.deadline <= now);
        live.waiting_context = kept;
        for f in overdue {
            let name = f.command.name();
            reply_all(
                f.replies,
                Err(EngineError::new(ErrorCode::Timeout, format!("{name}: the page did not come back"))),
            );
            if let Some(key) = f.command.coalesce() {
                live.slots.entry(key).or_default().busy = false;
            }
        }
    }

    /// Sends what waited for a page again.
    fn resume(&mut self, live: &mut Live) {
        let waiting = std::mem::take(&mut live.waiting_context);
        for f in waiting {
            self.issue(live, f.command, f.replies, true);
        }
        if live.ready {
            let waiting = std::mem::take(&mut live.waiting_ready);
            for f in waiting {
                // Merged controls never wait for readiness; data never merges.
                self.issue(live, f.command, f.replies, false);
            }
        }
    }

    fn event(&mut self, live: &mut Live, event: CdpEvent) -> Option<Next> {
        let ours = event.session.as_deref() == Some(live.page.session.as_str());
        match event.method.as_str() {
            "Runtime.bindingCalled" if ours && event.params["name"] == "spotishEvent" => {
                let payload = event.params["payload"].as_str().unwrap_or("");
                match bridge::parse_message(payload) {
                    Ok(Message::Ready) => {
                        if !live.ready {
                            log::info!("player: ready");
                            live.ready = true;
                            live.ready_since = Some(Instant::now());
                            self.health(Health::ready());
                            live.last_cookie_check = None;
                        }
                        self.resume(live);
                    }
                    Ok(Message::State(state)) => {
                        live.playing = state.playing;
                        let state = *state;
                        self.out.send_if_modified(|s| {
                            let changed = s.player != state;
                            s.player = state;
                            changed
                        });
                    }
                    Ok(Message::Auth) => self.out.send_modify(|s| s.auth += 1),
                    Err(Unread::Version(v)) => {
                        if !live.version_warned {
                            live.version_warned = true;
                            log::warn!("the bridge speaks another protocol ({v:?}); ignoring its messages");
                        }
                    }
                    Err(e) => log::warn!("bridge message dropped: {e}: {}", truncate(payload, 300)),
                }
            }
            "Page.frameNavigated" if ours => {
                let frame = &event.params["frame"];
                if frame.get("parentId").is_none_or(Value::is_null) {
                    live.main_frame = frame["id"].as_str().map(str::to_owned);
                    if live.ready {
                        log::info!("player: the page navigated; waiting for the bridge");
                        live.ready = false;
                        live.ready_since = None;
                        self.health(Health::starting());
                    }
                }
            }
            "Runtime.executionContextCreated" if ours => {
                let context = &event.params["context"];
                let aux = &context["auxData"];
                let main = live.main_frame.as_deref().is_none_or(|f| aux["frameId"].as_str() == Some(f));
                if aux["isDefault"].as_bool() == Some(true) && main && !live.waiting_context.is_empty() {
                    self.resume(live);
                }
            }
            "Inspector.targetCrashed" if ours => {
                return Some(self.failed(StartError::transient("the player's page crashed")));
            }
            "Target.targetCrashed" | "Target.targetDestroyed"
                if event.params["targetId"] == live.page.target.as_str() =>
            {
                return Some(self.failed(StartError::transient("the player's page went away")));
            }
            "Target.detachedFromTarget" if event.params["sessionId"] == live.page.session.as_str() => {
                return Some(self.failed(StartError::transient("the player's page was detached")));
            }
            cdp::CLOSED => return Some(self.failed(StartError::transient("the connection to the browser ended"))),
            _ => {}
        }
        None
    }
}

/// What a command's evaluation came to.
#[derive(Debug, PartialEq)]
enum Evaluation {
    Answer(Answer),
    /// The page navigated under it.
    ContextLost(String),
}

fn evaluation(command: &Command, result: Result<Value, CdpError>) -> Evaluation {
    match result {
        Ok(v) => match cdp::exception_text(&v) {
            Some(text) if bridge::context_lost(&text) => Evaluation::ContextLost(text),
            Some(text) => Evaluation::Answer(Err(EngineError::parse(&text))),
            None => {
                Evaluation::Answer(bridge::decode_answer(v.pointer("/result/value").cloned().unwrap_or(Value::Null)))
            }
        },
        Err(CdpError::Protocol(text)) if bridge::context_lost(&text) => Evaluation::ContextLost(text),
        Err(CdpError::Protocol(text)) => Evaluation::Answer(Err(EngineError::new(ErrorCode::Internal, text))),
        Err(CdpError::Timeout(_)) => Evaluation::Answer(Err(EngineError::new(
            ErrorCode::Timeout,
            format!("the player did not answer {} in time", command.name()),
        ))),
        Err(CdpError::Closed) => Evaluation::Answer(Err(EngineError::new(ErrorCode::NotReady, "the player went away"))),
    }
}

/// Whether `Storage.getCookies`'s answer has Spotify's session cookie.
fn has_session_cookie(answer: &Value) -> bool {
    answer["cookies"].as_array().is_some_and(|cookies| {
        cookies.iter().any(|c| {
            c["name"] == "sp_dc"
                && c["domain"].as_str().is_some_and(|d| d.trim_start_matches('.').ends_with("spotify.com"))
                && !c["value"].as_str().unwrap_or("").is_empty()
        })
    })
}

/// What a sign-in window's end means: closed by the user after it had run a
/// while, or a failure (it never opened properly, or crashed).
fn sign_in_outcome(success: bool, code: Option<i32>, lived: Duration, log: &Path) -> Result<(), StartError> {
    if code == Some(chrome::PROFILE_IN_USE_EXIT) {
        return Err(StartError::permanent(chrome::profile_in_use(None)));
    }
    if !success || lived < SIGN_IN_MIN {
        let status = code.map(|c| format!("exit status {c}")).unwrap_or_else(|| "killed by a signal".into());
        let message = format!(
            "The sign-in window closed {} ({status}). The browser's log is at {}.",
            if lived < SIGN_IN_MIN { "as soon as it opened" } else { "with an error" },
            log.display()
        );
        return Err(StartError::transient(message));
    }
    Ok(())
}

fn truncate(text: &str, max: usize) -> &str {
    match text.char_indices().nth(max) {
        Some((at, _)) => &text[..at],
        None => text,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_exponentially() {
        let mut b = Backoff::default();
        let delays: Vec<u64> = (0..9).map(|_| b.next_delay().as_secs()).collect();
        assert_eq!(delays, [1, 2, 4, 8, 16, 32, 60, 60, 60]);
        b.reset();
        assert_eq!(b.next_delay(), Duration::from_secs(1));
    }

    #[test]
    fn reads_evaluations() {
        let c = Command::Home;
        assert_eq!(
            evaluation(&c, Ok(json!({ "result": { "type": "object", "value": { "greeting": "Hi" } } }))),
            Evaluation::Answer(Ok(json!({ "greeting": "Hi" })))
        );
        assert_eq!(
            evaluation(
                &c,
                Ok(
                    json!({ "exceptionDetails": { "exception": { "description": "Error: E_SIGNED_OUT: sign in first\n at x" } } })
                )
            ),
            Evaluation::Answer(Err(EngineError::new(ErrorCode::SignedOut, "sign in first")))
        );
        assert!(matches!(
            evaluation(&c, Err(CdpError::Protocol("Execution context was destroyed.".into()))),
            Evaluation::ContextLost(_)
        ));
        assert!(matches!(
            evaluation(
                &c,
                Ok(
                    json!({ "exceptionDetails": { "text": "Uncaught", "exception": { "description": "Error: Execution context was destroyed." } } })
                )
            ),
            Evaluation::ContextLost(_)
        ));
        let Evaluation::Answer(Err(e)) = evaluation(&c, Err(CdpError::Timeout("Runtime.evaluate".into()))) else {
            panic!("a timeout")
        };
        assert_eq!(e.code, ErrorCode::Timeout);
        // A timeout is never read as signed out.
        assert_ne!(e.code, ErrorCode::SignedOut);
    }

    #[test]
    fn finds_the_session_cookie() {
        let cookies = |name: &str, domain: &str, value: &str| json!({ "cookies": [{ "name": name, "domain": domain, "value": value }] });
        assert!(has_session_cookie(&cookies("sp_dc", ".spotify.com", "x")));
        assert!(!has_session_cookie(&cookies("sp_dc", ".spotify.com", "")));
        assert!(!has_session_cookie(&cookies("sp_dc", ".example.com", "x")));
        assert!(!has_session_cookie(&cookies("sp_t", ".spotify.com", "x")));
        assert!(!has_session_cookie(&json!({})));
    }

    #[test]
    fn a_sign_in_window_that_ends_at_once_failed() {
        let log = Path::new("chromium.log");
        assert!(sign_in_outcome(true, Some(0), Duration::from_secs(30), log).is_ok());
        let quick = sign_in_outcome(true, Some(0), Duration::from_millis(300), log).unwrap_err();
        assert!(!quick.permanent && quick.error.message.contains("as soon as it opened"));
        let crashed = sign_in_outcome(false, Some(1), Duration::from_secs(30), log).unwrap_err();
        assert!(crashed.error.message.contains("exit status 1"));
        let held = sign_in_outcome(false, Some(21), Duration::from_millis(100), log).unwrap_err();
        assert!(held.permanent);
        assert_eq!(held.error.code, ErrorCode::ProfileInUse);
    }

    /// A runner and a live page over an in-memory pipe to a fake browser.
    struct Rig {
        runner: Runner,
        live: Live,
        to_browser: mpsc::Receiver<Vec<u8>>,
        from_browser: mpsc::Sender<Vec<u8>>,
        events: mpsc::Receiver<CdpEvent>,
        state: watch::Receiver<Snapshot>,
    }

    struct ChanWriter(mpsc::Sender<Vec<u8>>);
    impl std::io::Write for ChanWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.send(buf.to_vec()).map_err(|_| std::io::ErrorKind::BrokenPipe)?;
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    struct ChanReader(mpsc::Receiver<Vec<u8>>, Vec<u8>);
    impl std::io::Read for ChanReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.1.is_empty() {
                match self.0.recv() {
                    Ok(bytes) => self.1 = bytes,
                    Err(_) => return Ok(0),
                }
            }
            let n = out.len().min(self.1.len());
            out[..n].copy_from_slice(&self.1[..n]);
            self.1.drain(..n);
            Ok(n)
        }
    }

    impl Rig {
        fn new() -> Rig {
            let (to_tx, to_browser) = mpsc::channel();
            let (from_browser, from_rx) = mpsc::channel();
            let (events_tx, events) = mpsc::channel();
            let cdp = Cdp::over_pipe(ChanReader(from_rx, Vec::new()), ChanWriter(to_tx), events_tx).unwrap();
            let (me, queue) = mpsc::channel();
            let (out, state) = watch::channel(Snapshot::default());
            let runner = Runner {
                queue,
                me,
                out,
                paths: Paths::at(std::env::temp_dir().join("spotish-rig-unused")),
                bridge: String::new(),
                backoff: Backoff::default(),
                next_token: 1,
            };
            let page = Page { session: "S".into(), target: "T".into(), script: None };
            let live = Live::new(Arc::new(cdp), page, true);
            Rig { runner, live, to_browser, from_browser, events, state }
        }

        /// The next message the engine sent the browser.
        fn sent(&self) -> Value {
            let mut bytes = self.to_browser.recv_timeout(Duration::from_secs(2)).expect("a message");
            bytes.pop();
            serde_json::from_slice(&bytes).unwrap()
        }

        fn nothing_sent(&self) -> bool {
            self.to_browser.recv_timeout(Duration::from_millis(50)).is_err()
        }

        /// The browser answers call `id` with `body` (`result` or `error`).
        fn answer(&mut self, id: &Value, body: Value) {
            let mut message = body;
            message["id"] = id.clone();
            self.from_browser.send(format!("{message}\0").into_bytes()).unwrap();
            // The answer comes back to the loop as a request.
            match self.runner.queue.recv_timeout(Duration::from_secs(2)).expect("an evaluation") {
                Request::Evaluated { token, result } => self.runner.evaluated(&mut self.live, token, result),
                Request::Cookies(result) => {
                    self.live.cookie_check = None;
                    if let Some(now) = result {
                        self.runner.signed_in(Some(now));
                    }
                }
                _ => panic!("an internal request"),
            }
        }

        /// The page posts `payload` through the binding.
        fn post(&mut self, payload: &str) {
            let event = json!({ "method": "Runtime.bindingCalled", "sessionId": "S",
                "params": { "name": "spotishEvent", "payload": payload } });
            self.page_event(event);
        }

        fn page_event(&mut self, event: Value) {
            self.from_browser.send(format!("{event}\0").into_bytes()).unwrap();
            let event = self.events.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(self.runner.event(&mut self.live, event).is_none());
        }

        fn command(&mut self, command: Command) -> oneshot::Receiver<Answer> {
            let (reply, answer) = oneshot::channel();
            self.runner.command(&mut self.live, command, reply);
            answer
        }
    }

    fn arg_of(message: &Value) -> String {
        message["params"]["expression"].as_str().unwrap().to_owned()
    }

    #[test]
    fn data_waits_for_ready_and_controls_fail_fast() {
        let mut rig = Rig::new();
        let mut home = rig.command(Command::Home);
        let mut play = rig.command(Command::Play);
        assert_eq!(play.try_recv().unwrap().unwrap_err().code, ErrorCode::NotReady);
        assert!(rig.nothing_sent());
        assert!(home.try_recv().is_err(), "data waits");
        rig.post(r#"{"v":1,"type":"ready"}"#);
        assert_eq!(rig.state.borrow().health, Health::ready());
        let sent = rig.sent();
        assert!(arg_of(&sent).contains(r#".call("home", [])"#));
        rig.answer(&sent["id"], json!({ "result": { "result": { "type": "object", "value": { "greeting": "Hi" } } } }));
        assert_eq!(home.try_recv().unwrap(), Ok(json!({ "greeting": "Hi" })));
    }

    #[test]
    fn seeks_merge_while_one_is_on_its_way() {
        let mut rig = Rig::new();
        rig.post(r#"{"v":1,"type":"ready"}"#);
        let mut first = rig.command(Command::Seek(1000.0));
        let mut second = rig.command(Command::Seek(2000.0));
        let mut third = rig.command(Command::Seek(3000.0));
        // A volume change is its own lane.
        let mut volume = rig.command(Command::SetVolume(0.5));
        let seek = rig.sent();
        assert!(arg_of(&seek).contains(r#"("seek", [1000.0])"#));
        let vol = rig.sent();
        assert!(arg_of(&vol).contains(r#"("setVolume", [0.5])"#));
        assert!(rig.nothing_sent(), "the other seeks wait");
        rig.answer(&seek["id"], json!({ "result": { "result": { "type": "boolean", "value": true } } }));
        assert!(first.try_recv().unwrap().is_ok());
        // Only the latest is sent; both waiting calls hear its answer.
        let latest = rig.sent();
        assert!(arg_of(&latest).contains(r#"("seek", [3000.0])"#));
        assert!(rig.nothing_sent());
        assert!(second.try_recv().is_err());
        rig.answer(&latest["id"], json!({ "result": { "exceptionDetails": { "exception": { "description": "Error: E_AD: an ad is playing" } } } }));
        assert_eq!(second.try_recv().unwrap().unwrap_err().code, ErrorCode::Ad);
        assert_eq!(third.try_recv().unwrap().unwrap_err().to_string(), "E_AD: an ad is playing");
        rig.answer(&vol["id"], json!({ "result": { "result": { "type": "boolean", "value": true } } }));
        assert!(volume.try_recv().unwrap().is_ok());
    }

    #[test]
    fn retries_once_after_the_page_navigates() {
        let mut rig = Rig::new();
        rig.post(r#"{"v":1,"type":"ready"}"#);
        let mut toggle = rig.command(Command::Toggle);
        let sent = rig.sent();
        rig.answer(&sent["id"], json!({ "error": { "code": -32000, "message": "Execution context was destroyed." } }));
        assert!(toggle.try_recv().is_err(), "waiting for the new page");
        rig.page_event(
            json!({ "method": "Page.frameNavigated", "sessionId": "S", "params": { "frame": { "id": "F" } } }),
        );
        assert_eq!(rig.state.borrow().health.status, crate::spotify::HealthStatus::Starting);
        rig.page_event(json!({ "method": "Runtime.executionContextCreated", "sessionId": "S",
            "params": { "context": { "id": 2, "auxData": { "isDefault": true, "frameId": "F" } } } }));
        let again = rig.sent();
        assert_eq!(arg_of(&again), arg_of(&sent));
        // A second loss is not retried.
        rig.answer(&again["id"], json!({ "error": { "message": "Execution context was destroyed." } }));
        assert_eq!(toggle.try_recv().unwrap().unwrap_err().code, ErrorCode::NotReady);
    }

    #[test]
    fn a_failed_cookie_check_changes_nothing() {
        let mut rig = Rig::new();
        rig.runner.check_cookies(&mut rig.live);
        let check = rig.sent();
        assert_eq!(check["method"], "Storage.getCookies");
        rig.answer(
            &check["id"],
            json!({ "result": { "cookies": [{ "name": "sp_dc", "domain": ".spotify.com", "value": "x" }] } }),
        );
        assert_eq!(rig.state.borrow().signed_in, Some(true));
        rig.runner.check_cookies(&mut rig.live);
        let check = rig.sent();
        // The check fails (as a timeout would): still signed in, not "out".
        rig.answer(&check["id"], json!({ "error": { "message": "Storage.getCookies timed out" } }));
        assert_eq!(rig.state.borrow().signed_in, Some(true));
    }

    #[test]
    fn states_publish_and_odd_messages_are_dropped() {
        let mut rig = Rig::new();
        rig.post(include_str!("fixtures/v1-state.json"));
        assert_eq!(rig.state.borrow().player.title, "Airbag");
        assert!(rig.live.playing);
        rig.post(r#"{"v":2,"type":"state","state":{"title":"Other"}}"#);
        rig.post(r#"{"type":"player","state":{}}"#);
        rig.post("{");
        assert_eq!(rig.state.borrow().player.title, "Airbag");
        rig.post(r#"{"v":1,"type":"auth"}"#);
        assert_eq!(rig.state.borrow().auth, 1);
    }

    fn demo() -> (Session, watch::Receiver<Snapshot>, JoinHandle<()>) {
        super::super::demo::session()
    }

    fn block<T>(rx: oneshot::Receiver<T>) -> T {
        rx.blocking_recv().expect("an answer")
    }

    #[test]
    fn a_fake_session_answers_and_publishes() {
        let (session, mut state, thread) = demo();
        assert_eq!(state.borrow_and_update().health, Health::ready());
        assert!(block(session.command(Command::Home)).is_ok());
        assert!(!state.borrow().player.playing);
        block(session.command(Command::Play)).unwrap();
        assert!(state.has_changed().unwrap());
        assert!(state.borrow_and_update().player.playing);
        block(session.command(Command::SetRepeat(crate::spotify::Repeat::Track))).unwrap();
        assert_eq!(state.borrow().player.repeat, crate::spotify::Repeat::Track);
        assert!(session.shutdown(Duration::from_secs(2)));
        thread.join().unwrap();
        // After the end, commands fail instead of hanging.
        assert_eq!(block(session.command(Command::Me)).unwrap_err().code, ErrorCode::Internal);
    }
}
