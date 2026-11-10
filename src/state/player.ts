// Playback: the player's state as the UI shows it, and the intents that
// change it. The backend owns playback; this mirrors it, moves the position
// on locally between its messages, and shows a control's result at once
// (an optimistic change), the request going out at the same time. A change
// stays on screen until the backend reports it (or, once the request is
// done, a moment later the backend's word wins); unrelated messages (the
// heartbeat) don't wipe it, so nothing flickers back. A control that fails
// drops its change, so nothing stays on screen that did not happen.

import { Animated, cleanup, type CompositeAnimation, computed, createAnimatedValue, Easing, effect, signal, untracked } from "nsh";
import { EMPTY_PLAYER, type Item, type PlayerState, positionAt, type RepeatMode, type Track } from "../backend/types";
import { backend } from "./engine";
import { type MessageId, notify, report } from "./feedback";
import { openPremium } from "./links";
import { askToSignIn, ready, signedIn } from "./session";

/** A control's change on its way: shown until the backend agrees, or a
 * moment after its request is done (the backend wins), or a time limit. */
interface Pending {
  change: Partial<PlayerState>;
  started: number;
  settled: number | null;
}

/** How long after its request is done a change still shows when the
 * backend disagrees (its state may lag the request a little), ms. */
const SETTLE_GRACE = 1500;
/** The longest a change shows without the backend agreeing, ms. */
const PENDING_LIMIT = 8000;

const pending = signal<Pending[]>([]);

function agrees(state: PlayerState, change: Partial<PlayerState>): boolean {
  for (const key of Object.keys(change) as (keyof PlayerState)[]) {
    if (key === "at") continue;
    if (key === "positionMs") {
      if (Math.abs(positionAt(state, Date.now()) - (change.positionMs ?? 0)) > 2000) return false;
      continue;
    }
    if (state[key] !== change[key]) return false;
  }
  return true;
}

/** Drops the changes the backend has caught up with, or that are over. */
function prune(): void {
  const state = backend.player();
  const now = Date.now();
  const kept = pending().filter(
    (p) =>
      !agrees({ ...EMPTY_PLAYER, ...state }, p.change) &&
      now - p.started < PENDING_LIMIT &&
      (p.settled === null || now - p.settled < SETTLE_GRACE),
  );
  if (kept.length !== pending().length) pending.set(kept);
}

// Every backend message checks the changes on their way.
effect(() => {
  backend.player();
  untracked(prune);
});

const optimistic = computed<Partial<PlayerState>>(() => Object.assign({}, ...pending().map((p) => p.change)));

/** Tracks of collections the app has shown, by collection URI: what plays
 * is found among them when the backend can't name it. */
const shownTracks = new Map<string, Track[]>();
const shownVersion = signal(0);

/** Remembers a collection's tracks (its page shows them). */
export function rememberTracks(contextUri: string, tracks: Track[]): void {
  if (!contextUri || shownTracks.get(contextUri) === tracks) return;
  shownTracks.set(contextUri, tracks);
  untracked(() => shownVersion.update((v) => v + 1));
}

/** The last thing played from the app: what it is, and from where. */
const lastPick = signal<{ trackUri: string; contextUri: string; title: string } | null>(null);

/** Fills in what the backend could not name (the web player's widget does
 * not always say which track or collection plays): the collection is the
 * one last played from the app, and the track the one of its tracks with
 * the playing title, so the "playing here" marks hold. */
function named(state: PlayerState): PlayerState {
  if (state.ad || !state.title) return state;
  const pick = lastPick();
  let { trackUri, contextUri } = state;
  if (!contextUri && pick) contextUri = pick.contextUri;
  if (!trackUri) {
    shownVersion();
    const found = shownTracks.get(contextUri)?.find((t) => t.name === state.title);
    if (found) trackUri = found.uri;
    else if (pick && pick.title === state.title) trackUri = pick.trackUri;
  }
  return trackUri === state.trackUri && contextUri === state.contextUri ? state : { ...state, trackUri, contextUri };
}

/** The player as shown: the backend's state with the values of controls
 * still on their way over it, and what it could not name filled in
 * (tracked). */
export const player = computed<PlayerState>(() => named({ ...EMPTY_PLAYER, ...backend.player(), ...optimistic() }));

const now = signal(Date.now());

// While playing, the clock ticks so the position moves on: once a second,
// just as the shown second changes (the times show whole seconds; the bar
// moves natively, `positionFill`).
effect(() => {
  const p = player();
  if (!p.playing) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    const t = Date.now();
    now.set(t);
    const at = positionAt(p, t);
    // At the end it stays there: nothing more to show.
    if (p.durationMs > 0 && at >= p.durationMs) return;
    timer = setTimeout(tick, 1000 - (at % 1000) + 4);
  };
  tick();
  cleanup(() => {
    if (timer !== null) clearTimeout(timer);
  });
});

