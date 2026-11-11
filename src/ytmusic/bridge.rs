//! The bridge protocol, version 1: what `bridge/bridge.js` posts through the
//! `ytmfastEvent` binding, and the commands the engine sends it
//! (`window.__ytmfast.call(name, args)`). Both directions are defined once,
//! here, and tested on recorded payloads.

use serde::Deserialize;
use serde_json::{Value, json};

use super::model::{EngineError, ErrorCode, Player, Repeat};

/// The protocol version this engine speaks.
pub const VERSION: u64 = 1;

/// The bridge shipped in the binary; `setBridge` replaces it at run time.
pub const BUNDLED: &str = include_str!("../bridge/bridge.js");

/// A message from the bridge.
#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    /// The top frame's player is usable (its bar and auth headers exist).
    Ready,
    /// The player's state changed.
    State(Box<Player>),
    /// The player signed its requests with a new token.
    Auth,
}

/// Why a message was not understood.
#[derive(Debug, Clone, PartialEq)]
pub enum Unread {
    /// Not JSON, or not an object with a `type`.
    Malformed(String),
    /// Another protocol version (`None`: no `v` at all).
    Version(Option<u64>),
    /// A known type whose body did not decode.
    Shape { kind: String, error: String },
    /// A type this engine does not know (newer bridges may add some).
    Unknown(String),
}

impl std::fmt::Display for Unread {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Unread::Malformed(e) => write!(f, "malformed message: {e}"),
            Unread::Version(Some(v)) => write!(f, "protocol version {v} (this engine speaks {VERSION})"),
            Unread::Version(None) => write!(f, "message without a protocol version"),
            Unread::Shape { kind, error } => write!(f, "`{kind}` message of an unknown shape: {error}"),
            Unread::Unknown(kind) => write!(f, "unknown message type `{kind}`"),
        }
    }
}

#[derive(Deserialize)]
struct Envelope {
    v: Option<u64>,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    state: Value,
}

/// Reads one `ytmfastEvent` payload.
pub fn parse_message(payload: &str) -> Result<Message, Unread> {
    let envelope: Envelope = serde_json::from_str(payload).map_err(|e| Unread::Malformed(e.to_string()))?;
    if envelope.v != Some(VERSION) {
        return Err(Unread::Version(envelope.v));
    }
    match envelope.kind.as_str() {
        "ready" => Ok(Message::Ready),
        "auth" => Ok(Message::Auth),
        "state" => serde_json::from_value::<Player>(envelope.state)
            .map(|p| Message::State(Box::new(p)))
            .map_err(|e| Unread::Shape { kind: "state".into(), error: e.to_string() }),
        other => Err(Unread::Unknown(other.to_owned())),
    }
}

/// A control the engine merges: while one is on its way, only the latest
/// value asked for is sent next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Coalesce {
    Seek,
    Volume,
}

