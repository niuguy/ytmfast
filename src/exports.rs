//! The `YTMusic` class exported to TSX: a handle onto the process's one
//! engine (the session with the web player). TSX gets the player's state
//! through listeners, data through async methods, and control through
//! methods.
//!
//! One owner per piece of state (mixed.md): the player's state lives in the
//! engine; TSX mirrors it in signals, updated by the listeners, and changes
//! it only through these methods. Every rejection's message is
//! `"E_CODE: message"` (see `ErrorCode`).

use std::{cell::RefCell, rc::Rc};

use nsh_core::{element::CallbackArgs, prelude::*};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::ytmusic::{
    Collection, CoverColor, EngineError, ErrorCode, Health, Home, Library, Lyrics, Me, Page, Player, PlaylistChoice, Queue, Repeat,
    SearchPage, SearchResults, Session, Snapshot, TrackPage,
    bridge::{self, Command},
    engine,
};

struct Listeners<T> {
    next: u64,
    items: Vec<(u64, Callback<T>)>,
}

impl<T> Default for Listeners<T> {
    fn default() -> Self {
        Listeners { next: 0, items: Vec::new() }
    }
}

impl<T: CallbackArgs + Clone + 'static> Listeners<T> {
    fn add(&mut self, cb: Callback<T>) -> u64 {
        let id = self.next;
        self.next += 1;
        self.items.push((id, cb));
        id
    }
    fn remove(&mut self, id: u64) {
        self.items.retain(|(i, _)| *i != id);
    }
    fn post(&self, value: T) {
        for (_, cb) in &self.items {
            cb.post(value.clone());
        }
    }
}

#[derive(Default)]
struct Inner {
    /// What the listeners last heard.
    last: Snapshot,
    on_player: Listeners<Player>,
    on_health: Listeners<Health>,
    on_signed_in: Listeners<Option<bool>>,
    on_auth: Listeners<()>,
}

impl Inner {
    /// Tells the listeners what changed since `last`.
    fn deliver(&mut self, now: Snapshot) {
        if now.player != self.last.player {
            self.on_player.post(now.player.clone());
        }
        if now.health != self.last.health {
            self.on_health.post(now.health.clone());
        }
        if now.signed_in != self.last.signed_in {
            self.on_signed_in.post(now.signed_in);
        }
        if now.auth != self.last.auth {
            self.on_auth.post(());
        }
        self.last = now;
    }
}

/// The YouTube Music engine: the web player, run headless and driven for the app.
/// Construct it as often as you like; every instance is a handle onto the
/// one engine of the process, which starts with the first.
#[class]
pub struct YTMusic {
    session: Session,
    inner: Rc<RefCell<Inner>>,
}

#[class]
impl YTMusic {
    /// A handle onto the engine (starting it, the first time): the real web
    /// player, or the recorded demo when `YTMFAST_DEMO` is set.
    pub fn new(cx: CallCx<'_>) -> Self {
        let engine = engine::engine();
        let mut state = engine.subscribe();
        let inner = Rc::new(RefCell::new(Inner { last: state.borrow_and_update().clone(), ..Inner::default() }));
        // Delivers the engine's changes to this handle's listeners, until the
        // handle goes.
        let weak = Rc::downgrade(&inner);
        cx.start(async move {
            while state.changed().await.is_ok() {
                let now = state.borrow_and_update().clone();
                let Some(inner) = weak.upgrade() else { break };
                inner.borrow_mut().deliver(now);
            }
        });
        YTMusic { session: engine.session().clone(), inner }
    }

    /// The player's current state.
    #[getter]
    pub fn player(&self) -> Player {
        engine::engine().snapshot().player
    }

    /// Where the session is.
    #[getter]
    pub fn health(&self) -> Health {
        engine::engine().snapshot().health
    }

    /// Whether an account is signed in, or null until it is known.
    #[getter]
    pub fn signed_in(&self) -> Option<bool> {
        engine::engine().snapshot().signed_in
    }

    /// Calls `listener` with the player's state now, then after every change.
    pub fn on_player(&self, #[args(player)] listener: Callback<Player>) -> Stop {
        listener.post(self.inner.borrow().last.player.clone());
        let inner = self.inner.clone();
        let id = inner.borrow_mut().on_player.add(listener);
        Stop::new(move || inner.borrow_mut().on_player.remove(id))
    }

