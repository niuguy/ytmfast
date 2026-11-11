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
  /** `ytm:track:…`. */
  trackUri: string;
  /** What plays: `ytm:playlist:…`, `ytm:album:…`,
   * `ytm:collection:LM`; empty when unknown. */
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
  /** The song is disliked (thumbs down). */
  disliked: boolean;
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
  disliked: false,
  canNext: false,
  canPrevious: false,
  ad: false,
  premium: null,
};

// ---- Data ----------------------------------------------------------------

/** What an item is: a page of its own (playlist, album, artist, Liked
 * Music, a browse page such as a mood, History), or something that plays
 * (a track, a mix). */
export type ItemKind = "playlist" | "album" | "artist" | "collection" | "page" | "history" | "track" | "mix";

/** A playlist, album, artist, Liked Music, a browse page, a mix or a track
 * shown as a card (or, for a page, a button). */
export interface Item {
  uri: string;
  kind: ItemKind | string;
  name: string;
  subtitle: string;
  image: string;
  /** A page's colour (`#rrggbb`: a mood or genre's stripe), if any. */
  color?: string;
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
  /** Saved in the library; null (or absent) when it cannot be saved. */
  saved?: boolean | null;
  /** A playlist of the account's own: its songs can be taken out. */
  editable?: boolean;
  /** The account subscribes to the artist; null (or absent) for the rest. */
  subscribed?: boolean | null;
}

/** A playlist, album, artist or Liked Songs: header, tracks and (an
 * artist's) releases. */
export interface Collection {
  header: CollectionHeader;
  tracks: Track[];
  releases: Item[];
  total: number;
  /** Where the rest of a long playlist's tracks start (`tracksAfter`), when
   * only its first page was asked for; "" (or absent) otherwise. */
  continuation?: string;
}

/** The next page of a long playlist's tracks, and where the one after
 * starts ("" at the end). */
export interface TrackPage {
  tracks: Track[];
  continuation: string;
}

/** A titled row: covers (`cards`), or pages to open (`buttons`, drawn as
 * chips; the title may be empty). */
export interface Section {
  title: string;
  kind?: "cards" | "buttons" | string;
  items: Item[];
}

/** One of Home's filters ("Relax", "Workout"). */
export interface Chip {
  title: string;
  /** What Home is asked with to show it. */
  params: string;
  selected: boolean;
}

export interface Home {
  greeting: string;
  sections: Section[];
  /** Its filters; none where there are none. */
  chips?: Chip[];
}

/** A browse page: Explore, charts, new releases, moods and genres, a mood. */
export interface Page {
  title: string;
  sections: Section[];
}

/** What a search can be narrowed to. */
export type SearchFilter = "songs" | "videos" | "albums" | "artists" | "playlists";

/** One page of a narrowed search: tracks (songs, videos) or items (the
 * rest), and where the next page starts ("" at the end). */
export interface SearchPage {
  tracks: Track[];
  items: Item[];
  continuation: string;
}

/** One entry of the play queue. */
export interface QueueItem {
  /** The entry's id (it removes the entry, or plays it). */
  id: string;
  /** The song. */
  uri: string;
  name: string;
  artists: string;
  image: string;
  durationMs: number;
  /** It is the one playing. */
  current: boolean;
}

/** The play queue. */
export interface Queue {
  items: QueueItem[];
  /** The index of the one playing, or -1. */
  current: number;
  /** What autoplay plays after the queue. */
  autoplay: QueueItem[];
}

/** A playlist of the account's that a song can be added to. */
export interface PlaylistChoice {
  uri: string;
  name: string;
  subtitle: string;
}

/** A song's rating. */
export type Rating = "like" | "dislike" | "none";

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
  /** A playlist; with `firstPage`, only as many tracks as come at once,
   * with the `continuation` the rest follow from (`tracksAfter`). A backend
   * that cannot page answers with every track and no continuation. */
  playlist(uri: string, firstPage?: boolean): Promise<Collection>;
  album(uri: string): Promise<Collection>;
  artist(uri: string): Promise<Collection>;
  /** Liked Songs (signed in); `firstPage` as for `playlist`. */
  likedSongs(firstPage?: boolean): Promise<Collection>;
  /** The tracks of a long playlist after `continuation`, numbered from
   * `offset` (the number of tracks before them). */
  tracksAfter(continuation: string, offset: number): Promise<TrackPage>;
  library(): Promise<Library>;
  me(): Promise<Me>;
  /** A cover image's colours (`#rrggbb`), most telling first; empty when
   * unknown. */
  coverColors(imageUrl: string): Promise<string[]>;
  /** A track's lyrics by URI (no lines when it has none). */
  lyrics(trackUri: string): Promise<Lyrics>;
  /** Home filtered by one of its chips (`params`; none or "" is Home). */
  homeWith(params: string): Promise<Home>;
  /** A browse page (`ytm:page:…`). */
  browse(uri: string): Promise<Page>;
  /** One page of a search narrowed to `filter`, or the page after
   * `continuation`. */
  searchFiltered(query: string, filter: SearchFilter, continuation: string | null): Promise<SearchPage>;
  /** What to suggest for a query being typed. */
  searchSuggestions(query: string): Promise<string[]>;
  /** What the account played, newest first (signed in). */
  history(): Promise<Collection>;
  /** The account's playlists `trackUri` can be added to (signed in). */
  playlistChoices(trackUri: string): Promise<PlaylistChoice[]>;
  /** The play queue. */
  queue(): Promise<Queue>;

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
  /** Puts a song, album, playlist or mix in the queue: after the one
   * playing (`next`), or at its end. Answers the queue. */
  queueAdd(uri: string, next: boolean): Promise<Queue>;
  /** Takes the queue's entry `id` out of it. Answers the queue. */
  queueRemove(id: string): Promise<Queue>;
  /** Plays the queue's entry `id`. Answers the queue. */
  queueJump(id: string): Promise<Queue>;
  /** Plays the radio of a song, album, playlist or artist. */
  startRadio(uri: string): Promise<void>;
  /** Dislikes the song playing, or takes the dislike back. */
  setDisliked(on: boolean): Promise<void>;
  /** Rates any song. */
  rate(trackUri: string, rating: Rating): Promise<void>;
  /** Saves an album or playlist to the library, or takes it out. */
  setSaved(uri: string, on: boolean): Promise<void>;
  /** Subscribes to an artist, or unsubscribes. */
  setSubscribed(artistUri: string, on: boolean): Promise<void>;
  /** Adds a song to one of the account's playlists. */
  addToPlaylist(playlistUri: string, trackUri: string): Promise<void>;
  /** Makes a private playlist, with `trackUri` in it when given; answers
   * its URI. */
  createPlaylist(name: string, trackUri: string | null): Promise<string>;
  /** Takes a song's row (its `uid`) out of one of the account's playlists. */
  removeFromPlaylist(playlistUri: string, trackUri: string, uid: string): Promise<void>;

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

/** What a `ytm:<kind>:<id>` URI names. */
export function kindOf(uri: string): string {
  return uri.split(":")[1] ?? "";
}

/** Whether an item has a page (a track has none: it plays). */
export function opens(item: Item): boolean {
  return ["playlist", "album", "artist", "collection", "page", "history"].includes(item.kind);
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
