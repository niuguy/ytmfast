// `EngineBackend`: the `Backend` over the native engine (`ytmfast/native`'s
// `YTMusic` class). This is the only file that calls the engine, so a change
// to the engine's API changes only this file.
//
// `new YTMusic()` is a cheap handle onto the one engine of the process (Rust
// starts it the first time), so a hot update of the TSX never starts a
// second Chromium. Each `EngineBackend` owns one handle; the previous one is
// disposed when a hot update makes a new one.

import { type Accessor, signal } from "nsh";
import { YTMusic, type Health as NativeHealth, type Player as NativePlayer } from "ytmfast/native";
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
  type Page,
  type PlayerState,
  type PlaylistChoice,
  type Queue,
  type Rating,
  type RepeatMode,
  type SearchFilter,
  type SearchPage,
  type SearchResults,
} from "./types";

const SLOT_KEY = "__ytmfastEngine";

/** The engine backend. The one a previous version of the TSX made (a hot
 * update) stops listening first. */
export function engineBackend(): EngineBackend {
  const g = globalThis as unknown as Record<string, EngineBackend | undefined>;
  g[SLOT_KEY]?.dispose();
  const backend = new EngineBackend(new YTMusic());
  g[SLOT_KEY] = backend;
  return backend;
}

function health(native: NativeHealth | null | undefined): Health {
  return {
    status: native?.status ?? "starting",
    error: native?.error ? { code: native.error.code, message: native.error.message } : null,
  };
}

/** The `ytm:` URI of what plays. The bridge reports the URI it was asked
 * to play when it knows it, else the page's URL, whose `list=` names the
 * queue's playlist (`LM` is Liked Music). */
