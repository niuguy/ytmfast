// The main content's navigation: one stack for every shell. Home and Search
// (and the phone's Liked Songs) are roots (choosing one replaces the stack);
// collections are pushed on top.
// Desktop's Back and Forward move through it; Forward re-opens what Back
// (or the system's back: Escape, Alt+Left, the mouse's back button, Android's
// back) took off.

import { batch, effect, signal, untracked } from "nsh";
import { createNavStack } from "nsh/base";

/** A page of the main content. */
export type Route = { name: "home" } | { name: "search" } | { name: "collection"; uri: string };

/** The root routes: the same objects every time, so a stack that keeps one
 * keeps its page. */
export const HOME: Route = { name: "home" };
export const SEARCH: Route = { name: "search" };
/** Liked Songs as a root: the phone's tab. */
export const LIKED: Route = { name: "collection", uri: "ytm:collection:LM" };

/** The stack (made once: it keeps its pages across hot updates). */
export const nav = createNavStack<Route>([HOME]);

/** How pages come and go for the change being made: the sidebar's choice
 * is a switch between places (a cross-fade), Back, Forward and opening a
 * card move through the stack (the slide). Each page reads it as it is
 * shown and as it leaves (`AppPage`). */
const motion = signal<"slide" | "fade">("slide");
export const pageAnimation = () => motion();
let settle: ReturnType<typeof setTimeout> | null = null;

/** Opens `route` from the sidebar: a switch, not a step through the stack. */
export function switchTo(route: Route): void {
  if (settle !== null) clearTimeout(settle);
  motion.set("fade");
  open(route);
  // Back to the stack's own motion once this change is under way, for the
  // system's back (Escape, the mouse's back button) and the rest.
  settle = setTimeout(() => {
    settle = null;
    motion.set("slide");
  }, 400);
}

/** The most pages kept above the root. Each page in the stack stays alive
 * (its list, its views, its covers), so a stack that only grew would hold
 * every page visited: past this, the oldest go once the new page is in.
 * Their data stays cached, so going to one again shows it at once; only
 * Back no longer reaches it. */
export const MAX_PAGES = 4;
/** After a push's slide, so trimming the bottom does not disturb it. */
const TRIM_AFTER_MS = 600;
let trimTimer: ReturnType<typeof setTimeout> | null = null;

function trimSoon(): void {
  if (trimTimer !== null) clearTimeout(trimTimer);
  trimTimer = setTimeout(() => {
    trimTimer = null;
    const routes = nav.routes();
    if (routes.length <= MAX_PAGES + 1) return;
    // The same route objects: the stack keeps the pages it still has.
    // What is ahead stays: nothing on top changed.
    intent = { kind: "keep" };
    nav.setRoutes([routes[0], ...routes.slice(routes.length - MAX_PAGES)]);
  }, TRIM_AFTER_MS);
}

/** Routes Back took off, the next Forward last. */
const ahead = signal<Route[]>([]);
/** What the app's own change of the stack means for what is ahead: Forward
 * keeps the rest, opening a page or a root clears it. Read by the effect
 * below when it sees the change. */
let intent: { kind: "forward"; route: Route } | { kind: "clear" } | { kind: "keep" } | null = null;
let previous: readonly Route[] = nav.routes();

// Hear every change of the stack, the system's back included: a pop puts
// what it took off ahead; Forward keeps the rest; anything else clears it.
effect(() => {
  const routes = nav.routes();
  untracked(() => {
    const before = previous;
    previous = routes;
    const mine = intent;
    intent = null;
    if (mine?.kind === "clear") {
      ahead.set([]);
      return;
    }
    if (mine?.kind === "keep") return;
    if (mine?.kind === "forward" && routes[routes.length - 1] === mine.route) return;
    const popped = routes.length < before.length && routes.every((r, i) => r === before[i]);
    if (popped) ahead.update((a) => [...a, ...before.slice(routes.length).reverse()]);
    else if (routes.length !== before.length || routes.some((r, i) => r !== before[i])) ahead.set([]);
  });
});

function same(a: Route | undefined, b: Route): boolean {
  if (!a || a.name !== b.name) return false;
  return a.name !== "collection" || (b.name === "collection" && a.uri === b.uri);
}

/** The page on top (tracked where it is read). */
export function currentRoute(): Route {
  const routes = nav.routes();
  return routes[routes.length - 1];
}

/** The root the stack starts at: Home, Search or, from the phone's tab,
 * Liked Songs (tracked). */
export function currentRoot(): Route {
  return nav.routes()[0];
}

/** Opens `route`: a root replaces the stack. A collection already in the
 * stack is gone back to (Back's motion, its page as it was); the next one
 * ahead is gone forward to; any other is pushed (Forward's motion). */
export function open(route: Route): void {
  if (route.name === "home" || route.name === "search") {
    openRoot(route.name === "home" ? HOME : SEARCH);
    return;
  }
  if (same(currentRoute(), route)) return;
  const routes = nav.routes();
  for (let i = routes.length - 2; i >= 0; i--) {
    if (same(routes[i], route)) {
      nav.pop(routes.length - 1 - i);
      return;
    }
  }
  if (same(ahead()[ahead().length - 1], route)) {
    forward();
    return;
  }
  intent = { kind: "clear" };
  nav.push(route);
  trimSoon();
}

/** How many times a root has been opened (tracked): from the sidebar or a
 * tab, even the one shown. A root's page kept in the stack is entered anew
 * then (its lists come in again: `createListWave`'s `reenter`); gone back to
 * with Back, it is not. */
const rootOpenCount = signal(0);
export const rootOpens = () => rootOpenCount();

/** Makes `root` (`HOME`, `SEARCH`, `LIKED`) the stack's root: back to it
 * when it is already, else the stack replaced; nothing ahead. */
export function openRoot(root: Route): void {
  batch(() => {
    rootOpenCount.update((n) => n + 1);
    if (nav.routes().length === 1 && nav.routes()[0] === root) return;
    intent = { kind: "clear" };
    if (nav.routes()[0] === root) nav.popToRoot();
    else nav.setRoutes([root]);
  });
}

/** Whether Back has a page to go to (tracked). */
export const canBack = () => nav.routes().length > 1;

/** Whether Forward has a page to go to (tracked). */
export const canForward = () => ahead().length > 0;

export function back(): void {
  if (nav.routes().length > 1) nav.pop();
}

export function forward(): void {
  const next = ahead()[ahead().length - 1];
  if (!next) return;
  ahead.update((a) => a.slice(0, -1));
  intent = { kind: "forward", route: next };
  nav.push(next);
  trimSoon();
}

/** Back to Home, with nothing ahead (signing out). */
export function resetNav(): void {
  batch(() => {
    const routes = nav.routes();
    if (routes.length !== 1 || routes[0] !== HOME) {
      intent = { kind: "clear" };
      nav.setRoutes([HOME]);
    }
    ahead.set([]);
  });
}
