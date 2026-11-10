// The window's regions, as a tiling window manager's windows: the header,
// the sidebar, the page and the player. Ctrl and an arrow moves the keyboard
// focus to the region that way (Ctrl+Left the sidebar, Ctrl+Right the page,
// Ctrl+Up the header, Ctrl+Down the player); inside one, the arrows move
// (`createListKeys`, `Toolbar`). Tab still goes through every stop.

import { cleanup, context, keymap, untracked, type ViewRef } from "nsh";

export type RegionName = "header" | "sidebar" | "main" | "player";

/** The region what renders inside is in: a toolbar's buttons register with
 * it (`regionItem`). `when`: whether it is shown now (a page's header, while
 * its page is on top of the stack). */
export const Region = context<{ name: RegionName; when?: () => boolean } | null>(null);

/** The ways into each region: each tries to focus a view of it. */
const entries = new Map<RegionName, Set<() => void>>();

/** Adds a way into `region` for the component's lifetime. `enter` focuses
 * one of its views (a stop of it); `when` (tracked or not) says whether it
 * is shown now (a page under the top of the stack is not). */
export function regionEntry(region: RegionName, enter: () => void, when?: () => boolean): void {
  const entry = () => {
    if (!when || untracked(when)) enter();
  };
  let set = entries.get(region);
  if (!set) entries.set(region, (set = new Set()));
  set.add(entry);
  cleanup(() => set.delete(entry));
}

/** For a button in a `Toolbar`: a ref that registers it with the region
 * it is in. Asked to, every button of the toolbar is focused, and only its
 * stop (the one the focus last left) takes it: the others are no stops.
 * Outside a region it does nothing. Call once, in the component's body. */
export function regionItem(): (node: ViewRef) => void {
  const region = untracked(Region);
  if (!region) return () => {};
  let node: ViewRef | null = null;
  regionEntry(region.name, () => node?.focus(), region.when);
  return (n) => {
    node = n;
  };
}

/** Moves the keyboard focus into `region`. */
export function focusRegion(region: RegionName): void {
  for (const enter of [...(entries.get(region) ?? [])]) enter();
}

/** The keys between the regions. Ctrl, not the platform's command key: as
 * a window manager's, the same on every platform; in a text field Ctrl and
 * an arrow stay the field's (by word, to an end). */
export const REGION_KEYS: { keystroke: string; region: RegionName; label: string }[] = [
  { keystroke: "ctrl+left", region: "sidebar", label: "Sidebar" },
  { keystroke: "ctrl+right", region: "main", label: "Page" },
  { keystroke: "ctrl+up", region: "header", label: "Header" },
  { keystroke: "ctrl+down", region: "player", label: "Player" },
];

/** Binds Ctrl and the arrows (once, in the app's root). */
export function bindRegionKeys(): void {
  for (const k of REGION_KEYS) keymap.bind(k.keystroke, () => focusRegion(k.region));
}
