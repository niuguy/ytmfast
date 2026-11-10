// `DemoBackend`: a `Backend` with fictional music and pretend playback, for
// the platforms without the engine (the web, phones) and for tests. The
// position moves on from `at` as a real player's does; a track that ends
// goes on to the next one.

import { type Accessor, signal } from "nsh";
import * as fixtures from "./fixtures";
import {
  type Backend,
  backendError,
  type Collection,
  EMPTY_PLAYER,
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
  type Track,
} from "./types";

/** How the demo starts. */
export interface DemoOptions {
  /** Premium (default false: a free account, which hears ads). */
  premium?: boolean;
  /** Signed in at the start (default true). */
  signedIn?: boolean;
  /** An ad plays at the start (default false). */
  ad?: boolean;
  /** Milliseconds until the player is ready (default 30). */
  readyAfter?: number;
  /** Milliseconds each data call takes (default 0). */
  latency?: number;
}

/** The accounts sign-ins go through in turn, so a second sign-in is
 * another account. */
const ACCOUNTS: Me[] = [
  { id: "demo-ada", name: "Ada", image: "" },
  { id: "demo-sam", name: "Sam", image: "" },
];

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  readonly player: Accessor<PlayerState>;
  readonly health: Accessor<Health>;
  readonly signedIn: Accessor<boolean | null>;

  #player = signal<PlayerState>({ ...EMPTY_PLAYER });
  #health = signal<Health>({ status: "starting", error: null });
  #signedIn = signal<boolean | null>(null);
  #auth = new Set<() => void>();
  #options: Required<DemoOptions>;
  #account = 0;
  #queue: Track[] = [];
  /** Each queued track's entry id, beside `#queue`. */
  #ids: string[] = [];
  #nextId = 0;
  #index = 0;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #ending: ReturnType<typeof setTimeout> | undefined;

  constructor(options: DemoOptions = {}) {
    this.#options = { premium: false, signedIn: true, ad: false, readyAfter: 30, latency: 0, ...options };
    this.player = () => this.#player();
    this.health = () => this.#health();
    this.signedIn = () => this.#signedIn();
    this.#later(this.#options.readyAfter, () => {
      this.#signedIn.set(this.#options.signedIn);
      this.#health.set({ status: "ready", error: null });
      this.#update({ premium: this.#premium() });
      if (this.#options.ad) this.#playAd();
    });
  }

  onAuth(listener: () => void): () => void {
    this.#auth.add(listener);
    return () => this.#auth.delete(listener);
  }

  dispose(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    if (this.#ending) clearTimeout(this.#ending);
    this.#auth.clear();
  }

  // ---- Data ----

  home(): Promise<Home> {
    return this.homeWith("");
  }

  homeWith(params: string): Promise<Home> {
    return this.#data(() => fixtures.homeFor(this.#signedIn() ? ACCOUNTS[this.#account].name : "there", params), false);
  }

  browse(uri: string): Promise<Page> {
    return this.#data(() => {
      const found = fixtures.page(uri);
      if (!found) throw backendError("E_NOT_FOUND", `no demo page ${uri}`);
      return found;
    }, false);
  }

  searchFiltered(query: string, filter: SearchFilter, continuation: string | null): Promise<SearchPage> {
    return this.#data(() => fixtures.searchFiltered(query, filter, continuation), false);
  }

  searchSuggestions(query: string): Promise<string[]> {
    return this.#data(() => fixtures.suggestions(query), false);
  }

  history(): Promise<Collection> {
    return this.#data(() => fixtures.history(), true);
  }

  playlistChoices(_trackUri: string): Promise<PlaylistChoice[]> {
    return this.#data(() => fixtures.playlistChoices(), true);
  }

  async queue(): Promise<Queue> {
    return this.#queueNow();
  }

  search(query: string): Promise<SearchResults> {
    return this.#data(() => fixtures.search(query), false);
  }

  playlist(uri: string): Promise<Collection> {
    return this.#collection(uri);
  }

  album(uri: string): Promise<Collection> {
    return this.#collection(uri);
  }

  artist(uri: string): Promise<Collection> {
    return this.#collection(uri);
  }

  likedSongs(): Promise<Collection> {
    return this.#collection(fixtures.LIKED_URI, true);
  }

  library(): Promise<Library> {
    return this.#data(() => fixtures.library(), true);
  }

  /** Fixtures have no images; the backdrops fall back to the theme. */
  async coverColors(_imageUrl: string): Promise<string[]> {
    return [];
  }

  lyrics(trackUri: string): Promise<Lyrics> {
    return this.#data(() => fixtures.lyrics(trackUri), false);
  }

  me(): Promise<Me> {
    return this.#data(() => ({ ...ACCOUNTS[this.#account] }), true);
  }

  #collection(uri: string, signedInOnly = false): Promise<Collection> {
    return this.#data(() => {
      const found = fixtures.collection(uri);
      if (!found) throw backendError("E_NOT_FOUND", `no demo collection ${uri}`);
      return found;
    }, signedInOnly);
  }

  #data<T>(make: () => T, signedInOnly: boolean): Promise<T> {
    return new Promise((resolve, reject) => {
      this.#later(this.#options.latency, () => {
        if (signedInOnly && this.#signedIn() !== true) {
          reject(backendError("E_SIGNED_OUT", "no account is signed in"));
          return;
        }
        try {
          resolve(make());
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  // ---- Controls ----

  async toggle(): Promise<void> {
    return this.#player().playing ? this.pause() : this.play();
  }

  async play(): Promise<void> {
    this.#ready();
    if (!this.#player().title) throw backendError("E_NOTHING_LOADED", "nothing to play");
    this.#update({ playing: true });
  }

  async pause(): Promise<void> {
    this.#ready();
    this.#update({ playing: false });
  }

  async next(): Promise<void> {
    this.#ready();
    if (this.#player().ad) throw backendError("E_AD_PLAYING", "an ad is playing");
    this.#advance(1);
  }

  async previous(): Promise<void> {
    this.#ready();
    if (this.#player().ad) throw backendError("E_AD_PLAYING", "an ad is playing");
    if (this.#position() > 3000 || this.#index === 0) this.#update({ positionMs: 0 });
    else this.#advance(-1);
  }

  async seek(ms: number): Promise<void> {
    this.#ready();
    if (this.#player().ad) throw backendError("E_AD_PLAYING", "an ad is playing");
    this.#update({ positionMs: Math.max(0, Math.min(ms, this.#player().durationMs)) });
  }

  async setVolume(volume: number): Promise<void> {
    this.#ready();
    this.#update({ volume: Math.max(0, Math.min(1, volume)) });
  }

  async setShuffle(on: boolean): Promise<void> {
    this.#ready();
    this.#update({ shuffle: on });
  }

  async setRepeat(mode: RepeatMode): Promise<void> {
    this.#ready();
    this.#update({ repeat: mode });
  }

  async setLiked(on: boolean): Promise<void> {
    this.#ready();
    if (!this.#player().trackUri) throw backendError("E_NOTHING_LOADED", "nothing to like");
    this.#update({ liked: on });
  }

  async setMuted(on: boolean): Promise<void> {
    this.#ready();
    this.#update({ muted: on });
  }

  async playContext(uri: string, trackUri: string | null): Promise<void> {
    this.#ready();
    // History is a list of plays, not a queue: its song plays on its own.
    const found = uri.startsWith("ytm:history:") ? fixtures.history() : fixtures.collection(uri);
    if (!found || found.tracks.length === 0) throw backendError("E_NOT_FOUND", `no demo collection ${uri}`);
    this.#setQueue(found.tracks);
    const at = trackUri ? found.tracks.findIndex((t) => t.uri === trackUri) : -1;
    // YouTube Music plays the chosen song, free accounts too.
    this.#index = Math.max(0, at);
    this.#load(uri, { shuffle: this.#player().shuffle });
  }

  async playTrack(uri: string): Promise<void> {
    this.#ready();
    const track = findTrack(uri);
    if (!track) throw backendError("E_NOT_FOUND", `no demo track ${uri}`);
    this.#setQueue([track]);
    this.#index = 0;
    this.#load("", {});
  }

  async queueAdd(uri: string, next: boolean): Promise<Queue> {
    this.#ready();
    const tracks = fixtures.tracksOf(uri);
    if (tracks.length === 0) throw backendError("E_NOT_FOUND", `nothing to queue in ${uri}`);
    const ids = tracks.map(() => this.#newId());
    if (this.#queue.length === 0) {
      this.#queue = tracks;
      this.#ids = ids;
      this.#index = 0;
      this.#load(uri, {});
    } else {
      const at = next ? this.#index + 1 : this.#queue.length;
      this.#queue = [...this.#queue.slice(0, at), ...tracks, ...this.#queue.slice(at)];
      this.#ids = [...this.#ids.slice(0, at), ...ids, ...this.#ids.slice(at)];
      this.#update({ canNext: true });
    }
    return this.#queueNow();
  }

  async queueRemove(id: string): Promise<Queue> {
    this.#ready();
    const at = this.#ids.indexOf(id);
    if (at < 0) throw backendError("E_NOT_FOUND", `no queue entry ${id}`);
    const playing = at === this.#index;
    this.#queue = this.#queue.filter((_, i) => i !== at);
    this.#ids = this.#ids.filter((_, i) => i !== at);
    if (at < this.#index) this.#index -= 1;
    if (playing) {
      if (this.#queue.length === 0) this.#player.set({ ...EMPTY_PLAYER, at: Date.now() });
      else {
        this.#index = Math.min(this.#index, this.#queue.length - 1);
        this.#load(this.#player().contextUri, {});
      }
    }
    return this.#queueNow();
  }

  async queueJump(id: string): Promise<Queue> {
    this.#ready();
    if (this.#player().ad) throw backendError("E_AD", "an ad is playing");
    const at = this.#ids.indexOf(id);
    if (at < 0) throw backendError("E_NOT_FOUND", `no queue entry ${id}`);
    this.#index = at;
    this.#load(this.#player().contextUri, {});
    return this.#queueNow();
  }

  async startRadio(uri: string): Promise<void> {
    this.#ready();
    if (this.#player().ad) throw backendError("E_AD", "an ad is playing");
    const seed = fixtures.tracksOf(uri);
    if (seed.length === 0) throw backendError("E_NOT_FOUND", `no radio for ${uri}`);
    // The seed, then every other song the demo has.
    const rest = fixtures.tracksOf(fixtures.LIKED_URI).concat(fixtures.tracksOf("ytm:album:neonorchard"), fixtures.tracksOf("ytm:album:saltlines"));
    this.#setQueue([...seed, ...rest.filter((t) => !seed.some((s) => s.uri === t.uri))]);
    this.#index = 0;
    this.#load(`ytm:mix:RD${uri.split(":")[2] ?? ""}`, {});
  }

  async setDisliked(on: boolean): Promise<void> {
    this.#ready();
    if (!this.#player().trackUri) throw backendError("E_NOTHING_LOADED", "nothing to dislike");
    this.#update({ disliked: on, liked: on ? false : this.#player().liked });
    if (on) fixtures.setLikedSong(this.#player().trackUri, false);
  }

  async rate(trackUri: string, rating: Rating): Promise<void> {
    this.#ready();
    fixtures.setLikedSong(trackUri, rating === "like");
    if (this.#player().trackUri === trackUri) this.#update({ liked: rating === "like", disliked: rating === "dislike" });
  }

  async setSaved(uri: string, on: boolean): Promise<void> {
    this.#ready();
    fixtures.setSaved(uri, on);
  }

  async setSubscribed(artistUri: string, on: boolean): Promise<void> {
    this.#ready();
    fixtures.setSubscribed(artistUri, on);
  }

  async addToPlaylist(playlistUri: string, trackUri: string): Promise<void> {
    this.#ready();
    if (!fixtures.addToPlaylist(playlistUri, trackUri)) throw backendError("E_NOT_FOUND", `cannot add to ${playlistUri}`);
  }

  async createPlaylist(name: string, trackUri: string | null): Promise<string> {
    this.#ready();
    if (!name.trim()) throw backendError("E_BAD_ARGS", "a playlist needs a name");
    return fixtures.createPlaylist(name.trim(), trackUri);
  }

  async removeFromPlaylist(playlistUri: string, _trackUri: string, uid: string): Promise<void> {
    this.#ready();
    if (!fixtures.removeFromPlaylist(playlistUri, uid)) throw backendError("E_NOT_FOUND", `no row ${uid} in ${playlistUri}`);
  }

  // ---- The account ----

  async signIn(): Promise<void> {
    if (this.#signedIn() === true) return;
    this.#health.set({ status: "signingIn", error: null });
    this.#later(400, () => {
      if (this.#health().status !== "signingIn") return;
      this.#signedIn.set(true);
      this.#health.set({ status: "ready", error: null });
      this.#update({ premium: this.#premium() });
      for (const listener of this.#auth) listener();
    });
  }

  async cancelSignIn(): Promise<void> {
    if (this.#health().status === "signingIn") this.#health.set({ status: "ready", error: null });
  }

  async signOut(): Promise<void> {
    if (this.#ending) clearTimeout(this.#ending);
    this.#account = (this.#account + 1) % ACCOUNTS.length;
    this.#setQueue([]);
    this.#signedIn.set(false);
    this.#player.set({ ...EMPTY_PLAYER, at: Date.now() });
  }

  async retry(): Promise<void> {
    this.#health.set({ status: "ready", error: null });
  }

  setBridge(_source: string): void {}

  // ---- Pretend playback ----

  #premium(): boolean | null {
    return this.#signedIn() === true ? this.#options.premium : null;
  }

  #ready(): void {
    if (this.#health().status !== "ready") throw backendError("E_NOT_READY", "the player is starting");
    if (this.#signedIn() !== true) throw backendError("E_SIGNED_OUT", "no account is signed in");
  }

  #newId(): string {
    this.#nextId += 1;
    return String(this.#nextId);
  }

  /** Queues `tracks` in place of the queue, each with a new entry id. */
  #setQueue(tracks: Track[]): void {
    this.#queue = tracks;
    this.#ids = tracks.map(() => this.#newId());
  }

  #queueNow(): Queue {
    const items = this.#queue.map((t, i) => ({
      id: this.#ids[i],
      uri: t.uri,
      name: t.name,
      artists: t.artists,
      image: t.image,
      durationMs: t.durationMs,
      current: i === this.#index && !!this.#player().trackUri,
    }));
    return { items, current: items.findIndex((i) => i.current), autoplay: [] };
  }

  /** The position now. */
  #position(): number {
    const p = this.#player();
    return p.playing ? Math.min(p.durationMs, p.positionMs + (Date.now() - p.at)) : p.positionMs;
  }

  /** Sets fields, sampling the position anew, and schedules the track's end. */
  #update(change: Partial<PlayerState>): void {
    const now = Date.now();
    const position = change.positionMs ?? this.#position();
    this.#player.set({ ...this.#player(), positionMs: position, ...change, at: now });
    this.#schedule();
  }

  #schedule(): void {
    if (this.#ending) clearTimeout(this.#ending);
    this.#ending = undefined;
    const p = this.#player();
    if (!p.playing || p.durationMs <= 0) return;
    const left = Math.max(0, p.durationMs - this.#position());
    this.#ending = setTimeout(() => this.#ended(), left);
  }

  #ended(): void {
    const p = this.#player();
    if (p.ad) {
      // The ad is over: what was queued plays.
      if (this.#queue.length) this.#load(p.contextUri, {});
      else this.#update({ ...EMPTY_PLAYER, premium: this.#premium(), playing: false });
      return;
    }
    if (p.repeat === "track") this.#update({ positionMs: 0 });
    else if (this.#index + 1 < this.#queue.length || p.repeat === "context") this.#advance(1);
    else this.#update({ playing: false, positionMs: p.durationMs });
  }

  #advance(step: number): void {
    if (this.#queue.length === 0) return;
    this.#index = (this.#index + step + this.#queue.length) % this.#queue.length;
    this.#load(this.#player().contextUri, {});
  }

  #load(contextUri: string, change: Partial<PlayerState>): void {
    const track = this.#queue[this.#index];
    this.#update({
      title: track.name,
      artist: track.artists,
      album: track.album,
      artwork: track.image,
      trackUri: track.uri,
      contextUri,
      playing: true,
      positionMs: 0,
      durationMs: track.durationMs,
      shuffleAvailable: true,
      liked: fixtures.collection(fixtures.LIKED_URI)?.tracks.some((t) => t.uri === track.uri) ?? false,
      disliked: false,
      canNext: this.#queue.length > 1,
      canPrevious: true,
      ad: false,
      premium: this.#premium(),
      ...change,
    });
  }

  #playAd(): void {
    this.#update({
      title: fixtures.AD.title,
      artist: "",
      album: "",
      artwork: fixtures.AD.artwork,
      trackUri: "",
      playing: true,
      positionMs: 0,
      durationMs: fixtures.AD.durationMs,
      canNext: false,
      canPrevious: false,
      ad: true,
    });
  }

  #later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      run();
    }, ms);
    this.#timers.add(timer);
  }
}

function findTrack(uri: string): Track | undefined {
  for (const uriOf of [fixtures.LIKED_URI, "ytm:album:paperlanterns", "ytm:album:neonorchard", "ytm:album:saltlines"]) {
    const found = fixtures.collection(uriOf)?.tracks.find((t) => t.uri === uri);
    if (found) return found;
  }
  return undefined;
}