/// What the engine asks the bridge for.
#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Home,
    Search(String),
    Playlist(String),
    /// A playlist's first page of tracks, and where the rest start.
    PlaylistStart(String),
    Album(String),
    Artist(String),
    LikedSongs,
    /// Liked Songs' first page of tracks, and where the rest start.
    LikedSongsStart,
    /// A long playlist's tracks after `continuation`, numbered from `offset`.
    TracksAfter {
        continuation: String,
        offset: f64,
    },
    Library,
    Me,
    Toggle,
    Play,
    Pause,
    Next,
    Previous,
    /// To this position, in milliseconds.
    Seek(f64),
    /// To this volume, 0 to 1.
    SetVolume(f64),
    SetShuffle(bool),
    SetRepeat(Repeat),
    SetLiked(bool),
    SetMuted(bool),
    /// A context, from `track_uri` when given.
    PlayContext {
        uri: String,
        track_uri: Option<String>,
    },
    PlayTrack(String),
    /// The extracted color of a cover image.
    Colors(String),
    /// A track's lyrics, by its URI.
    Lyrics(String),
    /// Home filtered by one of its chips (`params`).
    HomeChip(String),
    /// A browse page (`ytm:page:…`).
    Browse(String),
    /// One page of a search for one kind (`songs`, `videos`, `albums`,
    /// `artists`, `playlists`), or the page after `continuation`.
    SearchFiltered {
        query: String,
        filter: String,
        continuation: Option<String>,
    },
    /// Suggestions for a query being typed.
    SearchSuggestions(String),
    /// What the account played.
    History,
    /// The playlists a song can be added to.
    PlaylistChoices(String),
    /// The play queue.
    Queue,
    /// Puts a song, album, playlist or mix in the queue, after the one
    /// playing (`next`) or at the end.
    QueueAdd {
        uri: String,
        next: bool,
    },
    /// Takes the queue's entry out of it.
    QueueRemove(String),
    /// Plays the queue's entry.
    QueueJump(String),
    /// Plays the radio of a song, album, playlist or artist.
    StartRadio(String),
    /// Dislikes the song playing, or takes it back.
    SetDisliked(bool),
    /// Rates any song: `like`, `dislike` or `none`.
    Rate {
        uri: String,
        rating: String,
    },
    /// Saves an album or playlist to the library, or takes it out.
    SetSaved {
        uri: String,
        on: bool,
    },
    /// Subscribes to an artist, or unsubscribes.
    SetSubscribed {
        uri: String,
        on: bool,
    },
    /// Adds a song to one of the account's playlists.
    AddToPlaylist {
        playlist: String,
        track: String,
    },
    /// Makes a private playlist, with a song in it when given.
    CreatePlaylist {
        name: String,
        track: Option<String>,
    },
    /// Takes a row (`set_video_id`) out of one of the account's playlists.
    RemoveFromPlaylist {
        playlist: String,
        track: String,
        set_video_id: String,
    },
}

