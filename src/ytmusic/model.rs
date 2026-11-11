//! What the engine hands TSX: the bridge's answers (items, tracks, pages of
//! them), the player's state and the session's health. Each type decodes from
//! the bridge's JSON (serde) and crosses to TSX as a typed object
//! (`JsObject`), so a shape that drifts fails here, as `E_SHAPE`, not in a
//! screen.

use std::fmt;

use nsh_core::prelude::*;
use serde::Deserialize;

/// A playlist, album, artist, show, Liked Songs or a track shown as a card.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Item {
    /// The URI (`ytm:playlist:…`).
    pub uri: String,
    /// `playlist`, `album`, `artist`, `show`, `collection` or `track`.
    pub kind: String,
    /// Its name.
    pub name: String,
    /// The line under the name (owner, artists, year).
    pub subtitle: String,
    /// The cover URL, empty when it has none.
    pub image: String,
    /// A page's colour (`#rrggbb`, a mood or genre's stripe), or empty.
    pub color: String,
}

impl Item {
    /// Whether the app has a page for it (a track or a mix has none: it
    /// plays).
    pub fn opens(&self) -> bool {
        matches!(self.kind.as_str(), "playlist" | "album" | "artist" | "collection" | "page" | "history")
    }
}

/// A track of a list.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Track {
    /// The track's URI (`ytm:track:…`).
    pub uri: String,
    /// Its row's id in the list (empty in search results).
    pub uid: String,
    /// Its title.
    pub name: String,
    /// Its artists, joined with commas.
    pub artists: String,
    /// The album's name.
    pub album: String,
    /// The album's URI.
    pub album_uri: String,
    /// The cover URL.
    pub image: String,
    /// Its length, in milliseconds.
    pub duration_ms: f64,
    /// Whether it is marked explicit.
    pub explicit: bool,
    /// Whether it can be played in this account's region.
    pub playable: bool,
}

/// The header of a collection's page.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Header {
    /// The collection's URI.
    pub uri: String,
    /// `playlist`, `album`, `artist` or `collection`.
    pub kind: String,
    /// Its name.
    pub name: String,
    /// The line under the name.
    pub subtitle: String,
    /// The cover URL.
    pub image: String,
    /// Its description, as plain text.
    pub description: String,
    /// Whether it is saved in the library; null when it cannot be (Liked
    /// Music, an artist, a playlist of one's own).
    pub saved: Option<bool>,
    /// Whether it is a playlist of the account's own (its songs can be
    /// taken out).
    pub editable: bool,
    /// Whether the account subscribes to the artist; null for the others.
    pub subscribed: Option<bool>,
}

/// A playlist, album, artist or Liked Songs: its header, tracks and, for an
/// artist, releases.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Collection {
    /// What the page's header shows.
    pub header: Header,
    /// Its tracks (an artist's popular tracks).
    pub tracks: Vec<Track>,
    /// An artist's albums and singles; empty for the others.
    pub releases: Vec<Item>,
    /// How many tracks it has in all (more than `tracks` holds when long).
    pub total: f64,
    /// Where the rest of a long playlist's tracks start (`tracks_after`)
    /// when only its first page was asked for; empty otherwise.
    pub continuation: String,
}

/// A titled row of cards on the home page.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Section {
    /// The row's title (may be empty for a row of buttons).
    pub title: String,
    /// `cards` (covers in a row), or `buttons` (pages, as chips).
    pub kind: String,
    /// Its cards.
    pub items: Vec<Item>,
}

/// One of Home's filters ("Relax", "Workout"): Home with its `params`.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Chip {
    /// Its label.
    pub title: String,
    /// What Home is asked with to show it.
    pub params: String,
    /// Whether Home shows it now.
    pub selected: bool,
}

/// A browse page (Explore, charts, new releases, moods and genres, a mood).
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Page {
    /// Its title.
    pub title: String,
    /// Its rows.
    pub sections: Vec<Section>,
}

/// One entry of the play queue.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct QueueItem {
    /// The page's id of the entry (it removes it, or plays it).
    pub id: String,
    /// The song (`ytm:track:…`).
    pub uri: String,
    /// Its title.
    pub name: String,
    /// Its artists.
    pub artists: String,
    /// Its cover.
    pub image: String,
    /// Its length, in milliseconds.
    pub duration_ms: f64,
    /// Whether it is the one playing.
    pub current: bool,
}