    /// Calls `listener` with the session's health now, then when it changes.
    pub fn on_health(&self, #[args(health)] listener: Callback<Health>) -> Stop {
        listener.post(self.inner.borrow().last.health.clone());
        let inner = self.inner.clone();
        let id = inner.borrow_mut().on_health.add(listener);
        Stop::new(move || inner.borrow_mut().on_health.remove(id))
    }

    /// Calls `listener` with whether an account is signed in (null while
    /// unknown) now, then when it changes.
    pub fn on_signed_in(&self, #[args(signed_in)] listener: Callback<Option<bool>>) -> Stop {
        listener.post(self.inner.borrow().last.signed_in);
        let inner = self.inner.clone();
        let id = inner.borrow_mut().on_signed_in.add(listener);
        Stop::new(move || inner.borrow_mut().on_signed_in.remove(id))
    }

    /// Calls `listener` when the player signs a new token (data that failed
    /// before may now load). Not called on subscribing.
    pub fn on_auth(&self, listener: Callback<()>) -> Stop {
        let inner = self.inner.clone();
        let id = inner.borrow_mut().on_auth.add(listener);
        Stop::new(move || inner.borrow_mut().on_auth.remove(id))
    }

    // --- Data ----------------------------------------------------------------

    /// The home page.
    pub async fn home(this: Instance<Self>) -> Result<Home, String> {
        data(this, Command::Home).await
    }

    /// What a search for `query` finds.
    pub async fn search(this: Instance<Self>, query: String) -> Result<SearchResults, String> {
        data(this, Command::Search(query)).await
    }

    /// A playlist by URI.
    pub async fn playlist(this: Instance<Self>, uri: String) -> Result<Collection, String> {
        data(this, Command::Playlist(uri)).await
    }

    /// A playlist's first page of tracks, with the `continuation` its other
    /// tracks follow from (`tracks_after`); empty when there are no more.
    pub async fn playlist_start(this: Instance<Self>, uri: String) -> Result<Collection, String> {
        data(this, Command::PlaylistStart(uri)).await
    }

    /// The tracks of a long playlist after `continuation`, numbered from
    /// `offset` (the number of tracks before them).
    pub async fn tracks_after(this: Instance<Self>, continuation: String, offset: f64) -> Result<TrackPage, String> {
        data(this, Command::TracksAfter { continuation, offset }).await
    }

    /// An album by URI.
    pub async fn album(this: Instance<Self>, uri: String) -> Result<Collection, String> {
        data(this, Command::Album(uri)).await
    }

    /// An artist by URI: popular tracks, and releases.
    pub async fn artist(this: Instance<Self>, uri: String) -> Result<Collection, String> {
        data(this, Command::Artist(uri)).await
    }

    /// The signed-in user's Liked Songs.
    pub async fn liked_songs(this: Instance<Self>) -> Result<Collection, String> {
        data(this, Command::LikedSongs).await
    }

    /// Liked Songs' first page of tracks, and where the rest start (as
    /// `playlist_start`).
    pub async fn liked_songs_start(this: Instance<Self>) -> Result<Collection, String> {
        data(this, Command::LikedSongsStart).await
    }

    /// The signed-in user's library.
    pub async fn library(this: Instance<Self>) -> Result<Library, String> {
        data(this, Command::Library).await
    }

    /// The signed-in user (`id` keys per-account data).
    pub async fn me(this: Instance<Self>) -> Result<Me, String> {
        data(this, Command::Me).await
    }

    /// A cover image's extracted color (`hex` empty when unknown), for the
    /// cover-tinted backdrops.
    pub async fn colors(this: Instance<Self>, image_url: String) -> Result<CoverColor, String> {
        data(this, Command::Colors(image_url)).await
    }

    /// A track's lyrics by URI (no lines when YouTube Music has none).
    pub async fn lyrics(this: Instance<Self>, track_uri: String) -> Result<Lyrics, String> {
        data(this, Command::Lyrics(track_uri)).await
    }

