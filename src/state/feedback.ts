// What the app tells the user: short toasts from one catalog of messages.
// Each message has an id, so showing one again replaces it rather than
// stacking a copy, and different messages stack instead of overwriting each
// other. Details of failures go to the log, never into a toast.

import { platform, signal } from "nsh";
import { type ToastEntry, ToastManager } from "nsh/base";
import { type BackendError, errorOf } from "../backend/types";

/** Every message the app shows as a toast. */
export const MESSAGES = {
  signInToPlay: "Log in to Spotify to play music.",
  playFailed: "Couldn't play this. Try again.",
  likeFailed: "Couldn't update Liked Songs. Try again.",
  signInFailed: "Couldn't open the Spotify login. Try again.",
  retryFailed: "Spotify still isn't available. Quit Spotish and open it again.",
  freeShuffles: "Spotify Free shuffles playlists. Premium lets you pick any song.",
} as const;

export type MessageId = keyof typeof MESSAGES;

/** A button on a toast: its label and what it does (the toast closes). */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** What one toast shows. */
export interface ToastContent {
  text: string;
  action?: ToastAction;
}

/** How many show at once. */
const LIMIT = 3;
const TICK = 100;
const TIMEOUT = 5000;
const terminal = platform.idiom === "terminal";

const manager = new ToastManager(terminal ? { exitDuration: 0 } : undefined);
const shown = signal<ToastEntry[]>([]);
const contents = signal<Record<string, ToastContent>>({});
const expanded = signal(false);
let ticking: ReturnType<typeof setInterval> | undefined;

function sync() {
  shown.set(manager.visible(LIMIT));
}

function tick() {
  const advanced = manager.advance(expanded());
  if (advanced.removed.length) {
    const next = { ...contents() };
    for (const gone of advanced.removed) delete next[gone.id];
    contents.set(next);
  }
  if (advanced.changed) sync();
  if (manager.isEmpty() && ticking !== undefined) {
    clearInterval(ticking);
    ticking = undefined;
  }
}

/** Shows the message `id`, with an optional action; again replaces it. */
export function notify(id: MessageId, action?: ToastAction): void {
  contents.set({ ...contents(), [id]: { text: MESSAGES[id], action } });
  manager.push(id, id, { timeout: action ? TIMEOUT * 2 : TIMEOUT });
  sync();
  ticking ??= setInterval(tick, TICK);
}

/** Shows a message that is not in the catalog (the updater's, which words
 * its own); the same text again replaces it. */
export function announce(text: string, action?: ToastAction): void {
  const id = `text:${text}`;
  contents.set({ ...contents(), [id]: { text, action } });
  manager.push(id, id, { timeout: action ? TIMEOUT * 2 : TIMEOUT });
  sync();
  ticking ??= setInterval(tick, TICK);
}

/** Logs a failure's details and shows the message `id` for it. */
export function report(id: MessageId, error: unknown, action?: ToastAction): BackendError {
  const parsed = errorOf(error);
  console.warn(`spotish: ${id}: ${parsed.code}: ${parsed.message}`);
  notify(id, action);
  return parsed;
}

/** Closes the toast `id`. */
export function dismiss(id: string): void {
  manager.dismiss(id);
  sync();
  ticking ??= setInterval(tick, TICK);
}

/** Closes the newest toast (Escape, back). */
export function dismissNewest(): void {
  const newest = shown().filter((e) => e.status !== "ending").at(-1);
  if (newest) dismiss(newest.id);
}

/** Runs a toast's action and closes it. */
export function choose(id: string): void {
  const action = contents()[id]?.action;
  dismiss(id);
  action?.run();
}

/** The toasts to draw, oldest first (tracked). */
export const toasts = () => shown();

/** What toast `id` shows (tracked). */
export const toastContent = (id: string): ToastContent | undefined => contents()[id];

/** Whether the message `id` shows now (tracked). */
export const showing = (id: MessageId) => shown().some((e) => e.id === id && e.status !== "ending");

/** The stack was expanded or collapsed: toasts wait while it is open. */
export function setToastsExpanded(open: boolean): void {
  expanded.set(open);
}
