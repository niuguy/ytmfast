// The one contract between the UI and whatever plays the music: the native
// engine (`EngineBackend`, desktops and the terminal) or the demo
// (`DemoBackend`, the web, phones and tests). Pages never see either; they go
// through the stores in `src/state`, which hold one `Backend`.

import type { Accessor } from "nsh";

// ---- The player and the session ----------------------------------------

/** How playback repeats. */
export type RepeatMode = "off" | "context" | "track";

/** Where the session is. */
export type HealthStatus = "starting" | "ready" | "signingIn" | "failed";

/** A failure the backend reports: a stable `code` to branch on, a `message`
 * for logs (never shown to the user as it is). */
export interface BackendError {
  code: string;
  message: string;
}

/** The session's state. */
export interface Health {
  status: HealthStatus;
  /** Why it failed, while `status` is `"failed"`. */
  error: BackendError | null;
}

/** The player's state: one object per change. */
export interface PlayerState {
  /** The track's (or the ad's) title; empty when nothing is loaded. */
  title: string;
  artist: string;
  album: string;
  /** The track's (or the ad's) artwork URL. */
  artwork: string;
  /** `spotify:track:…`. */
  trackUri: string;
  /** What plays: `spotify:playlist:…`, `spotify:album:…`,
   * `spotify:collection:tracks`; empty when unknown. */
  contextUri: string;
  playing: boolean;
  /** The position when the state was sampled. */
  positionMs: number;
  durationMs: number;
  /** When the state was sampled (epoch ms): the UI moves the position on
   * from here while playing. */
  at: number;
  shuffle: boolean;
  shuffleAvailable: boolean;
  repeat: RepeatMode;
  /** 0 to 1. */
  volume: number;
  muted: boolean;
  liked: boolean;
  canNext: boolean;
  canPrevious: boolean;
  /** An ad is playing: `title` and `artwork` are the ad's. */
  ad: boolean;
  /** Whether the account is Premium; null while unknown or signed out. */
  premium: boolean | null;
}

/** The state before the backend reports any. */
export const EMPTY_PLAYER: PlayerState = {
  title: "",
  artist: "",
  album: "",
  artwork: "",
  trackUri: "",
  contextUri: "",
  playing: false,
  positionMs: 0,
  durationMs: 0,
  at: 0,
  shuffle: false,
  shuffleAvailable: false,
  repeat: "off",
  volume: 1,
  muted: false,
  liked: false,
  canNext: false,
  canPrevious: false,
  ad: false,
  premium: null,
};

// ---- Data ----------------------------------------------------------------

/** What an item is. */
export type ItemKind = "playlist" | "album" | "artist" | "show" | "collection" | "track";

/** A playlist, album, artist, show, Liked Songs or a track shown as a card. */
export interface Item {
  uri: string;
  kind: ItemKind | string;
  name: string;
  subtitle: string;
  image: string;
}

/** A track in a list. */
export interface Track {
  uri: string;
  uid: string;
  name: string;
  artists: string;
  album: string;
  albumUri: string;
  image: string;
  durationMs: number;
  explicit: boolean;
  playable: boolean;
}

/** The header of a collection's page. */
export interface CollectionHeader {
  uri: string;
  kind: ItemKind | string;
  name: string;
  subtitle: string;
  image: string;
  description: string;
}

/** A playlist, album, artist or Liked Songs: header, tracks and (an
 * artist's) releases. */
export interface Collection {
  header: CollectionHeader;
  tracks: Track[];
  releases: Item[];
  total: number;
}

/** A titled row of cards. */
export interface Section {
  title: string;
  items: Item[];
}

export interface Home {
  greeting: string;
  sections: Section[];
}

export interface SearchResults {
  tracks: Track[];
  artists: Item[];
  albums: Item[];
  playlists: Item[];
}

export interface Library {
  items: Item[];
}

/** The signed-in user. */
export interface Me {
  /** The account's stable id (keys its cache). */
  id: string;
  name: string;
  image: string;
}

/** One line of lyrics. */
export interface LyricLine {
  /** When it starts, ms into the track (0 when the lyrics are not timed). */
  startMs: number;
  /** Its words ("♪" for an instrumental break). */
  words: string;
}