/// The play queue.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Queue {
    /// What is queued, in order.
    pub items: Vec<QueueItem>,
    /// The index of the one playing, or -1.
    pub current: f64,
    /// What autoplay plays after the queue.
    pub autoplay: Vec<QueueItem>,
}

/// One page of a search for one kind of thing.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchPage {
    /// Songs or videos found (for those kinds).
    pub tracks: Vec<Track>,
    /// Albums, artists or playlists found (for those kinds).
    pub items: Vec<Item>,
    /// Where the next page starts; empty at the end.
    pub continuation: String,
}

/// The next page of a long playlist's tracks.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct TrackPage {
    /// Its tracks.
    pub tracks: Vec<Track>,
    /// Where the next page starts; empty at the end.
    pub continuation: String,
}

/// A playlist a song can be added to.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct PlaylistChoice {
    /// The playlist (`ytm:playlist:…`).
    pub uri: String,
    /// Its name.
    pub name: String,
    /// Its line under the name ("6 tracks").
    pub subtitle: String,
}

/// The home page.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Home {
    /// The greeting ("Good morning").
    pub greeting: String,
    /// The rows of cards.
    pub sections: Vec<Section>,
    /// Its filters.
    pub chips: Vec<Chip>,
}

/// What a search found.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchResults {
    /// Matching tracks.
    pub tracks: Vec<Track>,
    /// Matching artists.
    pub artists: Vec<Item>,
    /// Matching albums.
    pub albums: Vec<Item>,
    /// Matching playlists.
    pub playlists: Vec<Item>,
}

impl SearchResults {
    /// Whether it found nothing.
    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty() && self.artists.is_empty() && self.albums.is_empty() && self.playlists.is_empty()
    }
}

/// The signed-in user's library.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Library {
    /// Its playlists, albums, artists and Liked Songs.
    pub items: Vec<Item>,
}

/// The signed-in user.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Me {
    /// The account's stable id (keys per-account caches).
    pub id: String,
    /// The display name.
    pub name: String,
    /// The user name.
    pub username: String,
    /// The avatar URL, empty when there is none.
    pub image: String,
}

/// A cover's extracted color.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default)]
pub struct CoverColor {
    /// `#rrggbb`, empty when unknown.
    pub hex: String,
    /// The cover's own colours (`#rrggbb`), most telling first, up to five;
    /// empty when unknown.
    pub palette: Vec<String>,
}

/// A track's lyrics.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default)]
pub struct Lyrics {
    /// Whether each line has its time (else they are plain words).
    pub synced: bool,
    /// The lines in order; none when YouTube Music has no lyrics for the track.
    pub lines: Vec<LyricLine>,
    /// Who provides them (shown under them), or empty.
    pub provider: String,
}

/// One line of lyrics.
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct LyricLine {
    /// When it starts, ms into the track (0 when the lyrics are not timed).
    pub start_ms: f64,
    /// Its words ("♪" for an instrumental break).
    pub words: String,
}

/// How the player repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, PropEnum)]
#[serde(rename_all = "camelCase")]
pub enum Repeat {
    /// It stops at the end of the context.
    #[default]
    Off,
    /// It plays the context again.
    Context,
    /// It plays the track again.
    Track,
}

impl Repeat {
    /// The bridge's name for it.
    pub fn as_str(self) -> &'static str {
        match self {
            Repeat::Off => "off",
            Repeat::Context => "context",
            Repeat::Track => "track",
        }
    }
}

