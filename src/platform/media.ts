// Media keys and the system's Now Playing: MPRIS on Linux (Waybar's mpris
// module, GNOME, KDE, `playerctl`), the media overlay and keys on Windows
// (SMTC), Control Center and the keyboard's media keys on macOS. Rust
// (`MediaControls`, src/media.rs) talks to the system; this file mirrors
// the player into it and sends the system's commands to the player.
//
// Wiring (App.tsx, in the root component's body, which runs once):
//
//   installMediaControls({
//     player: () => store.player(),
//     toggle: store.toggle,
//     play: () => { if (!store.player().playing) store.toggle(); },
//     pause: () => { if (store.player().playing) store.toggle(); },
//     next: () => store.control("next", () => store.spotify.next()),
//     previous: () => store.control("previous", () => store.spotify.previous()),
//     seek: store.seek,
//     raise: shell.showWindow, // installDesktopShell's handle
//   });
//
// Off the desktops it does nothing. On Windows the controls start once the
// app's window exists (SMTC needs one).

import { cleanup, effect } from "nsh";
import { MediaControls } from "ytmfast/native";

/** What the media controls read from the player (store.player() fits). */
export interface MediaPlayerView {
  title: string;
  artist: string;
  album: string;
  /** The cover art URL. */
  artwork: string;
  durationMs: number;
  playing: boolean;
  positionMs: number;
}

/** The player, as the media controls see and drive it. */
export interface MediaControlsOptions {
  /** The player's state (reactive). */
  player: () => MediaPlayerView;
  toggle(): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  /** Goes to `ms` in the track. */
  seek(ms: number): void;
  /** Shows the app's window (MPRIS Raise: a click on the bar's player). */
  raise?(): void;
}

/** A position jump this large (ms) from where playback should be is a seek
 * the system must hear about; smaller drifts it extrapolates itself. */
const JUMP_MS = 2500;

/** Whether the system needs a new position: playback started or stopped,
 * or the position jumped from where it would be by now. */
export function needsPlaybackUpdate(
  last: { playing: boolean; positionMs: number; at: number } | null,
  now: { playing: boolean; positionMs: number; at: number },
): boolean {
  if (!last || last.playing !== now.playing) return true;
  const expected = last.positionMs + (last.playing ? now.at - last.at : 0);
  return Math.abs(now.positionMs - expected) > JUMP_MS;
}

/**
 * Connects the player to the system's media controls until the calling
 * component goes. Returns whether this platform has them.
 */
export function installMediaControls(opts: MediaControlsOptions): boolean {
  let controls: MediaControls;
  try {
    controls = new MediaControls();
  } catch (error) {
    console.warn("media controls: unavailable:", error);
    return false;
  }

  // Metadata: only when the track changes, not on every position tick.
  let metaKey = "";
  effect(() => {
    const p = opts.player();
    const key = [p.title, p.artist, p.album, p.artwork, p.durationMs].join("\u0000");
    if (key === metaKey) return;
    metaKey = key;
    controls.setMetadata({
      title: p.title || null,
      artist: p.artist || null,
      album: p.album || null,
      artworkUrl: p.artwork || null,
      durationMs: p.durationMs > 0 ? p.durationMs : null,
    });
  });

  // Playback: on play/pause and on seeks; the system extrapolates between.
  let last: { playing: boolean; positionMs: number; at: number } | null = null;
  effect(() => {
    const p = opts.player();
    const now = { playing: p.playing, positionMs: p.positionMs, at: Date.now() };
    if (!needsPlaybackUpdate(last, now)) return;
    last = now;
    controls.setPlayback({ playing: p.playing, positionMs: p.positionMs >= 0 ? p.positionMs : null });
  });

  const stop = controls.onCommand((command, value) => {
    switch (command) {
      case "play": return opts.play();
      case "pause": return opts.pause();
      case "toggle": return opts.toggle();
      case "next": return opts.next();
      case "previous": return opts.previous();
      case "seek": return value != null ? opts.seek(value) : undefined;
      case "raise": return opts.raise?.();
      default: return undefined;
    }
  });
  controls.run().catch((error: unknown) => console.warn("media controls: stopped:", error));

  cleanup(() => {
    stop();
    try {
      controls.dispose();
    } catch {
      // Already gone.
    }
  });
  return controls.available;
}
