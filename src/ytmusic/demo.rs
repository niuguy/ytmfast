//! A session with no browser, answering from data the bridge recorded from
//! YouTube Music (`cargo run --example probe -- <call>`, signed out): what
//! the tests run on, and what `YTMFAST_DEMO=1` shows (the look of the app
//! without an account).

use std::thread::JoinHandle;

use serde_json::{Value, json};
use tokio::sync::watch;

use super::{
    bridge::Command,
    model::{Player, Repeat, Track},
    session::{Answer, Session, Snapshot},
};

const HOME: &str = include_str!("fixtures/home.json");
const SEARCH: &str = include_str!("fixtures/search.json");
const PLAYLIST: &str = include_str!("fixtures/playlist.json");
const ALBUM: &str = include_str!("fixtures/album.json");
const ARTIST: &str = include_str!("fixtures/artist.json");

fn parse(text: &str) -> Value {
    serde_json::from_str(text).expect("a fixture is JSON")
}

/// Made-up lyrics, timed every four seconds, for any track.
fn demo_lyrics() -> Value {
    const WORDS: [&str; 12] = [
        "♪",
        "Streetlights hum a quiet tune",
        "Paper boats along the river",
        "We were waiting for the noon",
        "♪",
        "Every window holds a summer",
        "Every summer holds a name",
        "Carry me across the harbor",
        "I will never be the same",
        "♪",
        "Streetlights hum a quiet tune",
        "And the night lets us go home",
    ];
    let lines: Vec<Value> = WORDS
        .iter()
        .enumerate()
        .map(|(i, words)| json!({ "startMs": i as f64 * 4000.0, "words": words }))
        .collect();
    json!({ "synced": true, "lines": lines, "provider": "Demo" })
}

/// What the demo's bridge answers to `command`.
pub fn answer(command: &Command) -> Answer {
    match command {
        Command::Home => Ok(parse(HOME)),
        Command::Search(term) => {
            let term = term.trim().to_lowercase();
            if term.is_empty() || term == "nothing at all" {
                Ok(json!({ "tracks": [], "artists": [], "albums": [], "playlists": [] }))
            } else {
                Ok(parse(SEARCH))
            }
        }
        Command::Me => Ok(json!({ "id": "demo", "name": "Demo Listener", "username": "demo", "image": "" })),
        Command::Colors(_) => Ok(json!({ "hex": "", "palette": [] })),
        Command::Lyrics(_) => Ok(demo_lyrics()),
        Command::Library => {
            let home = parse(HOME);
            let mut items = vec![json!({
                "uri": "ytm:collection:LM", "kind": "collection", "name": "Liked Music",
                "subtitle": "12 songs", "image": ""
            })];
            for section in home["sections"].as_array().into_iter().flatten() {
                for item in section["items"].as_array().into_iter().flatten() {
                    if matches!(item["kind"].as_str(), Some("playlist" | "album" | "artist")) && items.len() < 14 {
                        items.push(item.clone());
                    }
                }
            }
            Ok(json!({ "items": items }))
        }
        Command::Playlist(_) => Ok(parse(PLAYLIST)),
        Command::Album(_) => Ok(parse(ALBUM)),
        Command::Artist(_) => Ok(parse(ARTIST)),
        Command::LikedSongs => {
            let mut album = parse(ALBUM);
            album["header"] = json!({
                "uri": "ytm:collection:LM", "kind": "collection", "name": "Liked Music",
                "subtitle": "12 songs", "image": "", "description": ""
            });
            Ok(album)
        }
        _ => Ok(Value::Null),
    }
}

/// What a control does to the demo's player; true when it changed it.
pub fn control(player: &mut Player, command: &Command) -> bool {
    let before = player.clone();
    match command {
        Command::Toggle => player.playing = !player.playing,
        Command::Play => player.playing = true,
        Command::Pause => player.playing = false,
        Command::Seek(ms) => player.position_ms = ms.clamp(0.0, player.duration_ms),
        Command::SetVolume(v) => player.volume = v.clamp(0.0, 1.0),
        Command::SetShuffle(on) => player.shuffle = *on,
        Command::SetRepeat(mode) => player.repeat = *mode,
        Command::SetLiked(on) => player.liked = *on,
        Command::SetMuted(on) => player.muted = *on,
        Command::PlayContext { .. } | Command::PlayTrack(_) => player.playing = true,
        _ => {}
    }
    if *player != before {
        player.at = now_ms();
        true
    } else {
        false
    }
}

fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// The demo's player: the first track of the recorded album, paused.
pub fn player() -> Player {
    let album: Value = parse(ALBUM);
    let track: Track = serde_json::from_value(album["tracks"][0].clone()).unwrap_or_default();
    Player {
        title: track.name,
        artist: track.artists,
        album: track.album,
        artwork: track.image,
        track_uri: track.uri,
        context_href: "ytm:album:MPREb_yXhSI4FCUo6".into(),
        playing: false,
        can_play: true,
        position_ms: 64_000.0,
        duration_ms: track.duration_ms,
        at: now_ms(),
        shuffle_available: true,
        repeat: Repeat::Off,
        volume: 0.7,
        can_next: true,
        can_previous: true,
        premium: Some(false),
        ..Player::default()
    }
}

/// A session on the demo's data.
pub fn session() -> (Session, watch::Receiver<Snapshot>, JoinHandle<()>) {
    Session::fake(answer, control, player())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ytmusic::{
        bridge::decode,
        model::{Collection, Home, Library, Me, SearchResults},
    };

    #[test]
    fn every_answer_has_its_type() {
        let home: Home = decode(&Command::Home, answer(&Command::Home).unwrap()).unwrap();
        assert!(!home.sections.is_empty());
        let found: SearchResults =
            decode(&Command::Home, answer(&Command::Search("radiohead".into())).unwrap()).unwrap();
        assert!(!found.is_empty());
        let none: SearchResults =
            decode(&Command::Home, answer(&Command::Search("nothing at all".into())).unwrap()).unwrap();
        assert!(none.is_empty());
        let me: Me = decode(&Command::Me, answer(&Command::Me).unwrap()).unwrap();
        assert_eq!(me.id, "demo");
        let library: Library = decode(&Command::Library, answer(&Command::Library).unwrap()).unwrap();
        assert!(library.items.len() > 1 && library.items[0].opens());
        for c in [
            Command::Playlist("p".into()),
            Command::Album("a".into()),
            Command::Artist("a".into()),
            Command::LikedSongs,
        ] {
            let page: Collection = decode(&c, answer(&c).unwrap()).unwrap();
            assert!(!page.tracks.is_empty(), "{c:?}");
        }
    }

    #[test]
    fn controls_set_the_target_state() {
        let mut p = player();
        assert!(control(&mut p, &Command::SetLiked(true)));
        assert!(!control(&mut p, &Command::SetLiked(true)), "idempotent");
        assert!(control(&mut p, &Command::SetVolume(2.0)));
        assert_eq!(p.volume, 1.0);
        assert!(control(&mut p, &Command::Seek(1e12)));
        assert_eq!(p.position_ms, p.duration_ms);
        assert!(!control(&mut p, &Command::Next));
    }
}