const seekDraft = signal<number | null>(null);
const volumeDraft = signal<number | null>(null);

/** The position to show: the drag in progress, else the player's (tracked).
 * While it plays it changes once a second (the shown second). */
export const position = () => seekDraft() ?? positionAt(player(), now());

/** The position as a share of the track (0..1), an animated value moving on
 * natively while it plays, at the display's rate with no JS per frame: a
 * linear timing to the end over the time left, set again on every change
 * of where the player is (a seek, a pause, a new track) and as a drag
 * moves. The position bar draws its range from it. */
export const positionFill = createAnimatedValue(0);
let fillAnchor = "";
let fillRun: CompositeAnimation | null = null;
/** Longer than any track: the end is held this long before the hold
 * repeats (as a deadline, with no frames). */
const HOLD_MS = 86_400_000;
effect(() => {
  const draft = seekDraft();
  const p = player();
  const duration = p.durationMs;
  // Nothing about where it is changed (a heartbeat): it moves on as it is.
  const anchor = `${draft}|${p.positionMs}|${p.at}|${p.playing}|${duration}`;
  if (anchor === fillAnchor) return;
  fillAnchor = anchor;
  // As the slider shows `position()` over `max(1, duration)`: held to 0..1.
  const max = Math.max(1, duration);
  const at = draft ?? positionAt(p, Date.now());
  const from = Math.min(1, Math.max(0, at / max));
  fillRun?.stop();
  fillRun = null;
  positionFill.set(from);
  if (draft === null && p.playing && duration > 0 && from < 1) {
    // To the end, then held there, as one animation that does not end by
    // itself (as a spinner's): what waits for animations to finish (a
    // test's step) does not wait for the song to end.
    fillRun = Animated.loop(
      Animated.sequence([
        Animated.timing(positionFill, { toValue: 1, duration: duration - at, easing: Easing.linear }),
        Animated.delay(HOLD_MS),
      ]),
      { resetBeforeIteration: false },
    );
    void fillRun.start();
  }
});

/** The volume to show, 0 while muted: the drag in progress, else the
 * player's (tracked). */
export const volumeLevel = () => {
  const draft = volumeDraft();
  if (draft !== null) return draft;
  const p = player();
  return p.muted ? 0 : p.volume;
};

// What many views follow, each on its own: a backend message that changes
// none of them (the heartbeat, the position) wakes none of their readers
// (every row of a list asks whether it is the one loaded).
const loadedTrack = computed(() => player().trackUri);
const loadedContext = computed(() => player().contextUri);
const playingNow = computed(() => player().playing);
const loaded = computed(() => player().title !== "");

/** Whether it plays (tracked; only when that changes). */
export const isPlaying = () => playingNow();

/** Whether something is loaded (tracked). */
export const hasTrack = () => loaded();

/** Whether the controls can act (tracked): the player is ready, and a
 * track (not an ad) is loaded for the ones that need one. */
export const controlsEnabled = () => ready() && signedIn() === true && hasTrack();

/** Whether `uri` is the collection playing now (tracked). */
export function isPlayingContext(uri: string): boolean {
  return playingNow() && uri !== "" && loadedContext() === uri;
}

/** Whether `uri` is the collection loaded, playing or not (tracked). */
export function isCurrentContext(uri: string): boolean {
  return uri !== "" && loadedContext() === uri;
}

/** Whether `uri` is the track loaded (tracked). */
export function isCurrentTrack(uri: string): boolean {
  return uri !== "" && loadedTrack() === uri;
}

// ---- Intents ----

/** Whether a play request may go to the backend: a signed-out user is asked
 * to log in. Controls are disabled until the player is ready. */
function allowed(): boolean {
  if (!ready()) return false;
  if (signedIn() !== true) {
    askToSignIn();
    return false;
  }
  return true;
}

/** Sends a control, showing `change` until the backend answers; a failure
 * drops `change` (where no later control replaced it) and says so. */
function send(change: Partial<PlayerState>, action: () => Promise<void>, failure: MessageId = "playFailed"): void {
  if (!allowed()) return;
  // On screen first, in the same frame as the press; the request goes out
  // at once alongside.
  const entry: Pending | null = Object.keys(change).length > 0 ? { change, started: Date.now(), settled: null } : null;
  if (entry) pending.update((list) => [...list, entry]);
  action().then(
    () => {
      if (!entry) return;
      entry.settled = Date.now();
      // Give the backend's state a moment to catch up, then let it win.
      setTimeout(prune, SETTLE_GRACE + 50);
      prune();
    },
    (error) => {
      if (entry) pending.update((list) => list.filter((p) => p !== entry));
      report(failure, error);
    },
  );
}

