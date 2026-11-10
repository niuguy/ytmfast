// `EngineBackend`: the `Backend` over the native engine (`ytmfast/native`'s
// `Spotify` class). This is the only file that calls the engine, so a change
// to the engine's API changes only this file.
//
// `new Spotify()` is a cheap handle onto the one engine of the process (Rust
// starts it the first time), so a hot update of the TSX never starts a
// second Chromium. Each `EngineBackend` owns one handle; the previous one is
// disposed when a hot update makes a new one.

import { type Accessor, signal } from "nsh";
import { Spotify, type Health as NativeHealth, type Player as NativePlayer } from "ytmfast/native";
import {
  type Backend,
  backendError,
  type Collection,
  EMPTY_PLAYER,
  errorOf,
  type Health,
  type Home,
  type Library,
  type Lyrics,
  type Me,
  type PlayerState,
  type RepeatMode,
  type SearchResults,
} from "./types";

const SLOT_KEY = "__ytmfastEngine";

/** The engine backend. The one a previous version of the TSX made (a hot
 * update) stops listening first. */
export function engineBackend(): EngineBackend {
  const g = globalThis as unknown as Record<string, EngineBackend | undefined>;
  g[SLOT_KEY]?.dispose();
  const backend = new EngineBackend(new Spotify());
  g[SLOT_KEY] = backend;
  return backend;
}

function health(native: NativeHealth | null | undefined): Health {
  return {
    status: native?.status ?? "starting",
    error: native?.error ? { code: native.error.code, message: native.error.message } : null,
  };
}

/** The `spotify:` URI of what plays, from the web player's path
 * (`/playlist/<id>`, `/collection/tracks`). */
export function contextUriOf(href: string): string {
  if (/\/collection\/tracks/.test(href)) return "spotify:collection:tracks";
  const match = /\/(playlist|album|artist|show)\/([A-Za-z0-9]+)/.exec(href);
  return match ? `spotify:${match[1]}:${match[2]}` : "";
}

function player(native: NativePlayer | null | undefined): PlayerState {
  if (!native) return { ...EMPTY_PLAYER, at: Date.now() };
  return {
    title: native.title,
    artist: native.artist,
    album: native.album,
    artwork: native.artwork,
    trackUri: native.trackUri,
    contextUri: contextUriOf(native.contextHref),
    playing: native.playing,
    positionMs: native.positionMs,
    durationMs: native.durationMs,
    at: native.at || Date.now(),
    shuffle: native.shuffle,
    shuffleAvailable: native.shuffleAvailable,
    repeat: native.repeat,
    volume: native.volume,
    muted: native.muted,
    liked: native.liked,
    canNext: native.canNext,
    canPrevious: native.canPrevious,
    ad: native.ad,
    premium: native.premium ?? null,
  };
}

/** Runs an engine call; any rejection leaves in the `"E_CODE: text"` form. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const { code, message } = errorOf(error);
    throw backendError(code, message);
  }
}

export class EngineBackend implements Backend {
  readonly kind = "engine" as const;
  readonly player: Accessor<PlayerState>;
  readonly health: Accessor<Health>;
  readonly signedIn: Accessor<boolean | null>;

  #spotify: Spotify;
  #stops: (() => void)[] = [];
  #player = signal<PlayerState>(EMPTY_PLAYER);
  #health = signal<Health>({ status: "starting", error: null });
  #signedIn = signal<boolean | null>(null);
  #disposed = false;

  constructor(spotify: Spotify) {
    this.#spotify = spotify;
    this.player = () => this.#player();
    this.health = () => this.#health();
    this.signedIn = () => this.#signedIn();
    // Each listener gets the current value on the next turn, then changes.
    this.#stops.push(
      spotify.onPlayer((p) => this.#player.set(player(p))),
      spotify.onHealth((h) => this.#health.set(health(h))),
      spotify.onSignedIn((v) => this.#signedIn.set(v)),
    );
  }

  onAuth(listener: () => void): () => void {
    const stop = this.#spotify.onAuth(listener);
    this.#stops.push(stop);
    return stop;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
    this.#spotify.dispose();
  }

  // ---- Data ----

  home(): Promise<Home> {
    return call(() => this.#spotify.home());
  }

  search(query: string): Promise<SearchResults> {
    return call(() => this.#spotify.search(query));
  }

  playlist(uri: string): Promise<Collection> {
    return call(() => this.#spotify.playlist(uri));
  }

  album(uri: string): Promise<Collection> {
    return call(() => this.#spotify.album(uri));
  }

  artist(uri: string): Promise<Collection> {
    return call(() => this.#spotify.artist(uri));
  }

  likedSongs(): Promise<Collection> {
    return call(() => this.#spotify.likedSongs());
  }

  library(): Promise<Library> {
    return call(() => this.#spotify.library());
  }

  async coverColors(imageUrl: string): Promise<string[]> {
    if (!imageUrl) return [];
    const color = await call(() => this.#spotify.colors(imageUrl));
    return color.palette.length ? color.palette : color.hex ? [color.hex] : [];
  }

  async lyrics(trackUri: string): Promise<Lyrics> {
    const l = await call(() => this.#spotify.lyrics(trackUri));
    return { synced: l.synced, provider: l.provider, lines: l.lines.map((line) => ({ startMs: line.startMs, words: line.words })) };
  }

  async me(): Promise<Me> {
    const me = await call(() => this.#spotify.me());
    return { id: me.id, name: me.name, image: me.image };
  }

  // ---- Controls ----

  toggle(): Promise<void> {
    return call(() => this.#spotify.toggle());
  }

  play(): Promise<void> {
    return call(() => this.#spotify.play());
  }

  pause(): Promise<void> {
    return call(() => this.#spotify.pause());
  }

  next(): Promise<void> {
    return call(() => this.#spotify.next());
  }

  previous(): Promise<void> {
    return call(() => this.#spotify.previous());
  }

  seek(ms: number): Promise<void> {
    return call(() => this.#spotify.seek(ms));
  }

  setVolume(volume: number): Promise<void> {
    return call(() => this.#spotify.setVolume(volume));
  }

  setShuffle(on: boolean): Promise<void> {
    return call(() => this.#spotify.setShuffle(on));
  }

  setRepeat(mode: RepeatMode): Promise<void> {
    return call(() => this.#spotify.setRepeat(mode));
  }

  setLiked(on: boolean): Promise<void> {
    return call(() => this.#spotify.setLiked(on));
  }

  setMuted(on: boolean): Promise<void> {
    return call(() => this.#spotify.setMuted(on));
  }

  playContext(uri: string, trackUri: string | null): Promise<void> {
    return call(() => this.#spotify.playContext(uri, trackUri));
  }

  playTrack(uri: string): Promise<void> {
    return call(() => this.#spotify.playTrack(uri));
  }

  // ---- The account and the session ----

  async signIn(): Promise<void> {
    this.#spotify.signIn();
  }

  async cancelSignIn(): Promise<void> {
    this.#spotify.cancelSignIn();
  }

  async signOut(): Promise<void> {
    this.#spotify.signOut();
  }

  async retry(): Promise<void> {
    this.#spotify.retry();
  }

  setBridge(source: string): void {
    this.#spotify.setBridge(source);
  }
}