impl Command {
    /// The bridge's name for it.
    pub fn name(&self) -> &'static str {
        match self {
            Command::Home => "home",
            Command::Search(_) => "search",
            Command::Playlist(_) | Command::PlaylistStart(_) => "playlist",
            Command::Album(_) => "album",
            Command::Artist(_) => "artist",
            Command::LikedSongs | Command::LikedSongsStart => "likedSongs",
            Command::TracksAfter { .. } => "tracksAfter",
            Command::Library => "library",
            Command::Me => "me",
            Command::Toggle => "toggle",
            Command::Play => "play",
            Command::Pause => "pause",
            Command::Next => "next",
            Command::Previous => "previous",
            Command::Seek(_) => "seek",
            Command::SetVolume(_) => "setVolume",
            Command::SetShuffle(_) => "setShuffle",
            Command::SetRepeat(_) => "setRepeat",
            Command::SetLiked(_) => "setLiked",
            Command::SetMuted(_) => "setMuted",
            Command::PlayContext { .. } => "playContext",
            Command::PlayTrack(_) => "playTrack",
            Command::Colors(_) => "colors",
            Command::Lyrics(_) => "lyrics",
            Command::HomeChip(_) => "home",
            Command::Browse(_) => "browse",
            Command::SearchFiltered { .. } => "searchFiltered",
            Command::SearchSuggestions(_) => "searchSuggestions",
            Command::History => "history",
            Command::PlaylistChoices(_) => "playlistChoices",
            Command::Queue => "queue",
            Command::QueueAdd { .. } => "queueAdd",
            Command::QueueRemove(_) => "queueRemove",
            Command::QueueJump(_) => "queueJump",
            Command::StartRadio(_) => "startRadio",
            Command::SetDisliked(_) => "setDisliked",
            Command::Rate { .. } => "rate",
            Command::SetSaved { .. } => "setSaved",
            Command::SetSubscribed { .. } => "setSubscribed",
            Command::AddToPlaylist { .. } => "addToPlaylist",
            Command::CreatePlaylist { .. } => "createPlaylist",
            Command::RemoveFromPlaylist { .. } => "removeFromPlaylist",
        }
    }

    /// Its arguments, as the bridge takes them.
    pub fn args(&self) -> Value {
        match self {
            Command::Search(s)
            | Command::Playlist(s)
            | Command::Album(s)
            | Command::Artist(s)
            | Command::PlayTrack(s)
            | Command::Colors(s)
            | Command::Lyrics(s)
            | Command::HomeChip(s)
            | Command::Browse(s)
            | Command::SearchSuggestions(s)
            | Command::PlaylistChoices(s)
            | Command::QueueRemove(s)
            | Command::QueueJump(s)
            | Command::StartRadio(s) => {
                json!([s])
            }
            Command::PlaylistStart(uri) => json!([uri, true]),
            Command::LikedSongsStart => json!([true]),
            Command::TracksAfter { continuation, offset } => json!([continuation, offset.max(0.0).round()]),
            Command::SearchFiltered { query, filter, continuation } => json!([query, filter, continuation]),
            Command::QueueAdd { uri, next } => json!([uri, next]),
            Command::SetDisliked(on) => json!([on]),
            Command::Rate { uri, rating } => json!([uri, rating]),
            Command::SetSaved { uri, on } | Command::SetSubscribed { uri, on } => json!([uri, on]),
            Command::AddToPlaylist { playlist, track } => json!([playlist, track]),
            Command::CreatePlaylist { name, track } => json!([name, track]),
            Command::RemoveFromPlaylist { playlist, track, set_video_id } => json!([playlist, track, set_video_id]),
            Command::Seek(ms) => json!([ms.max(0.0).round()]),
            Command::SetVolume(v) => json!([v.clamp(0.0, 1.0)]),
            Command::SetShuffle(on) | Command::SetLiked(on) | Command::SetMuted(on) => json!([on]),
            Command::SetRepeat(mode) => json!([mode.as_str()]),
            Command::PlayContext { uri, track_uri } => json!([uri, track_uri]),
            _ => json!([]),
        }
    }

    /// Whether it asks for data (rather than controlling playback). Data may
    /// wait for the player to load; a control fails at once.
    pub fn is_data(&self) -> bool {
        matches!(
            self,
            Command::Home
                | Command::Search(_)
                | Command::Playlist(_)
                | Command::PlaylistStart(_)
                | Command::Album(_)
                | Command::Artist(_)
                | Command::LikedSongs
                | Command::LikedSongsStart
                | Command::TracksAfter { .. }
                | Command::Library
                | Command::Me
                | Command::Colors(_)
                | Command::Lyrics(_)
                | Command::HomeChip(_)
                | Command::Browse(_)
                | Command::SearchFiltered { .. }
                | Command::SearchSuggestions(_)
                | Command::History
                | Command::PlaylistChoices(_)
                | Command::Queue
        )
    }

    /// Which merged control it is, if any.
    pub fn coalesce(&self) -> Option<Coalesce> {
        match self {
            Command::Seek(_) => Some(Coalesce::Seek),
            Command::SetVolume(_) => Some(Coalesce::Volume),
            _ => None,
        }
    }

    /// How long the bridge may take to answer.
    pub fn timeout(&self) -> std::time::Duration {
        std::time::Duration::from_secs(if self.is_data() { 40 } else { 12 })
    }

    /// The expression `Runtime.evaluate` runs: the bridge's call, or a
    /// rejection when the bridge is not installed.
    pub fn expression(&self) -> String {
        format!(
            "(window.__ytmfast ? window.__ytmfast.call({}, {}) : Promise.reject(new Error(\"E_NOT_READY: the player is still loading\")))",
            serde_json::to_string(self.name()).expect("a name is JSON"),
            self.args(),
        )
    }
}

/// The expression that replaces a live page's bridge with `source`: the old
/// one is disposed of and forgotten first, so the new one installs.
pub fn reinstall_expression(source: &str) -> String {
    format!(
        "try {{ window.__ytmfast && window.__ytmfast.dispose && window.__ytmfast.dispose(); }} catch (e) {{}}\ndelete window.__ytmfast;\n{source}"
    )
}

/// The bridge's answer to a call: the value it resolved with (also as the
/// legacy `{ ok, value, error }` envelope, or as JSON text of either).
pub fn decode_answer(value: Value) -> Result<Value, EngineError> {
    let value = match value {
        Value::String(text) => match serde_json::from_str::<Value>(&text) {
            Ok(parsed @ (Value::Object(_) | Value::Array(_))) => parsed,
            _ => Value::String(text),
        },
        other => other,
    };
    if let Value::Object(map) = &value
        && let Some(ok) = map.get("ok").and_then(Value::as_bool)
        && (map.contains_key("value") || map.contains_key("error"))
        && map.len() <= 3
    {
        return if ok {
            Ok(map.get("value").cloned().unwrap_or(Value::Null))
        } else {
            Err(EngineError::parse(map.get("error").and_then(Value::as_str).unwrap_or("the call failed")))
        };
    }
    Ok(value)
}

