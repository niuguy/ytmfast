// What is open over the pages: Now Playing, About and the phone's library
// drawer. The shells draw each as a `Dialog` or a `Sheet`, which own focus,
// Escape and back; these signals only say whether each is open.

import { batch, signal, Storage } from "nsh";

const nowPlaying = signal(false);
const about = signal(false);
const shortcuts = signal(false);
const drawer = signal(false);
const firstRun = signal(false);
const lyrics = signal(false);

/** Set once the first-run sheet was closed. */
const FIRST_RUN_DONE = "firstRun:done";

// The first-run sheet shows until it is closed once.
Storage.getItem(FIRST_RUN_DONE)
  .then((done) => {
    if (!done) firstRun.set(true);
  })
  .catch(() => {});

/** Remembers whether Now Playing shows the lyrics. */
const LYRICS_SHOWN = "lyrics:shown";

Storage.getItem(LYRICS_SHOWN)
  .then((shown) => {
    if (shown === "1") lyrics.set(true);
  })
  .catch(() => {});

/** Whether Now Playing is open (tracked). */
export const nowPlayingOpen = () => nowPlaying();
/** Whether About is open (tracked). */
export const aboutOpen = () => about();
/** Whether the keyboard shortcuts' help is open (tracked). */
export const shortcutsOpen = () => shortcuts();
export function setShortcutsOpen(open: boolean): void {
  shortcuts.set(open);
}
/** Whether the phone's library drawer is open (tracked). */
export const drawerOpen = () => drawer();

export function setNowPlayingOpen(open: boolean): void {
  nowPlaying.set(open);
}

export function setAboutOpen(open: boolean): void {
  // About opens over the drawer's place: the drawer closes first.
  batch(() => {
    if (open) drawer.set(false);
    about.set(open);
  });
}

export function setDrawerOpen(open: boolean): void {
  drawer.set(open);
}

/** Whether Now Playing shows the lyrics (tracked); remembered. */
export const lyricsShown = () => lyrics();

export function setLyricsShown(shown: boolean): void {
  lyrics.set(shown);
  Storage.setItem(LYRICS_SHOWN, shown ? "1" : "0").catch(() => {});
}

/** Opens Now Playing on the lyrics (the player bar's Lyrics button). */
export function openLyrics(): void {
  batch(() => {
    setLyricsShown(true);
    nowPlaying.set(true);
  });
}

/** Whether the first-run sheet is open (tracked). */
export const firstRunOpen = () => firstRun();

/** Closes the first-run sheet for good. */
export function finishFirstRun(): void {
  firstRun.set(false);
  Storage.setItem(FIRST_RUN_DONE, "1").catch(() => {});
}

/** Closes everything open over the pages. */
export function closeOverlays(): void {
  batch(() => {
    nowPlaying.set(false);
    about.set(false);
    drawer.set(false);
  });
}