/// The player's state, as the web player's own controls show it (one object
/// per change).
#[derive(Debug, Clone, PartialEq, Default, Deserialize, JsObject)]
#[serde(default, rename_all = "camelCase")]
pub struct Player {
    /// The track's title, empty when nothing is loaded.
    pub title: String,
    /// The track's artists.
    pub artist: String,
    /// The album's name.
    pub album: String,
    /// The album art URL.
    pub artwork: String,
    /// The track's URI (`ytm:track:…`).
    pub track_uri: String,
    /// The path of the context playing (`/playlist/…`), for linking to it.
    pub context_href: String,
    /// Whether it is playing.
    pub playing: bool,
    /// Whether the player can play at all.
    pub can_play: bool,
    /// The playback position when it was sampled, in milliseconds.
    pub position_ms: f64,
    /// The track's length, in milliseconds.
    pub duration_ms: f64,
    /// When `positionMs` was sampled, in epoch milliseconds: while playing,
    /// the position now is `positionMs + (Date.now() - at)`.
    pub at: f64,
    /// Whether shuffle is on.
    pub shuffle: bool,
    /// Whether shuffle can be changed.
    pub shuffle_available: bool,
    /// How it repeats.
    pub repeat: Repeat,
    /// The volume, 0 to 1.
    pub volume: f64,
    /// Whether it is muted.
    pub muted: bool,
    /// Whether the track is saved to Liked Songs.
    pub liked: bool,
    /// Whether the track is disliked.
    pub disliked: bool,
    /// Whether there is a next track.
    pub can_next: bool,
    /// Whether there is a previous track.
    pub can_previous: bool,
    /// Whether an ad is playing.
    pub ad: bool,
    /// Whether the account is Premium (free accounts hear ads); null while
    /// unknown.
    pub premium: Option<bool>,
}

impl Player {
    /// Whether a track (or an ad) is loaded in the player.
    pub fn has_track(&self) -> bool {
        !self.title.is_empty()
    }
}

/// Where the session is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, PropEnum)]
pub enum HealthStatus {
    /// The browser is starting, or the player loading in it.
    #[default]
    Starting,
    /// The player runs; data and controls work.
    Ready,
    /// The sign-in window is open.
    SigningIn,
    /// Something keeps the player from running; `error` says what.
    Failed,
}

/// What went wrong, by kind. Every rejection's message starts with one
/// (`"E_TIMEOUT: …"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, PropEnum)]
pub enum ErrorCode {
    /// The player has not loaded yet.
    #[default]
    #[prop(rename = "E_NOT_READY")]
    NotReady,
    /// No Google account is signed in.
    #[prop(rename = "E_SIGNED_OUT")]
    SignedOut,
    /// Another browser process holds YTMFast's profile.
    #[prop(rename = "E_PROFILE_IN_USE")]
    ProfileInUse,
    /// No Chromium-family browser is installed.
    #[prop(rename = "E_NO_BROWSER")]
    NoBrowser,
    /// The player did not answer in time.
    #[prop(rename = "E_TIMEOUT")]
    Timeout,
    /// What was asked for does not exist.
    #[prop(rename = "E_NOT_FOUND")]
    NotFound,
    /// The control is disabled right now.
    #[prop(rename = "E_DISABLED")]
    Disabled,
    /// An ad is playing, and the control waits for it to end.
    #[prop(rename = "E_AD")]
    Ad,
    /// The player answered in a shape the app does not know.
    #[prop(rename = "E_SHAPE")]
    Shape,
    /// The player does not know the query the app relies on.
    #[prop(rename = "E_UNKNOWN_QUERY")]
    UnknownQuery,
    /// Anything else (a bug, the browser went away).
    #[prop(rename = "E_INTERNAL")]
    Internal,
}

impl ErrorCode {
    /// Every code, for parsing.
    pub const ALL: [ErrorCode; 11] = [
        ErrorCode::NotReady,
        ErrorCode::SignedOut,
        ErrorCode::ProfileInUse,
        ErrorCode::NoBrowser,
        ErrorCode::Timeout,
        ErrorCode::NotFound,
        ErrorCode::Disabled,
        ErrorCode::Ad,
        ErrorCode::Shape,
        ErrorCode::UnknownQuery,
        ErrorCode::Internal,
    ];

    /// Its wire name (`E_TIMEOUT`).
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::NotReady => "E_NOT_READY",
            ErrorCode::SignedOut => "E_SIGNED_OUT",
            ErrorCode::ProfileInUse => "E_PROFILE_IN_USE",
            ErrorCode::NoBrowser => "E_NO_BROWSER",
            ErrorCode::Timeout => "E_TIMEOUT",
            ErrorCode::NotFound => "E_NOT_FOUND",
            ErrorCode::Disabled => "E_DISABLED",
            ErrorCode::Ad => "E_AD",
            ErrorCode::Shape => "E_SHAPE",
            ErrorCode::UnknownQuery => "E_UNKNOWN_QUERY",
            ErrorCode::Internal => "E_INTERNAL",
        }
    }

    /// The code named `name`.
    pub fn parse(name: &str) -> Option<ErrorCode> {
        ErrorCode::ALL.into_iter().find(|c| c.as_str() == name)
    }
}