export function contextUriOf(href: string): string {
  if (href.startsWith("ytm:")) return href;
  const match = /[?&]list=([A-Za-z0-9_-]+)/.exec(href);
  if (!match) return "";
  return match[1] === "LM" ? "ytm:collection:LM" : `ytm:playlist:${match[1]}`;
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
    disliked: native.disliked,
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

  #ytm: YTMusic;
  #stops: (() => void)[] = [];
  #player = signal<PlayerState>(EMPTY_PLAYER);
  #health = signal<Health>({ status: "starting", error: null });
  #signedIn = signal<boolean | null>(null);
  #disposed = false;

  constructor(ytm: YTMusic) {
    this.#ytm = ytm;
    this.player = () => this.#player();
    this.health = () => this.#health();
    this.signedIn = () => this.#signedIn();
    // Each listener gets the current value on the next turn, then changes.
    this.#stops.push(
      ytm.onPlayer((p) => this.#player.set(player(p))),
      ytm.onHealth((h) => this.#health.set(health(h))),
      ytm.onSignedIn((v) => this.#signedIn.set(v)),
    );
  }

  onAuth(listener: () => void): () => void {
    const stop = this.#ytm.onAuth(listener);
    this.#stops.push(stop);
    return stop;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const stop of this.#stops.splice(0)) stop();
    this.#ytm.dispose();
  }

  // ---- Data ----

  home(): Promise<Home> {
    return call(() => this.#ytm.home());
  }

  search(query: string): Promise<SearchResults> {
    return call(() => this.#ytm.search(query));
  }

  playlist(uri: string): Promise<Collection> {
    return call(() => this.#ytm.playlist(uri));
  }

  album(uri: string): Promise<Collection> {
    return call(() => this.#ytm.album(uri));
  }

  artist(uri: string): Promise<Collection> {
    return call(() => this.#ytm.artist(uri));
  }

  likedSongs(): Promise<Collection> {
    return call(() => this.#ytm.likedSongs());
  }

  library(): Promise<Library> {
    return call(() => this.#ytm.library());
  }

  async coverColors(imageUrl: string): Promise<string[]> {
    if (!imageUrl) return [];
    const color = await call(() => this.#ytm.colors(imageUrl));
    return color.palette.length ? color.palette : color.hex ? [color.hex] : [];
  }

  async lyrics(trackUri: string): Promise<Lyrics> {
    const l = await call(() => this.#ytm.lyrics(trackUri));
    return { synced: l.synced, provider: l.provider, lines: l.lines.map((line) => ({ startMs: line.startMs, words: line.words })) };
  }

  async me(): Promise<Me> {
    const me = await call(() => this.#ytm.me());
    return { id: me.id, name: me.name, image: me.image };
  }

  homeWith(params: string): Promise<Home> {
    return call(() => this.#ytm.homeWith(params));
  }

  browse(uri: string): Promise<Page> {
    return call(() => this.#ytm.browse(uri));
  }

  searchFiltered(query: string, filter: SearchFilter, continuation: string | null): Promise<SearchPage> {
    return call(() => this.#ytm.searchFiltered(query, filter, continuation));
  }

  searchSuggestions(query: string): Promise<string[]> {
    return call(() => this.#ytm.searchSuggestions(query));
  }

  history(): Promise<Collection> {
    return call(() => this.#ytm.history());
  }

  playlistChoices(trackUri: string): Promise<PlaylistChoice[]> {
    return call(() => this.#ytm.playlistChoices(trackUri));
  }

  queue(): Promise<Queue> {
    return call(() => this.#ytm.queue());
  }

  queueAdd(uri: string, next: boolean): Promise<Queue> {
    return call(() => this.#ytm.queueAdd(uri, next));
  }

  queueRemove(id: string): Promise<Queue> {
    return call(() => this.#ytm.queueRemove(id));
  }

  queueJump(id: string): Promise<Queue> {
    return call(() => this.#ytm.queueJump(id));
  }

  startRadio(uri: string): Promise<void> {
    return call(() => this.#ytm.startRadio(uri));
  }

  setDisliked(on: boolean): Promise<void> {
    return call(() => this.#ytm.setDisliked(on));
  }

  rate(trackUri: string, rating: Rating): Promise<void> {
    return call(() => this.#ytm.rate(trackUri, rating));
  }

  setSaved(uri: string, on: boolean): Promise<void> {
    return call(() => this.#ytm.setSaved(uri, on));
  }

  setSubscribed(artistUri: string, on: boolean): Promise<void> {
    return call(() => this.#ytm.setSubscribed(artistUri, on));
  }

  addToPlaylist(playlistUri: string, trackUri: string): Promise<void> {
    return call(() => this.#ytm.addToPlaylist(playlistUri, trackUri));
  }

  createPlaylist(name: string, trackUri: string | null): Promise<string> {
    return call(() => this.#ytm.createPlaylist(name, trackUri));
  }

  removeFromPlaylist(playlistUri: string, trackUri: string, uid: string): Promise<void> {
    return call(() => this.#ytm.removeFromPlaylist(playlistUri, trackUri, uid));
  }

  // ---- Controls ----

  toggle(): Promise<void> {
    return call(() => this.#ytm.toggle());
  }

  play(): Promise<void> {
    return call(() => this.#ytm.play());
  }

  pause(): Promise<void> {
    return call(() => this.#ytm.pause());
  }

  next(): Promise<void> {
    return call(() => this.#ytm.next());
  }

  previous(): Promise<void> {
    return call(() => this.#ytm.previous());
  }

  seek(ms: number): Promise<void> {
    return call(() => this.#ytm.seek(ms));
  }

  setVolume(volume: number): Promise<void> {
    return call(() => this.#ytm.setVolume(volume));
  }

  setShuffle(on: boolean): Promise<void> {
    return call(() => this.#ytm.setShuffle(on));
  }

  setRepeat(mode: RepeatMode): Promise<void> {
    return call(() => this.#ytm.setRepeat(mode));
  }

  setLiked(on: boolean): Promise<void> {
    return call(() => this.#ytm.setLiked(on));
  }

  setMuted(on: boolean): Promise<void> {
    return call(() => this.#ytm.setMuted(on));
  }

  playContext(uri: string, trackUri: string | null): Promise<void> {
    return call(() => this.#ytm.playContext(uri, trackUri));
  }

  playTrack(uri: string): Promise<void> {
    return call(() => this.#ytm.playTrack(uri));
  }

  // ---- The account and the session ----

  async signIn(): Promise<void> {
    this.#ytm.signIn();
  }

  async cancelSignIn(): Promise<void> {
    this.#ytm.cancelSignIn();
  }

  async signOut(): Promise<void> {
    this.#ytm.signOut();
  }

  async retry(): Promise<void> {
    this.#ytm.retry();
  }

  setBridge(source: string): void {
    this.#ytm.setBridge(source);
  }
}
