// The keyboard in a list: the list is one stop of Tab, and while it has the
// focus the arrow keys move a highlight between its items (WAI-ARIA's
// listbox pattern, as the desktops' own lists do). Its items are no stops
// of their own (`Pressable`'s `focusable={false}`): a playlist of hundreds
// of rows would otherwise take hundreds of Tabs to get through.
//
// Lists stacked in a region (a page's header, songs and rows of cards; the
// sidebar's pages and library) form a group: Up and Down go on from one to
// the next, so the region moves as a grid, and the group is one stop of
// Tab, at the list the focus was last in: Tab goes from region to region.
//
// The highlight is one index of the list, kept here, not in the cells: a
// cell of a recycling `List` shows other items as it scrolls.

import { type RegionName, regionEntry } from "./regions";
import { cleanup, effect, keymap, type ListRef, reduceMotion, signal, untracked, type ViewRef, type ViewToken } from "nsh";

/** How a list reports its items in view: wholly shown ones only, so an item
 * cut by an edge is scrolled to. */
export const KEYS_VIEWABILITY = { itemVisibleThreshold: 1 } as const;

/** Items Page Up and Page Down move by when what the list shows is not known
 * yet. */
const PAGE = 8;

/** What a `List` shows wholly, as it reports it, and how to bring an item
 * into view: only when it is not wholly in it, to the edge it comes in
 * from (a step down lands it at the bottom, as lists do). `cover`: what
 * covers the list's end (the floating player), its height and the size of
 * an item, so the items under it count as out of view and one brought to
 * the end lands clear of it. */
function createViewport(cover?: { inset: () => number; itemSize: number }) {
  let list: ListRef | null = null;
  let first = -1;
  let last = -1;
  return {
    get first() {
      return first;
    },
    get last() {
      return last;
    },
    setRef(node: ListRef | ViewRef) {
      list = "scrollToIndex" in node ? (node as ListRef) : null;
    },
    report(info: { viewableItems: ViewToken<unknown>[] }) {
      let lo = -1;
      let hi = -1;
      for (const t of info.viewableItems) {
        if (!t.isViewable) continue;
        if (lo < 0 || t.index < lo) lo = t.index;
        if (t.index > hi) hi = t.index;
      }
      first = lo;
      last = hi;
    },
    reveal(i: number) {
      const inset = cover ? untracked(cover.inset) : 0;
      const covered = cover && inset > 0 ? Math.ceil(inset / cover.itemSize) : 0;
      if (!list || (first >= 0 && i >= first && i <= last - covered)) return;
      const before = first >= 0 && i < first;
      list.scrollToIndex({
        index: i,
        animated: !reduceMotion(),
        viewPosition: first < 0 ? 0.5 : before ? 0 : 1,
        // At the end: raised clear of what covers it.
        viewOffset: first >= 0 && !before ? -inset : 0,
      });
    },
  };
}

/** A list of a group, as the group moves the focus into it. */
interface GroupMember {
  /** Takes the focus: at `offset` items from its first in view (a row of
   * cards, keeping the column), or at its first or last item (`edge`: a
   * column of rows, entered from above or below); without `at`, where its
   * highlight was (the region entered again). */
  enter(at?: { offset: number; edge: "start" | "end" }): void;
}

/** Lists stacked on a page, in order: Up and Down go on from one to the
 * next. Bind `ref` and `onViewableItemsChange` on the list that holds them
 * when it is a `List` (Home's sections): one that is not made yet is
 * scrolled to first. */
export interface ListGroup {
  /** Whether the list at `order` is the group's stop of Tab (tracked): the
   * one the focus was last in, else the first. */
  isStop(order: number): boolean;
  /** The list at `order` took the focus. */
  focused(order: number): void;
  ref(node: ListRef): void;
  onViewableItemsChange(info: { viewableItems: ViewToken<unknown>[] }): void;
  /** Adds the list at `order`; returns what takes it out. */
  register(order: number, member: GroupMember): () => void;
  /** Moves the focus from the list at `from` to the next one up (`step`
   * -1) or down (1). False when there is none. */
  move(from: number, step: 1 | -1, offset: number): boolean;
}

/** Makes a group of lists. `count`: how many lists the `List` holding them
 * has (tracked), when it is one; without, the group is the lists it has.
 * `region`: the window's region it is (`focusRegion` comes back to where
 * the focus was in it), while `when` (a page on top of the stack). */
