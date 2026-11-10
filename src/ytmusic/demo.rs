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
const EXPLORE: &str = include_str!("fixtures/explore.json");

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
        Command::HomeChip(params) => {
            let mut home = parse(HOME);
            for chip in home["chips"].as_array_mut().into_iter().flatten() {
                chip["selected"] = json!(chip["params"].as_str() == Some(params.as_str()));
            }
            Ok(home)
        }
        Command::Browse(uri) => {
            let mut page = parse(EXPLORE);
            if uri != "ytm:page:FEmusic_explore" {
                // Any other page: Explore's rows under the name of the button
                // that opened it.
                let name = page["sections"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .flat_map(|s| s["items"].as_array().cloned().unwrap_or_default())
                    .find(|i| i["uri"].as_str() == Some(uri.as_str()))
                    .and_then(|i| i["name"].as_str().map(str::to_owned))
                    .unwrap_or_else(|| "Explore".into());
                page["title"] = json!(name);
            }
            Ok(page)
        }
        Command::SearchFiltered { query, filter, .. } => {
            let found = parse(SEARCH);
            let none = query.trim().is_empty() || query.trim().eq_ignore_ascii_case("nothing at all");
            let (tracks, items) = match filter.as_str() {
                _ if none => (json!([]), json!([])),
                "songs" | "videos" => (found["tracks"].clone(), json!([])),
                "albums" => (json!([]), found["albums"].clone()),
                "artists" => (json!([]), found["artists"].clone()),
                _ => (json!([]), found["playlists"].clone()),
            };
            Ok(json!({ "tracks": tracks, "items": items, "continuation": "" }))
        }
        Command::SearchSuggestions(query) => {
            let q = query.trim();
            Ok(if q.is_empty() { json!([]) } else { json!([q, format!("{q} live"), format!("{q} acoustic")]) })
        }
        Command::History => {
            let mut album = parse(ALBUM);
            album["header"] = json!({
                "uri": "ytm:history:all", "kind": "history", "name": "History",
                "subtitle": "", "image": "", "description": "", "saved": null, "editable": false, "subscribed": null
            });
            Ok(album)
        }
        Command::PlaylistChoices(_) => Ok(json!([
            { "uri": "ytm:playlist:demo-road", "name": "Road trip", "subtitle": "12 tracks" },
            { "uri": "ytm:playlist:demo-focus", "name": "Focus", "subtitle": "30 tracks" },
        ])),
        Command::Queue | Command::QueueAdd { .. } | Command::QueueRemove(_) | Command::QueueJump(_) => Ok(demo_queue()),
        Command::CreatePlaylist { .. } => Ok(json!("ytm:playlist:demo-new")),
        Command::LikedSongs => {
            let mut album = parse(ALBUM);
            album["header"] = json!({
                "uri": "ytm:collection:LM", "kind": "collection", "name": "Liked Music",
                "subtitle": "12 songs", "image": "", "description": "", "saved": null, "editable": false, "subscribed": null
            });
            Ok(album)
        }
        _ => Ok(Value::Null),
    }
}

/// The demo's queue: the recorded album, its first song playing.
fn demo_queue() -> Value {
    let album = parse(ALBUM);
    let items: Vec<Value> = album["tracks"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(i, t)| {
            json!({
                "id": i.to_string(), "uri": t["uri"], "name": t["name"], "artists": t["artists"],
                "image": t["image"], "durationMs": t["durationMs"], "current": i == 0
            })
        })
        .collect();
    json!({ "items": items, "current": 0, "autoplay": [] })
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
        Command::SetDisliked(on) => player.disliked = *on,
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
        model::{Collection, Home, Library, Me, Page, PlaylistChoice, Queue, SearchPage, SearchResults},
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
        assert!(!home.chips.is_empty());
        let chip = home.chips[1].params.clone();
        let filtered: Home = decode(&Command::Home, answer(&Command::HomeChip(chip)).unwrap()).unwrap();
        assert!(filtered.chips[1].selected && !filtered.chips[0].selected);
        let explore: Page = decode(&Command::Home, answer(&Command::Browse("ytm:page:FEmusic_explore".into())).unwrap()).unwrap();
        assert_eq!(explore.title, "Explore");
        assert!(explore.sections.iter().any(|s| s.kind == "buttons"));
        let mood = explore.sections.iter().find(|s| s.kind == "buttons" && !s.title.is_empty()).unwrap().items[0].clone();
        let page: Page = decode(&Command::Home, answer(&Command::Browse(mood.uri.clone())).unwrap()).unwrap();
        assert_eq!(page.title, mood.name);
        let songs: SearchPage = decode(
            &Command::Home,
            answer(&Command::SearchFiltered { query: "radiohead".into(), filter: "songs".into(), continuation: None }).unwrap(),
        )
        .unwrap();
        assert!(!songs.tracks.is_empty() && songs.items.is_empty());
        let history: Collection = decode(&Command::History, answer(&Command::History).unwrap()).unwrap();
        assert_eq!(history.header.kind, "history");
        let choices: Vec<PlaylistChoice> =
            decode(&Command::Home, answer(&Command::PlaylistChoices("ytm:track:x".into())).unwrap()).unwrap();
        assert_eq!(choices.len(), 2);
        let queue: Queue = decode(&Command::Queue, answer(&Command::Queue).unwrap()).unwrap();
        assert_eq!(queue.current, 0.0);
        assert!(queue.items[0].current);
        let made: String = decode(&Command::Home, answer(&Command::CreatePlaylist { name: "x".into(), track: None }).unwrap()).unwrap();
        assert!(made.starts_with("ytm:playlist:"));
        let suggested: Vec<String> = decode(&Command::Home, answer(&Command::SearchSuggestions("kites".into())).unwrap()).unwrap();
        assert_eq!(suggested[0], "kites");
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