export function toggle(): void {
  const p = player();
  if (!p.title) return;
  const at = Date.now();
  send({ playing: !p.playing, positionMs: positionAt(p, at), at }, () => (p.playing ? backend.pause() : backend.play()));
}

/** Plays (the system's media controls); nothing when it plays already. */
export function play(): void {
  if (!player().playing) toggle();
}

/** Pauses (the system's media controls); nothing when it is paused. */
export function pause(): void {
  if (player().playing) toggle();
}

export function next(): void {
  send({}, () => backend.next());
}

export function previous(): void {
  send({}, () => backend.previous());
}

/** The position drag moved: shown, not sent. */
export function dragSeek(ms: number): void {
  seekDraft.set(ms);
}

/** Seeks to `ms` (the drag ended there). */
export function seek(ms: number): void {
  seekDraft.set(null);
  send({ positionMs: ms, at: Date.now() }, () => backend.seek(ms));
}

/** The volume drag moved: shown, not sent. */
export function dragVolume(volume: number): void {
  volumeDraft.set(volume);
}

/** Sets the volume (the drag ended there); a muted player unmutes. */
export function setVolume(volume: number): void {
  volumeDraft.set(null);
  if (player().muted) {
    send({ muted: false, volume }, async () => {
      await backend.setMuted(false);
      await backend.setVolume(volume);
    });
  } else {
    send({ volume }, () => backend.setVolume(volume));
  }
}

export function toggleMute(): void {
  const muted = !player().muted;
  send({ muted }, () => backend.setMuted(muted));
}

export function toggleShuffle(): void {
  const shuffle = !player().shuffle;
  send({ shuffle }, () => backend.setShuffle(shuffle));
}

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "context", context: "track", track: "off" };

export function cycleRepeat(): void {
  const repeat = NEXT_REPEAT[player().repeat];
  send({ repeat }, () => backend.setRepeat(repeat));
}

export function toggleLike(): void {
  const liked = !player().liked;
  send({ liked }, () => backend.setLiked(liked), "likeFailed");
}

let freeNoticeShown = false;

/** Tells a free account, once a session, that it shuffles, but only when
 * it did: when what plays after a pick is another song than the one picked
 * (the web player often plays the very song a free account picks). Waits
 * out an ad that plays first. */
function noteIfShuffled(picked: string, tries = 6): void {
  if (freeNoticeShown || player().premium !== false) return;
  setTimeout(() => {
    const now = player();
    if (freeNoticeShown) return;
    if ((now.ad || !now.trackUri) && tries > 0) return noteIfShuffled(picked, tries - 1);
    if (now.ad || !now.trackUri || now.trackUri === picked) return;
    freeNoticeShown = true;
    notify("freeShuffles", { label: "Get Premium", run: openPremium });
  }, 2500);
}

/** What shows the moment a track is picked: it is the one loaded and it
 * plays (its row marks it, the bar shows it), until the backend says what
 * actually plays. */
function picked(trackUri: string, contextUri: string, track?: Track): Partial<PlayerState> {
  lastPick.set({ trackUri, contextUri, title: track?.name ?? "" });
  const change: Partial<PlayerState> = { trackUri, contextUri, playing: true, positionMs: 0, at: Date.now() };
  if (track) Object.assign(change, { title: track.name, artist: track.artists, album: track.album, artwork: track.image, durationMs: track.durationMs });
  return change;
}

/** Plays a whole collection. */
export function playCollection(uri: string): void {
  lastPick.set({ trackUri: "", contextUri: uri, title: "" });
  send({ contextUri: uri, playing: true }, () => backend.playContext(uri, null));
}

/** Plays `trackUri` within the collection `contextUri`; when a free
 * account gets another song (shuffled), it hears why, once. */
export function playFrom(contextUri: string, trackUri: string, track?: Track): void {
  if (!allowed()) return;
  send(picked(trackUri, contextUri, track), () => backend.playContext(contextUri, trackUri).then(() => noteIfShuffled(trackUri)));
}

/** Plays a track found outside a collection: Premium plays it on its own;
 * a free account plays its album, the track's context. */
export function playTrack(track: { uri: string; albumUri?: string } & Partial<Track>): void {
  const full = "name" in track && track.name ? (track as Track) : undefined;
  if (player().premium === true || !track.albumUri) {
    send(picked(track.uri, player().contextUri, full), () => backend.playTrack(track.uri));
    return;
  }
  playFrom(track.albumUri, track.uri, full);
}

/** Plays a card: its collection, or the track it is. */
export function playItem(item: Item): void {
  if (item.kind === "track") playTrack({ uri: item.uri });
  else playCollection(item.uri);
}

/** The play button of a collection: pauses or resumes it while it is the
 * one loaded, else plays it. */
export function toggleCollection(uri: string): void {
  if (isCurrentContext(uri) && hasTrack()) toggle();
  else playCollection(uri);
}