export function createListGroup(
  options: { count?: () => number; region?: RegionName; when?: () => boolean; cover?: { inset: () => number; itemSize: number } } = {},
): ListGroup {
  const members = new Map<number, GroupMember>();
  // Bumped as lists come and go, for `isStop`.
  const changed = signal(0);
  const last = signal(-1);
  const outer = createViewport(options.cover);
  let retry: ReturnType<typeof setTimeout> | null = null;
  // `focus()` only moves to a stop of Tab: the list the focus goes to is
  // made the group's stop first (its `focusable` changes before the focus
  // command, in the same batch).
  cleanup(() => {
    if (retry !== null) clearTimeout(retry);
  });
  const enter = (order: number, offset: number, edge: "start" | "end", tries: number) => {
    const member = members.get(order);
    outer.reveal(order);
    if (member) {
      last.set(order);
      member.enter({ offset, edge });
      return;
    }
    // Not made yet: the holding list makes it as it scrolls there.
    if (tries > 0) retry = setTimeout(() => enter(order, offset, edge, tries - 1), 60);
  };
  /** The list the group's stop is at (tracked): the one the focus was
   * last in, else the first; -1 while it has none. */
  const stop = () => {
    changed();
    const at = last();
    if (members.has(at)) return at;
    let lowest = -1;
    for (const o of members.keys()) if (lowest < 0 || o < lowest) lowest = o;
    return lowest;
  };
  // Its region's key brings the focus back to where it was in the group.
  if (options.region) regionEntry(options.region, () => members.get(untracked(stop))?.enter(), options.when);
  return {
    isStop: (order) => stop() === order,
    focused: (order) => last.set(order),
    ref: (node) => outer.setRef(node),
    onViewableItemsChange: (info) => outer.report(info),
    register(order, member) {
      members.set(order, member);
      changed.update((n) => n + 1);
      return () => {
        if (members.get(order) !== member) return;
        members.delete(order);
        changed.update((n) => n + 1);
      };
    },
    move(from, step, offset) {
      const edge = step > 0 ? "start" : "end";
      if (options.count) {
        const to = from + step;
        if (to < 0 || to >= untracked(options.count)) return false;
        enter(to, offset, edge, 8);
        return true;
      }
      // The nearest list that is there, that way.
      let to = -1;
      for (const o of members.keys()) if (step > 0 ? o > from && (to < 0 || o < to) : o < from && (to < 0 || o > to)) to = o;
      if (to < 0) return false;
      enter(to, offset, edge, 0);
      return true;
    },
  };
}

/** A list's keyboard: bind `ref`, `focusable={keys.focusable()}`, `onFocus`, `onBlur` and, on a
 * `List`, `onViewableItemsChange` (with `viewabilityConfig={KEYS_VIEWABILITY}`)
 * on the list; each item reads `isActive` for its highlight and calls
 * `pressed` when it is pressed. */
export interface ListKeys {
  /** Whether item `index` has the keyboard's highlight (tracked): only while
   * the list has the focus. */
  isActive(index: number): boolean;
  /** Whether the list is a stop of Tab (tracked): bind it as `focusable`. In
   * a group, only the group's stop is. */
  focusable(): boolean;
  /** The list's ref: a `List`'s, which it scrolls the highlight into view
   * with, or a plain view's around an `Each` (its scroll view's own). */
  ref(node: ListRef | ViewRef): void;
  onFocus(): void;
  onBlur(): void;
  onViewableItemsChange(info: { viewableItems: ViewToken<unknown>[] }): void;
  /** Item `index` was pressed: the keyboard goes on from it. */
  pressed(index: number): void;
}

/** Makes a list's keyboard. `count`: how many items it has (tracked).
 * `axis`: the way its items run. Along it, both pairs of arrows move: Up and
 * Left to the previous item, Down and Right to the next. In a `group`, at
 * `order` in it (tracked), the arrows across go on to the lists above and
 * below: a row's Up and Down, a column's Up past its first item and Down
 * past its last. With `columns` (a grid: tracked), Up and Down move a row
 * of the grid. Home and End go to the first and last item, Page Up and
 * Page Down (a column) by a screen. `activate`: what Return does to an
 * item (plays it, opens it). `start`: where the highlight starts the first
 * time Tab comes in (the playing track, the open playlist), else the first
 * item in view. `reveal`: brings the list into view as it takes the focus. */