    /// Home filtered by one of its chips (`params`; "" is Home itself).
    pub async fn home_with(this: Instance<Self>, params: String) -> Result<Home, String> {
        if params.is_empty() { data(this, Command::Home).await } else { data(this, Command::HomeChip(params)).await }
    }

    /// A browse page by URI (`ytm:page:…`): Explore, charts, new releases,
    /// moods and genres, one mood or genre.
    pub async fn browse(this: Instance<Self>, uri: String) -> Result<Page, String> {
        data(this, Command::Browse(uri)).await
    }

    /// One page of a search for one kind (`songs`, `videos`, `albums`,
    /// `artists`, `playlists`), or the page after `continuation`.
    pub async fn search_filtered(
        this: Instance<Self>,
        query: String,
        filter: String,
        continuation: Option<String>,
    ) -> Result<SearchPage, String> {
        data(this, Command::SearchFiltered { query, filter, continuation }).await
    }

    /// Suggestions for a query being typed.
    pub async fn search_suggestions(this: Instance<Self>, query: String) -> Result<Vec<String>, String> {
        data(this, Command::SearchSuggestions(query)).await
    }

    /// What the signed-in account played, newest first.
    pub async fn history(this: Instance<Self>) -> Result<Collection, String> {
        data(this, Command::History).await
    }

    /// The account's playlists a song can be added to.
    pub async fn playlist_choices(this: Instance<Self>, track_uri: String) -> Result<Vec<PlaylistChoice>, String> {
        data(this, Command::PlaylistChoices(track_uri)).await
    }

    /// The play queue.
    pub async fn queue(this: Instance<Self>) -> Result<Queue, String> {
        data(this, Command::Queue).await
    }

    // --- Controls --------------------------------------------------------------

    /// Puts a song, album, playlist or mix in the queue: after the one
    /// playing (`next`), or at the end. Answers the queue.
    pub async fn queue_add(this: Instance<Self>, uri: String, next: bool) -> Result<Queue, String> {
        data(this, Command::QueueAdd { uri, next }).await
    }

    /// Takes the queue's entry `id` out of it. Answers the queue.
    pub async fn queue_remove(this: Instance<Self>, id: String) -> Result<Queue, String> {
        data(this, Command::QueueRemove(id)).await
    }

    /// Plays the queue's entry `id`. Answers the queue.
    pub async fn queue_jump(this: Instance<Self>, id: String) -> Result<Queue, String> {
        data(this, Command::QueueJump(id)).await
    }

    /// Plays the radio of a song, album, playlist or artist.
    pub async fn start_radio(this: Instance<Self>, uri: String) -> Result<(), String> {
        control(this, Command::StartRadio(uri)).await
    }

    /// Dislikes the song playing, or takes the dislike back.
    pub async fn set_disliked(this: Instance<Self>, on: bool) -> Result<(), String> {
        control(this, Command::SetDisliked(on)).await
    }

    /// Rates any song: `like`, `dislike` or `none`.
    pub async fn rate(this: Instance<Self>, uri: String, rating: String) -> Result<(), String> {
        control(this, Command::Rate { uri, rating }).await
    }

    /// Saves an album or a playlist to the library, or takes it out.
    pub async fn set_saved(this: Instance<Self>, uri: String, on: bool) -> Result<(), String> {
        control(this, Command::SetSaved { uri, on }).await
    }

    /// Subscribes to an artist, or unsubscribes.
    pub async fn set_subscribed(this: Instance<Self>, uri: String, on: bool) -> Result<(), String> {
        control(this, Command::SetSubscribed { uri, on }).await
    }

    /// Adds a song to one of the account's playlists.
    pub async fn add_to_playlist(this: Instance<Self>, playlist: String, track: String) -> Result<(), String> {
        control(this, Command::AddToPlaylist { playlist, track }).await
    }

    /// Makes a private playlist named `name`, with the song `track` in it
    /// when given; answers its URI.
    pub async fn create_playlist(this: Instance<Self>, name: String, track: Option<String>) -> Result<String, String> {
        data(this, Command::CreatePlaylist { name, track }).await
    }

    /// Takes the row `setVideoId` (the song `track`) out of one of the
    /// account's playlists.
    pub async fn remove_from_playlist(
        this: Instance<Self>,
        playlist: String,
        track: String,
        set_video_id: String,
    ) -> Result<(), String> {
        control(this, Command::RemoveFromPlaylist { playlist, track, set_video_id }).await
    }

