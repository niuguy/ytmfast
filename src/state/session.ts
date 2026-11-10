// The session: who is signed in, and when data may load anew. The account
// keys the cache (one account never sees another's); `epoch` goes up when
// the player gets ready, the account changes or a new token is signed, so
// pages that failed or are stale load again.

import { effect, signal, Storage, untracked } from "nsh";
import { clearAccount, hydrate } from "../data/cache";
import { resetNav } from "../nav";
import { backend } from "./engine";
import { notify, report } from "./feedback";
import { closeOverlays } from "./overlays";

/** The last signed-in account, so its cache shows at once on launch. */
const LAST_ACCOUNT = "session:account";
/** The cache's account while signed out. */
const SIGNED_OUT = "signed-out";

const account = signal<string | null>(null);
const epoch = signal(0);

void hydrate();
Storage.getItem(LAST_ACCOUNT)
  .then((id) => {
    if (id && account() === null && backend.signedIn() !== false) account.set(id);
  })
  .catch(() => {});

// A new epoch: the player became ready, or the account changed.
let wasReady = false;
effect(() => {
  const ready = backend.health().status === "ready";
  untracked(() => {
    if (ready && !wasReady) epoch.update((e) => e + 1);
    wasReady = ready;
  });
});

let lastSignedIn: boolean | null = null;
effect(() => {
  const signedIn = backend.signedIn();
  untracked(() => {
    if (signedIn === lastSignedIn) return;
    const was = lastSignedIn;
    lastSignedIn = signedIn;
    if (signedIn === false) account.set(null);
    if (was !== null) epoch.update((e) => e + 1);
  });
});

backend.onAuth(() => epoch.update((e) => e + 1));

// Learn the account's id once signed in (and after each new epoch).
effect(() => {
  const e = epoch();
  if (backend.signedIn() !== true) return;
  backend
    .me()
    .then((me) => {
      if (e !== untracked(epoch) || backend.signedIn() !== true || !me.id) return;
      if (account() !== me.id) account.set(me.id);
      Storage.setItem(LAST_ACCOUNT, me.id).catch(() => {});
    })
    .catch((error) => console.warn("spotish: couldn't read the account:", String(error)));
});

/** The session's status (tracked). */
export const health = () => backend.health();

/** Whether the player is ready for controls (tracked). */
export const ready = () => backend.health().status === "ready";

/** Whether an account is signed in; null while unknown (tracked). */
export const signedIn = () => backend.signedIn();

/** The signed-in account's id, null until known (tracked). */
export const accountId = () => account();

/** What the cache keys this session's data by: the account, or the
 * signed-out space; null while the account is not known yet (tracked). */
export function cacheAccount(): string | null {
  const s = backend.signedIn();
  if (s === false) return SIGNED_OUT;
  return account();
}

/** Goes up when data may load anew (tracked). */
export const dataEpoch = () => epoch();

/** Opens Spotify's login. */
export function signIn(): void {
  backend.signIn().catch((error) => report("signInFailed", error));
}

/** Closes Spotify's login without signing in. */
export function cancelSignIn(): void {
  backend.cancelSignIn().catch((error) => console.warn("spotish: cancel sign-in:", String(error)));
}

/** Signs out: forgets the account's cache, goes back to Home and closes
 * what was open over the pages. */
export async function signOut(): Promise<void> {
  const id = account();
  account.set(null);
  closeOverlays();
  resetNav();
  Storage.removeItem(LAST_ACCOUNT).catch(() => {});
  if (id) await clearAccount(id);
  try {
    await backend.signOut();
  } catch (error) {
    console.warn("spotish: sign out:", String(error));
  }
}

/** Starts the failed session again. */
export function retry(): void {
  backend.retry().catch((error) => report("retryFailed", error));
}

/** Asks the signed-out user to log in (a toast with a Log in button). */
export function askToSignIn(): void {
  notify("signInToPlay", { label: "Log in", run: signIn });
}