/** A track's lyrics: no lines when there are none. */
export interface Lyrics {
  /** Whether each line has its time (else they are plain words). */
  synced: boolean;
  lines: LyricLine[];
  /** Who provides them, shown under them; may be empty. */
  provider: string;
}

/** The line of `lyrics` sung at `ms`: the last that started by then, or -1
 * before the first (and always for plain words). */
export function lineAt(lyrics: Lyrics, ms: number): number {
  if (!lyrics.synced) return -1;
  let lo = 0;
  let hi = lyrics.lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyrics.lines[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// ---- The contract --------------------------------------------------------

/** What plays the music. Every method that does something returns a
 * promise that rejects with an `Error` whose message is `"E_CODE: text"`
 * (`errorOf` parses it). */
export interface Backend {
  /** Which implementation this is. */
  readonly kind: "engine" | "demo";

  // State, reactive.
  readonly player: Accessor<PlayerState>;
  readonly health: Accessor<Health>;
  /** Whether an account is signed in; null while unknown. */
  readonly signedIn: Accessor<boolean | null>;
  /** Calls `listener` when the session gets a new token (data that failed
   * may load now). Returns a function that stops listening. */
  onAuth(listener: () => void): () => void;

  // Data.
  home(): Promise<Home>;
  search(query: string): Promise<SearchResults>;
  playlist(uri: string): Promise<Collection>;
  album(uri: string): Promise<Collection>;
  artist(uri: string): Promise<Collection>;
  likedSongs(): Promise<Collection>;
  library(): Promise<Library>;
  me(): Promise<Me>;
  /** A cover image's colours (`#rrggbb`), most telling first; empty when
   * unknown. */
  coverColors(imageUrl: string): Promise<string[]>;
  /** A track's lyrics by URI (no lines when it has none). */
  lyrics(trackUri: string): Promise<Lyrics>;

  // Controls: each sets a target state.
  toggle(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  setShuffle(on: boolean): Promise<void>;
  setRepeat(mode: RepeatMode): Promise<void>;
  setLiked(on: boolean): Promise<void>;
  setMuted(on: boolean): Promise<void>;
  /** Plays a collection, from `trackUri` when given. */
  playContext(uri: string, trackUri: string | null): Promise<void>;
  /** Plays one track (its radio follows). */
  playTrack(uri: string): Promise<void>;

  // The account and the session.
  signIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Starts the session again after it failed. */
  retry(): Promise<void>;
  /** Hands the engine the bridge script shipped with the TSX bundle. */
  setBridge(source: string): void;

  /** Stops listening to the engine (a hot update replaces this object). */
  dispose(): void;
}

/** The `{ code, message }` of a rejection (`"E_CODE: text"`); `E_UNKNOWN`
 * for anything else. */
export function errorOf(error: unknown): BackendError {
  const text = error instanceof Error ? error.message : String(error);
  const match = /^(E_[A-Z0-9_]+):\s*([\s\S]*)$/.exec(text);
  if (match) return { code: match[1], message: match[2] };
  return { code: "E_UNKNOWN", message: text };
}

/** An `Error` in the backend's form, for implementations to reject with. */
export function backendError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

// ---- Helpers on the models -----------------------------------------------

/** What a `spotify:<kind>:<id>` URI names. */
export function kindOf(uri: string): string {
  return uri.split(":")[1] ?? "";
}

/** Whether an item has a page (a track has none: it plays). */
export function opens(item: Item): boolean {
  return item.kind === "playlist" || item.kind === "album" || item.kind === "artist" || item.kind === "collection";
}

/** Where `p` is at the time `t`: moved on from when it was sampled while it
 * plays, never past its end. */
export function positionAt(p: PlayerState, t: number): number {
  const elapsed = p.playing ? Math.max(0, t - p.at) : 0;
  const position = p.positionMs + elapsed;
  return p.durationMs > 0 ? Math.min(position, p.durationMs) : position;
}

/** `m:ss` (or `h:mm:ss`) of a duration in milliseconds. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds / 60) % 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