    /// Plays or pauses.
    pub async fn toggle(this: Instance<Self>) -> Result<(), String> {
        control(this, Command::Toggle).await
    }

    /// Plays.
    pub async fn play(this: Instance<Self>) -> Result<(), String> {
        control(this, Command::Play).await
    }

    /// Pauses.
    pub async fn pause(this: Instance<Self>) -> Result<(), String> {
        control(this, Command::Pause).await
    }

    /// Skips to the next track.
    pub async fn next(this: Instance<Self>) -> Result<(), String> {
        control(this, Command::Next).await
    }

    /// Goes to the previous track.
    pub async fn previous(this: Instance<Self>) -> Result<(), String> {
        control(this, Command::Previous).await
    }

    /// Seeks to `ms` milliseconds. While a seek is on its way, only the
    /// latest one asked for is sent next; superseded calls resolve with it.
    pub async fn seek(this: Instance<Self>, ms: f64) -> Result<(), String> {
        control(this, Command::Seek(ms)).await
    }

    /// Sets the volume, 0 to 1 (merged as `seek` is).
    pub async fn set_volume(this: Instance<Self>, volume: f64) -> Result<(), String> {
        control(this, Command::SetVolume(volume)).await
    }

    /// Turns shuffle on or off.
    pub async fn set_shuffle(this: Instance<Self>, on: bool) -> Result<(), String> {
        control(this, Command::SetShuffle(on)).await
    }

    /// Sets how it repeats.
    pub async fn set_repeat(this: Instance<Self>, mode: Repeat) -> Result<(), String> {
        control(this, Command::SetRepeat(mode)).await
    }

    /// Saves the track to Liked Songs, or removes it.
    pub async fn set_liked(this: Instance<Self>, on: bool) -> Result<(), String> {
        control(this, Command::SetLiked(on)).await
    }

    /// Mutes or unmutes.
    pub async fn set_muted(this: Instance<Self>, on: bool) -> Result<(), String> {
        control(this, Command::SetMuted(on)).await
    }

    /// Plays a playlist, album, artist or Liked Songs, from the track
    /// `trackUri` when given.
    pub async fn play_context(this: Instance<Self>, uri: String, track_uri: Option<String>) -> Result<(), String> {
        control(this, Command::PlayContext { uri, track_uri }).await
    }

    /// Plays one track (its radio follows it).
    pub async fn play_track(this: Instance<Self>, uri: String) -> Result<(), String> {
        control(this, Command::PlayTrack(uri)).await
    }

    // --- The account and the engine ---------------------------------------------

    /// Opens the sign-in window; the player stops until it closes.
    pub fn sign_in(&self) {
        self.session.sign_in();
    }

    /// Closes the sign-in window without signing in.
    pub fn cancel_sign_in(&self) {
        self.session.cancel_sign_in();
    }

    /// Signs out of YouTube (the login is never re-imported afterwards).
    pub fn sign_out(&self) {
        self.session.sign_out();
    }

    /// Starts the player again now, after a failure (skips the wait before
    /// the next attempt).
    pub fn retry(&self) {
        self.session.retry();
    }

    /// Replaces the bridge script (an OTA fix): used for every later page
    /// load, and installed in the live page at once.
    pub fn set_bridge(&self, source: String) {
        self.session.set_bridge(source);
    }
}

/// Runs `command` and returns the bridge's JSON.
async fn ask(this: Instance<YTMusic>, command: Command) -> Result<Value, EngineError> {
    let session = this.with(|s| s.session.clone());
    session
        .command(command)
        .await
        .unwrap_or_else(|_| Err(EngineError::new(ErrorCode::Internal, "the engine dropped the call")))
}

/// A data command, decoded into its type.
async fn data<T: DeserializeOwned>(this: Instance<YTMusic>, command: Command) -> Result<T, String> {
    let value = ask(this, command.clone()).await?;
    bridge::decode(&command, value).map_err(String::from)
}

/// A control: the answer's value is ignored.
async fn control(this: Instance<YTMusic>, command: Command) -> Result<(), String> {
    ask(this, command).await.map(|_| ()).map_err(String::from)
}