/// Decodes a data answer into its type, or `E_SHAPE`.
pub fn decode<T: serde::de::DeserializeOwned>(command: &Command, value: Value) -> Result<T, EngineError> {
    serde_json::from_value(value)
        .map_err(|e| EngineError::new(ErrorCode::Shape, format!("{} answered an unknown shape: {e}", command.name())))
}

/// Whether a failed `Runtime.evaluate` failed because the page navigated
/// under it (it is worth one retry in the new page).
pub fn context_lost(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    text.contains("execution context was destroyed")
        || text.contains("cannot find context with specified id")
        || text.contains("inspected target navigated or closed")
        || text.contains("cannot find default execution context")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ytmusic::model::{Collection, Home, Me, SearchResults};

    const STATE: &str = include_str!("fixtures/v1-state.json");
    const STATE_AD: &str = include_str!("fixtures/v1-state-ad.json");

    #[test]
    fn reads_a_recorded_state() {
        let Message::State(state) = parse_message(STATE).unwrap() else { panic!("a state") };
        assert_eq!(state.title, "Airbag");
        assert_eq!(state.artist, "Radiohead");
        assert!(state.playing && state.can_play);
        assert_eq!(state.position_ms, 64_250.0);
        assert_eq!(state.duration_ms, 287_880.0);
        assert_eq!(state.at, 1_762_600_000_123.0);
        assert_eq!(state.repeat, Repeat::Context);
        assert_eq!(state.volume, 0.7);
        assert_eq!(state.premium, Some(false));
        assert_eq!(state.context_href, "ytm:album:MPREb_yXhSI4FCUo6");
    }

    #[test]
    fn reads_an_ad_state_with_unknown_premium() {
        let Message::State(state) = parse_message(STATE_AD).unwrap() else { panic!("a state") };
        assert!(state.ad);
        assert_eq!(state.premium, None);
        assert!(!state.can_next);
        assert_eq!(state.repeat, Repeat::Off);
    }

    #[test]
    fn reads_ready_and_auth() {
        assert_eq!(parse_message(r#"{"v":1,"type":"ready"}"#), Ok(Message::Ready));
        assert_eq!(parse_message(r#"{"v":1,"type":"auth"}"#), Ok(Message::Auth));
    }

    #[test]
    fn refuses_other_versions_and_shapes() {
        assert_eq!(parse_message(r#"{"v":2,"type":"ready"}"#), Err(Unread::Version(Some(2))));
        // The pre-v1 bridge's messages have no version.
        assert_eq!(parse_message(r#"{"type":"player","state":{}}"#), Err(Unread::Version(None)));
        assert!(matches!(parse_message("not json"), Err(Unread::Malformed(_))));
        assert_eq!(parse_message(r#"{"v":1,"type":"lyrics"}"#), Err(Unread::Unknown("lyrics".into())));
        assert!(matches!(
            parse_message(r#"{"v":1,"type":"state","state":{"playing":"yes"}}"#),
            Err(Unread::Shape { .. })
        ));
    }

    #[test]
    fn builds_call_expressions() {
        let call = |c: Command| c.expression();
        assert_eq!(
            call(Command::Seek(1234.4)),
            r#"(window.__ytmfast ? window.__ytmfast.call("seek", [1234.0]) : Promise.reject(new Error("E_NOT_READY: the player is still loading")))"#
        );
        assert!(call(Command::Home).contains(r#".call("home", [])"#));
        assert!(call(Command::Search("a \"b\"".into())).contains(r#".call("search", ["a \"b\""])"#));
        assert!(call(Command::SetVolume(1.5)).contains(r#".call("setVolume", [1.0])"#));
        assert!(call(Command::SetRepeat(Repeat::Track)).contains(r#".call("setRepeat", ["track"])"#));
        assert!(call(Command::SetLiked(true)).contains(r#".call("setLiked", [true])"#));
        assert!(
            call(Command::PlayContext { uri: "ytm:album:a".into(), track_uri: None })
                .contains(r#".call("playContext", ["ytm:album:a",null])"#)
        );
        assert!(
            call(Command::PlayContext { uri: "ytm:album:a".into(), track_uri: Some("ytm:track:t".into()) })
                .contains(r#"["ytm:album:a","ytm:track:t"]"#)
        );
        assert!(call(Command::Playlist("ytm:playlist:p".into())).contains(r#".call("playlist", ["ytm:playlist:p"])"#));
        assert!(call(Command::PlaylistStart("ytm:playlist:p".into())).contains(r#".call("playlist", ["ytm:playlist:p",true])"#));
        assert!(call(Command::LikedSongsStart).contains(r#".call("likedSongs", [true])"#));
        assert!(
            call(Command::TracksAfter { continuation: "T2".into(), offset: 100.0 })
                .contains(r#".call("tracksAfter", ["T2",100.0])"#)
        );
        // A script can't break out of the string.
        assert!(call(Command::PlayTrack("x\"); alert(1); (\"".into())).contains(r#"["x\"); alert(1); (\""]"#));
    }

    #[test]
    fn sorts_commands() {
        assert!(Command::Me.is_data() && !Command::Toggle.is_data());
        assert!(Command::PlaylistStart("p".into()).is_data() && Command::LikedSongsStart.is_data());
        assert!(Command::TracksAfter { continuation: "t".into(), offset: 0.0 }.is_data());
        assert_eq!(Command::Seek(1.0).coalesce(), Some(Coalesce::Seek));
        assert_eq!(Command::SetVolume(1.0).coalesce(), Some(Coalesce::Volume));
        assert_eq!(Command::SetMuted(true).coalesce(), None);
    }

    #[test]
    fn decodes_answers() {
        assert_eq!(decode_answer(json!({"greeting":"Hi"})), Ok(json!({"greeting":"Hi"})));
        assert_eq!(decode_answer(json!(true)), Ok(json!(true)));
        assert_eq!(decode_answer(json!(r#"{"ok":true,"value":{"a":1}}"#)), Ok(json!({"a":1})));
        assert_eq!(decode_answer(json!({"ok":true,"value":null})), Ok(Value::Null));
        assert_eq!(
            decode_answer(json!(r#"{"ok":false,"error":"E_AD: an ad is playing"}"#)),
            Err(EngineError::new(ErrorCode::Ad, "an ad is playing"))
        );
        assert_eq!(decode_answer(json!({"ok":false,"error":"boom"})).unwrap_err().code, ErrorCode::Internal);
        assert_eq!(decode_answer(json!("plain")), Ok(json!("plain")));
    }

    #[test]
    fn decodes_recorded_pages() {
        let home: Home =
            decode(&Command::Home, serde_json::from_str(include_str!("fixtures/home.json")).unwrap()).unwrap();
        assert!(!home.sections.is_empty());
        let album: Collection =
            decode(&Command::Home, serde_json::from_str(include_str!("fixtures/album.json")).unwrap()).unwrap();
        assert_eq!(album.header.name, "OK Computer");
        assert_eq!(album.tracks[0].duration_ms, 288_000.0);
        let search: SearchResults =
            decode(&Command::Home, serde_json::from_str(include_str!("fixtures/search.json")).unwrap()).unwrap();
        assert!(!search.is_empty());
        let me: Me = decode(&Command::Me, json!({"id":"abc","name":"N","username":"u","image":""})).unwrap();
        assert_eq!(me.id, "abc");
        let wrong = decode::<Home>(&Command::Home, json!({"sections": 3})).unwrap_err();
        assert_eq!(wrong.code, ErrorCode::Shape);
        assert!(wrong.message.starts_with("home answered"));
    }

    #[test]
    fn spots_lost_contexts() {
        assert!(context_lost("Execution context was destroyed."));
        assert!(context_lost("Cannot find context with specified id"));
        assert!(!context_lost("E_AD: an ad"));
    }

    #[test]
    fn reinstalls_over_the_old_bridge() {
        let e = reinstall_expression("/*b*/");
        assert!(e.starts_with("try { window.__ytmfast && window.__ytmfast.dispose"));
        assert!(e.contains("delete window.__ytmfast;"));
        assert!(e.ends_with("/*b*/"));
    }
}
