//! Runs the engine against the real YouTube Music, with no UI, and prints
//! what the bridge answers: a check that the bridge still reads the web
//! player, and a tool for mending it when the page changes.
//!
//! ```sh
//! cargo run --example probe                      # home, search, a playlist, album and artist
//! cargo run --example probe -- search "kites"    # one call: name, then its arguments
//! cargo run --example probe -- play ytm:track:<videoId>
//! PROBE_WATCH=40 cargo run --example probe -- context ytm:album:<id> ytm:track:<videoId>
//! ```
//!
//! It uses its own browser profile under `target/agents/probe` (signed
//! out, unless you sign in there), so it never touches the app's.
//! `YTMFAST_BROWSER` picks the browser, as in the app.

use std::time::{Duration, Instant};

use nsh_app_ytmfast::ytmusic::{HealthStatus, Session, bridge::Command, paths::Paths};
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let data = std::env::current_dir().expect("a working directory").join("target/agents/probe");
    let (session, state, _thread) = Session::start(Paths::at(data));

    let started = Instant::now();
    loop {
        let health = state.borrow().health.clone();
        match health.status {
            HealthStatus::Ready => break,
            HealthStatus::Failed => {
                eprintln!("failed: {:?}", health.error);
                if started.elapsed() > Duration::from_secs(60) {
                    std::process::exit(1);
                }
            }
            _ => {}
        }
        if started.elapsed() > Duration::from_secs(90) {
            eprintln!("the player did not get ready in 90 s");
            std::process::exit(1);
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    eprintln!("ready in {:.1} s; signed in: {:?}", started.elapsed().as_secs_f32(), state.borrow().signed_in);

    let ask = |command: Command| -> Option<Value> {
        let name = command.name();
        let at = Instant::now();
        match session.command(command).blocking_recv() {
            Ok(Ok(value)) => {
                eprintln!("{name}: ok in {} ms", at.elapsed().as_millis());
                Some(value)
            }
            Ok(Err(e)) => {
                eprintln!("{name}: {e}");
                None
            }
            Err(_) => {
                eprintln!("{name}: the engine dropped the call");
                None
            }
        }
    };

    if let Some(name) = args.first() {
        let arg = args.get(1).cloned().unwrap_or_default();
        let command = match name.as_str() {
            "home" => Command::Home,
            "search" => Command::Search(arg),
            "playlist" => Command::Playlist(arg),
            "album" => Command::Album(arg),
            "artist" => Command::Artist(arg),
            "liked" => Command::LikedSongs,
            "library" => Command::Library,
            "me" => Command::Me,
            "lyrics" => Command::Lyrics(arg),
            "colors" => Command::Colors(arg),
            "play" => Command::PlayTrack(arg),
            "context" => Command::PlayContext { uri: arg, track_uri: args.get(2).cloned() },
            other => {
                eprintln!("unknown call {other}");
                std::process::exit(2);
            }
        };
        let playing = matches!(command, Command::PlayTrack(_) | Command::PlayContext { .. });
        if let Some(value) = ask(command) {
            println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
        }
        if playing {
            // `PROBE_WATCH` seconds of the player's state (8 by default).
            let watch: u32 = std::env::var("PROBE_WATCH").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
            for _ in 0..watch {
                std::thread::sleep(Duration::from_secs(1));
                let p = state.borrow().player.clone();
                eprintln!(
                    "{} — {} [{}] {}/{} ms playing={} ad={} context={}",
                    p.title, p.artist, p.track_uri, p.position_ms, p.duration_ms, p.playing, p.ad, p.context_href
                );
            }
        }
    } else {
        summary(&ask);
    }
    session.shutdown(Duration::from_secs(8));
}

/// Home, then a search, and the first playlist, album and artist it finds.
fn summary(ask: &dyn Fn(Command) -> Option<Value>) {
    let count = |v: &Value, key: &str| v[key].as_array().map_or(0, Vec::len);
    if let Some(home) = ask(Command::Home) {
        println!("home: {:?}", home["greeting"]);
        for s in home["sections"].as_array().into_iter().flatten() {
            let kinds: Vec<&str> = s["items"].as_array().into_iter().flatten().filter_map(|i| i["kind"].as_str()).collect();
            println!("  {} ({}): {:?}", s["title"].as_str().unwrap_or(""), kinds.len(), kinds.iter().take(6).collect::<Vec<_>>());
        }
    }
    let Some(found) = ask(Command::Search("radiohead".into())) else { return };
    println!(
        "search: {} tracks, {} artists, {} albums, {} playlists",
        count(&found, "tracks"),
        count(&found, "artists"),
        count(&found, "albums"),
        count(&found, "playlists")
    );
    if let Some(t) = found["tracks"].get(0) {
        println!("  first track: {}", t);
    }
    let first = |key: &str| found[key].get(0).and_then(|i| i["uri"].as_str()).map(str::to_owned);
    let show = |what: &str, v: Option<Value>| {
        if let Some(v) = v {
            println!("{what}: {} — {} ({} tracks of {}, {} releases)", v["header"]["name"], v["header"]["subtitle"], count(&v, "tracks"), v["total"], count(&v, "releases"));
            if let Some(t) = v["tracks"].get(0) {
                println!("  first: {t}");
            }
        }
    };
    if let Some(uri) = first("albums") {
        show("album", ask(Command::Album(uri)));
    }
    if let Some(uri) = first("artists") {
        show("artist", ask(Command::Artist(uri)));
    }
    if let Some(uri) = first("playlists").filter(|u| u.starts_with("ytm:playlist:")) {
        show("playlist", ask(Command::Playlist(uri)));
    }
    if let Some(uri) = found["tracks"].get(0).and_then(|t| t["uri"].as_str()) {
        if let Some(l) = ask(Command::Lyrics(uri.to_owned())) {
            println!("lyrics: {} lines from {:?}", count(&l, "lines"), l["provider"]);
        }
    }
}