export function createListKeys(options: {
  count: () => number;
  axis?: "vertical" | "horizontal";
  columns?: () => number;
  group?: ListGroup;
  order?: () => number;
  activate: (index: number) => void;
  start?: () => number;
  /** Brings the list itself into view as the focus comes in: one in a
   * list's header or footer, which the list it is in scrolls to. */
  reveal?: () => void;
  /** What covers the list's end (the floating player): its height and an
   * item's size, so items under it are scrolled clear of it. */
  cover?: { inset: () => number; itemSize: number };
}): ListKeys {
  const vertical = (options.axis ?? "vertical") === "vertical";
  const focused = signal(false);
  const active = signal(-1);
  const view = createViewport(options.cover);
  let node: ViewRef | null = null;
  let unbind: (() => void) | null = null;
  // Where the group asked the focus to land as it comes in.
  let entering: { offset: number; edge: "start" | "end" } | null = null;

  const count = () => untracked(options.count);
  const at = () => untracked(active);
  const order = () => untracked(() => options.order?.() ?? 0);
  const clamp = (i: number) => Math.max(0, Math.min(count() - 1, i));

  const moveTo = (i: number) => {
    if (count() === 0) return;
    const to = clamp(i);
    active.set(to);
    view.reveal(to);
  };
  const page = () => (view.first >= 0 && view.last > view.first ? view.last - view.first : PAGE);
  const columns = () => Math.max(1, untracked(() => options.columns?.() ?? 1));
  /** How far the highlight is into what shows: the column a row keeps as
   * the focus goes on to the next row. */
  const offsetInView = () => (view.first >= 0 ? Math.max(0, at() - view.first) : at());
  /** On to the list above or below, else the move `otherwise`. */
  const across = (step: 1 | -1, otherwise?: () => void) => () => {
    if (options.group?.move(order(), step, offsetInView())) return;
    otherwise?.();
  };

  const bind = () => {
    unbind?.();
    const previous = () => moveTo(at() - 1);
    const next = () => moveTo(at() + 1);
    const moves: Record<string, () => void> = {
      home: () => moveTo(0),
      end: () => moveTo(count() - 1),
    };
    if (options.columns) {
      // A grid: Left and Right along a row, Up and Down a row of it.
      moves.left = previous;
      moves.right = next;
      moves.up = () => (at() - columns() >= 0 ? moveTo(at() - columns()) : across(-1)());
      moves.down = () => (at() + columns() < count() ? moveTo(at() + columns()) : across(1)());
    } else if (vertical) {
      moves.up = () => (at() > 0 ? previous() : across(-1)());
      moves.down = () => (at() < count() - 1 ? next() : across(1)());
      moves.left = previous;
      moves.right = next;
      moves.pageup = () => moveTo(at() - page());
      moves.pagedown = () => moveTo(at() + page());
    } else {
      moves.left = previous;
      moves.right = next;
      // A row: across to the rows above and below; alone, along it.
      moves.up = across(-1, previous);
      moves.down = across(1, next);
    }
    const off = keymap.bind(moves, { when: "notEditing", repeat: true });
    const offReturn = keymap.bind(
      "enter",
      () => {
        const i = at();
        if (i >= 0 && i < count()) options.activate(i);
      },
      { when: "notEditing" },
    );
    unbind = () => {
      off();
      offReturn();
      unbind = null;
    };
  };
  cleanup(() => unbind?.());

  const member: GroupMember = {
    enter(at) {
      entering = at ?? null;
      node?.focus();
    },
  };
  if (options.group) {
    const group = options.group;
    let leave: (() => void) | null = null;
    effect(() => {
      const o = options.order?.() ?? 0;
      untracked(() => {
        leave?.();
        leave = group.register(o, member);
      });
    });
    cleanup(() => leave?.());
  }

  return {
    isActive: (index) => focused() && active() === index,
    focusable: () => (options.group ? options.group.isStop(options.order?.() ?? 0) : true),
    ref(n) {
      node = n;
      view.setRef(n);
    },
    onFocus() {
      const n = count();
      let i = at();
      const asked = entering;
      entering = null;
      if (asked) {
        i = vertical && !options.columns ? (asked.edge === "start" ? 0 : n - 1) : (view.first >= 0 ? view.first : 0) + asked.offset;
      } else if (n > 0 && (i < 0 || i >= n)) {
        const start = options.start ? untracked(options.start) : -1;
        i = start >= 0 && start < n ? start : view.first >= 0 ? view.first : 0;
      }
      focused.set(true);
      options.group?.focused(order());
      options.reveal?.();
      bind();
      if (n > 0) moveTo(i);
    },
    onBlur() {
      focused.set(false);
      unbind?.();
    },
    onViewableItemsChange: (info) => view.report(info),
    pressed(index) {
      active.set(index);
    },
  };
}