/// An error with its kind: what `Health.error` holds, and what a rejection's
/// message says as `"CODE: message"`.
#[derive(Debug, Clone, PartialEq, Eq, Default, JsObject)]
pub struct EngineError {
    /// The kind (`E_TIMEOUT`, …).
    pub code: ErrorCode,
    /// What happened, for people.
    pub message: String,
}

impl EngineError {
    /// An error of `code`.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> EngineError {
        EngineError { code, message: message.into() }
    }

    /// Reads `"E_CODE: message"` (a bridge's error, or an exception's text,
    /// maybe prefixed `Error: `). Text with no known code is `E_INTERNAL`;
    /// an unknown `E_…` code is kept, under `E_INTERNAL`, in the message.
    pub fn parse(text: &str) -> EngineError {
        let line = text.lines().next().unwrap_or("").trim();
        let mut line = line;
        for prefix in ["Uncaught ", "Error: ", "Error "] {
            line = line.strip_prefix(prefix).unwrap_or(line);
        }
        if let Some((code, message)) = line.split_once(':')
            && let Some(code) = ErrorCode::parse(code.trim())
        {
            return EngineError::new(code, message.trim());
        }
        if line.is_empty() {
            return EngineError::new(ErrorCode::Internal, "the player failed with no message");
        }
        EngineError::new(ErrorCode::Internal, line)
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for EngineError {}

impl From<EngineError> for String {
    fn from(error: EngineError) -> String {
        error.to_string()
    }
}

/// Where the session is, as TSX sees it.
#[derive(Debug, Clone, PartialEq, Default, JsObject)]
pub struct Health {
    /// `starting`, `ready`, `signingIn` or `failed`.
    pub status: HealthStatus,
    /// Why, when `status` is `failed` (or when a start failed and is being
    /// retried); null otherwise.
    pub error: Option<EngineError>,
}

impl Health {
    /// Starting, with no error.
    pub fn starting() -> Health {
        Health { status: HealthStatus::Starting, error: None }
    }
    /// Ready.
    pub fn ready() -> Health {
        Health { status: HealthStatus::Ready, error: None }
    }
    /// The sign-in window is open.
    pub fn signing_in() -> Health {
        Health { status: HealthStatus::SigningIn, error: None }
    }
    /// Failed with `error`.
    pub fn failed(error: EngineError) -> Health {
        Health { status: HealthStatus::Failed, error: Some(error) }
    }
}

/// `m:ss` (or `h:mm:ss`) of a duration.
pub fn clock(ms: u64) -> String {
    let seconds = ms / 1000;
    let (h, m, s) = (seconds / 3600, (seconds / 60) % 60, seconds % 60);
    if h > 0 { format!("{h}:{m:02}:{s:02}") } else { format!("{m}:{s:02}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clocks() {
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(61_000), "1:01");
        assert_eq!(clock(3_725_000), "1:02:05");
    }

    #[test]
    fn error_codes_round_trip() {
        for code in ErrorCode::ALL {
            assert_eq!(ErrorCode::parse(code.as_str()), Some(code));
        }
        assert_eq!(ErrorCode::parse("E_NOPE"), None);
    }

    #[test]
    fn parses_coded_messages() {
        let e = EngineError::parse("E_AD: an ad is playing");
        assert_eq!(e, EngineError::new(ErrorCode::Ad, "an ad is playing"));
        assert_eq!(e.to_string(), "E_AD: an ad is playing");
        // An exception's description: `Error: ` and the stack go.
        let e = EngineError::parse("Error: E_DISABLED: next is disabled\n    at controls.next (bridge.js:10)");
        assert_eq!(e, EngineError::new(ErrorCode::Disabled, "next is disabled"));
        let e = EngineError::parse("Uncaught Error: E_NOT_FOUND: no row for ytm:track:x");
        assert_eq!(e.code, ErrorCode::NotFound);
        // Uncoded text is internal, kept whole.
        let e = EngineError::parse("TypeError: x is undefined");
        assert_eq!(e, EngineError::new(ErrorCode::Internal, "TypeError: x is undefined"));
        // An unknown code stays in the message.
        assert_eq!(EngineError::parse("E_WHAT: odd").to_string(), "E_INTERNAL: E_WHAT: odd");
        assert_eq!(EngineError::parse("").code, ErrorCode::Internal);
    }
}
