// Motion over NSH's native animation: short entrances that explain where
// content came from. Every motion here honors the user's reduced-motion
// setting (NSH skips it then).
//
// A motion plays when it is created. Create it once, in a component body,
// and bind the style it gives: an `enter(...)` written inside a binding is
// created again, and so played again, whenever that binding re-runs. A
// component from `nsh/base` (a `Button`) reads all its props in one binding,
// so a prop that ticks (`selected` following the player) would replay it.

import {
  Animated,
  type AnimatedValue,
  cleanup,
  type CompositeAnimation,
  createAnimatedValue,
  createMotion,
  type Easing,
  effect,
  LayoutAnimation,
  platform,
  reduceMotion,
  signal,
  untracked,
  type Motion,
  type MotionName,
  type MotionOptions,
  type MotionSpec,
} from "nsh";
import { DURATION, EASING } from "./tokens";

/** A style that plays `preset` once when the view mounts; spread it into
 * `style`. Call it in a component body, or on a plain host view whose style
 * reads nothing else. */
export function enter(preset: MotionName = "fadeInUp", delay = 0) {
  return untracked(() => createMotion({ enter: preset, delay }).style);
}

// ---- Lean motions ----
//
// A list item's entrance moves two channels of a view (a row: its opacity
// and `translateX`; its cover: opacity and `rotateY`). `createMotion` makes
// an animated value for each of its nine channels (and two more nodes for
// the scale), so every cell of every list would cost eleven native nodes
// per motion, made, stopped and released with it. These make only the
// channels that move, and play the same keyframes on them with the same
// timing (`Animated.keyframes` is what a motion runs on each channel).

/** The channels lean motions move, with where each rests. */
const REST = { opacity: 1, translateX: 0, translateY: 0, rotateX: 0, rotateY: 0 } as const;
type LeanChannel = keyof typeof REST;

/** Keyframes of each channel, played with one timing (`MotionSpec`'s
 * per-channel form). */
interface LeanSpec<C extends LeanChannel> {
  tracks: Record<C, { offset: number; value: number }[]>;
  duration: number;
  easing: Easing;
}

/** Animated values for `channels` only, at rest, and keyframes to play on
 * them; as a `Motion` plays, honouring reduced motion (it lands where it
 * ends). */
function leanMotion<C extends LeanChannel>(channels: readonly C[]) {
  const values = {} as Record<C, AnimatedValue>;
  for (const c of channels) values[c] = createAnimatedValue(REST[c]);
  let running: CompositeAnimation | null = null;
  const stop = () => {
    running?.stop();
    running = null;
  };
  return {
    values,
    play(spec: LeanSpec<C>, delay: number) {
      stop();
      if (reduceMotion()) {
        for (const c of channels) {
          const track = spec.tracks[c];
          values[c].set(track[track.length - 1].value);
        }
        return;
      }
      running = Animated.parallel(
        channels.map((c) =>
          Animated.keyframes(values[c], { keyframes: spec.tracks[c], duration: spec.duration, easing: spec.easing, delay }),
        ),
      );
      void running.start();
    },
    stop,
    /** Stops it and puts every channel back at rest. */
    reset() {
      stop();
      for (const c of channels) values[c].set(REST[c]);
    },
  };
}

/** A motion made the first time it is wanted (`get()`): until then its
 * `style` binds nothing, which looks the same (a motion at rest changes
 * nothing), so a control that may never move (a glyph never hovered, never
 * swapped) makes no native nodes, and none are stopped and released when
 * it goes. Read `style` where it binds (`style={m.style}`): it follows. */
export function lazyMotion(options?: MotionOptions) {
  const made = signal<Motion | null>(null);
  const get = (): Motion => {
    let m = untracked(made);
    if (!m) {
      m = createMotion(options);
      made.set(m);
    }
    return m;
  };
  return {
    /** The motion's style once it is made (tracked). */
    get style() {
      return made()?.style;
    },
    /** The motion, made now if it was not. */
    get,
    /** Plays `motion` (making it first). */
    play(motion: MotionName | MotionSpec, play?: Parameters<Motion["play"]>[1]) {
      return get().play(motion, play);
    },
    /** Stops it where it is (nothing if never made). */
    stop() {
      untracked(made)?.stop();
    },
    /** Puts it back at rest (nothing if never made: it is at rest). */
    reset() {
      untracked(made)?.reset();
    },
  };
}

/** The curve a list's items come in on: a cubic ease-out. Gentler at the
 * start than `SMOOTH_OUT`, which covers most of the way at once, so the
 * staircase a wave draws (each item a step behind the one before) stays
 * readable while it runs. */
const WAVE_EASE: [number, number, number, number] = [0.33, 1, 0.68, 1];

/** How far a list's items travel as they come in, points (each a little
 * more or less: `WAVE_VARY`). */
const WAVE_DISTANCE = 24;

/** An item sliding in along `axis` from `distance` points away (positive:
 * from the right, or from below) while it fades in, in one segment. A row comes in with `translateX` (NSH's
 * `fadeInRight`: right to left), a card with `translateY` (`fadeInUp`); each
 * as one piece.
 *
 * Keyframes ease each segment on its own (as CSS does): an overshoot as a
 * second segment starts the curve again, so the item all but stops short of
 * its place and then jumps the rest of the way, a visible hitch. The slide
 * is one segment; only the fade, which holds once it is in, has two. */
function slideIn<A extends "translateX" | "translateY">(axis: A, distance: number, duration: number): LeanSpec<"opacity" | A> {
  return {
    tracks: {
      opacity: [
        { offset: 0, value: 0 },
        { offset: 0.6, value: 1 },
        { offset: 1, value: 1 },
      ],
      [axis]: [
        { offset: 0, value: distance },
        { offset: 1, value: 0 },
      ],
    } as LeanSpec<"opacity" | A>["tracks"],
    duration,
    easing: WAVE_EASE,
  };
}

/** A skeleton's pulse (transitions.dev "Skeleton loader and reveal"): its
 * shapes dim to half and back, once a second, while the content loads. */
export const SKELETON_PULSE: MotionSpec = {
  keyframes: { opacity: [1, 0.5, 1] },
  duration: 1000,
  easing: EASING.inOut,
  iterations: "infinite",
};

/** The reveal: the skeleton fades out as the content fades in over it, both
 * over the same time. (The reference also cross-blurs them by 2px; NSH
 * cannot animate a filter, so it is a cross-fade alone.) */
export const REVEAL_IN: MotionSpec = {
  keyframes: { opacity: [0, 1] },
  duration: DURATION.slow,
  easing: EASING.inOut,
};
export const REVEAL_OUT: MotionSpec = {
  keyframes: { opacity: [1, 0] },
  duration: DURATION.slow,
  easing: EASING.inOut,
};

/** The wave lists enter in: each item about a step after the one before it
 * (rows top to bottom, cards left to right), so the items in motion form a
 * staircase, uneven (`WAVE_VARY`): items differ in pace, and neighbours now
 * and then trade places:
 *
 *     --
 *      --
 *       --
 *
 * Only about a screen's worth wait their turn; items past them come in with
 * the last, so the last turn starts within about 0.6s even after a reveal
 * (180 + 11 x 36 + 50 = 626ms). */
export const WAVE = {
  /** Between one item and the next, ms. */
  step: 36,
  /** How many rows down a list take a turn. */
  rows: 12,
  /** How many cards across a row take a turn. */
  cards: 8,
  /** Where an item's wave starts when shown at once (cached). */
  start: 16,
} as const;

/** A fixed pseudo-random number in 0..1 for item `index` (and `salt`, for
 * independent draws): the same for the same item on every render, so the
 * small irregularities never reshuffle. */
function scatter(index: number, salt: number): number {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** How much items of a wave differ, so the staircase reads as made by hand,
 * not by a ruler. Each is a fixed draw per item (`scatter`). */
const WAVE_VARY = {
  /** The most an item starts later than its turn, ms: over a step, so now
   * and then an item starts before the one above it, while the wave still
   * runs top to bottom (or left to right) overall. */
  lag: 50,
  /** Distance, as a share either way (24pt: 19 to 29). */
  distance: 0.2,
  /** Duration, as a share either way: some items quicker, some slower. */
  duration: 0.2,
} as const;

/** `base` moved by up to `share` either way, by draw `t` (0..1). */
const vary = (base: number, share: number, t: number) => base * (1 - share + 2 * share * t);

/** How long each item of a wave takes to come in. */
const WAVE_DURATION = DURATION.slow;

/** When items that loaded start their wave: as the skeleton is half gone. */
export const AFTER_REVEAL = DURATION.slow / 2;

/** How long the item at `index` waits in a wave of `turns` items. */
export function waveDelay(index: number, turns: number): number {
  return waveDelayBy(index, turns, WAVE.step);
}

function waveDelayBy(index: number, turns: number, step: number): number {
  return Math.min(index, turns - 1) * step;
}

/** Which way a cover turns as it flips open: about its vertical axis
 * (`rotateY`) or its horizontal one (`rotateX`), from edge-on on one side
 * (`from`: 90° or -90°). */
interface CoverTurn {
  channel: "rotateX" | "rotateY";
  from: number;
}

/** A row's cover turns as the row moves: its left edge swings in toward the
 * viewer, following the row in from the right. */
const ROW_TURN: CoverTurn = { channel: "rotateY", from: -90 };
/** A card's cover turns any of four ways (left, right, up, down), a fixed
 * draw per card, so a row of cards doesn't flip in step. */
const CARD_TURNS: CoverTurn[] = [
  { channel: "rotateY", from: -90 },
  { channel: "rotateY", from: 90 },
  { channel: "rotateX", from: 90 },
  { channel: "rotateX", from: -90 },
];

/** A cover flipping open (NSH's `flipInY` / `flipInX`, in our tokens) over
 * `duration`: it turns from edge-on to face the viewer in one segment (an
 * overshoot would restart the curve: see `slideIn`), fading in over the
 * first part of the turn. The other axis stays at rest. */
function coverFlipSpec(turn: CoverTurn, duration: number): LeanSpec<"opacity" | "rotateX" | "rotateY"> {
  const still = [
    { offset: 0, value: 0 },
    { offset: 1, value: 0 },
  ];
  const turning = [
    { offset: 0, value: turn.from },
    { offset: 1, value: 0 },
  ];
  return {
    tracks: {
      opacity: [
        { offset: 0, value: 0 },
        { offset: 0.5, value: 1 },
        { offset: 1, value: 1 },
      ],
      rotateX: turn.channel === "rotateX" ? turning : still,
      rotateY: turn.channel === "rotateY" ? turning : still,
    },
    duration,
    easing: WAVE_EASE,
  };
}

/** How far the viewer is from a flipping cover, points: near enough that the
 * turn reads as 3D, far enough that its near edge doesn't balloon. */
const COVER_PERSPECTIVE = 600;

/** An item comes in in layers, each on its own timeline: the item itself
 * (the staircase), then its cover's flip and its words' slide, each this
 * long after the item starts, ms, plus up to `spread` of its own, drawn
 * apart, so sometimes the cover leads, sometimes the words. */
const LAYER_LAG = {
  cover: { base: 30, spread: 100 },
  text: { base: 50, spread: 110 },
} as const;

/** How far an item's words travel on top of the item, points (a little more
 * or less: `WAVE_VARY.distance`). */
const TEXT_DISTANCE = 10;

/** A terminal draws no motion. */
const platformTerminal = () => platform.idiom === "terminal";

// ---- List waves ----
//
// A list's items come in as a wave when its page opens (going back to it in
// the stack shows it as it was, with nothing coming in), and an item that comes into view later (a
// row scrolled to, a card scrolled across, new search results) comes in on
// its own (several at once: a short staircase, in order). Each item comes in once: a
// recycled cell given an item already shown, a re-render or a playback tick
// does nothing. An item's motions are made once, in its body; an effect on
// its key and the page's entries plays them.

/** How long after the page is entered (or the content shows) its items
 * still come in as a wave; items shown after that come in on their own. */
const OPENING = 900;
/** Items shown later (scrolled to) in the same moment come in as a short
 * staircase of their own: this long apart, ms, the first at once. */
const LATE_STEP = 16;
/** How many of them take a turn; the rest come in with the last. */
const LATE_TURNS = 6;

/** A list's entrances: one per list (a child per card row), made where the
 * list's content is made. */
export interface ListWave {
  /** How many times the page has been entered (tracked): 0 while it is not
   * shown yet, then 1, and one more each time it is opened again (a root
   * chosen again: `reenter`). Going back to it doesn't enter it again. */
  entry(): number;
  /** Asks to bring item `key` (at `index`) in; `run` gets its delay, ms,
   * after the items asked for in the same moment are put in order. False
   * when it already came in during this entry. */
  request(key: string, index: number, turns: number, run: (delay: number) => void): boolean;
  /** Starts a new wave for items not shown yet (a new search's results). */
  restart(): void;
  /** A wave of its own over the same entries, starting `offset` ms later (a
   * row of cards in a page). */
  child(offset?: number): ListWave;
}

/** Makes a list's wave. `isTop`: whether its page is the one shown
 * (tracked). `reenter`: a count (tracked) that goes up each time the page is
 * opened anew (a root chosen from the sidebar or a tab, even while shown:
 * `rootOpens`); its items come in again then. `afterReveal`: its content
 * took a skeleton's place, so the first wave waits for the skeleton to half
 * fade. */
export function createListWave(options: { isTop: () => boolean; reenter?: () => number; afterReveal?: boolean }): ListWave {
  const made = Date.now();
  // Entered when it first shows, and again when it is opened anew while or
  // as it shows. Going back to it (a pop) shows it as it was, with nothing
  // coming in again: an opening seen while the page was not shown is taken
  // as seen, so it does not replay once the page is gone back to.
  const entries = signal(untracked(options.isTop) ? 1 : 0);
  let seenOpens = untracked(() => options.reenter?.() ?? 0);
  let windowStart = made;
  effect(() => {
    const top = options.isTop();
    const opens = options.reenter?.() ?? 0;
    untracked(() => {
      const opened = opens !== seenOpens;
      seenOpens = opens;
      if (!top) return;
      if (entries() > 0 && !opened) return;
      windowStart = Date.now();
      entries.set(entries() + 1);
    });
  });
  const start = () => (options.afterReveal && windowStart === made ? AFTER_REVEAL : WAVE.start);
  const make = (offset: number, restartAt: { at: number }): ListWave => {
    const seen = new Map<string, number>();
    let pending: { index: number; turns: number; run: (delay: number) => void }[] = [];
    const flush = () => {
      const batch = pending.sort((a, b) => a.index - b.index);
      pending = [];
      const now = Date.now();
      const opening = now - Math.max(windowStart, restartAt.at) < OPENING;
      batch.forEach((item, rank) => {
        item.run(
          opening
            ? start() + offset + waveDelay(rank, item.turns) + Math.round(scatter(item.index, 0) * WAVE_VARY.lag)
            : waveDelayBy(rank, LATE_TURNS, LATE_STEP),
        );
      });
    };
    return {
      entry: () => entries(),
      request(key, index, turns, run) {
        const entry = untracked(entries);
        if (entry === 0 || seen.get(key) === entry) return false;
        seen.set(key, entry);
        if (pending.length === 0) void Promise.resolve().then(flush);
        pending.push({ index, turns, run });
        return true;
      },
      restart() {
        restartAt.at = Date.now();
      },
      child(childOffset = 0) {
        return make(offset + childOffset, restartAt);
      },
    };
  };
  return make(0, { at: 0 });
}

/** An item's entrance in its list's wave, in three layers on their own
 * timelines: the item (`axis`: a row slides in right to left, a card rises),
 * then its cover's flip and its words' shorter slide, each with its own lag
 * and pace (`LAYER_LAG`, `WAVE_VARY`: fixed draws per item). A row's cover
 * turns in from the right; a card's (`turns: WAVE.cards`) any of four ways.
 * Played when `key` first shows in an entry. Call it once, in the item's
 * body; bind `style` on the item, `cover` on a view around its cover and
 * `text` on a view around its words. Nothing in a terminal or without a
 * wave. */
export function listItemEntrance(options: {
  wave: ListWave | undefined;
  key: () => string;
  index: () => number;
  axis: "translateX" | "translateY";
  turns: number;
  /** How its cover turns: `"row"` (in from the right, with the row) or
   * `"any"` (a card: one of four ways). */
  coverTurn?: "row" | "any";
}) {
  const wave = options.wave;
  if (!wave || platformTerminal()) return { style: undefined, cover: undefined, text: undefined };
  const axis = options.axis;
  const anyTurn = options.coverTurn === "any";
  // Only the channels that move (`leanMotion`): made once per cell. A card's
  // cover may turn about either axis; a row's only about its vertical one.
  const item = leanMotion(["opacity", axis] as const);
  const words = leanMotion(["opacity", axis] as const);
  const flip = leanMotion<"opacity" | "rotateX" | "rotateY">(anyTurn ? ["opacity", "rotateX", "rotateY"] : ["opacity", "rotateY"]);
  let last = "";
  let lastEntry = -1;
  let seq = 0;
  effect(() => {
    const key = options.key();
    const entry = wave.entry();
    untracked(() => {
      if (key === last && entry === lastEntry) return;
      last = key;
      lastEntry = entry;
      const ticket = ++seq;
      const index = options.index();
      if (!key) return;
      const distance = vary(WAVE_DISTANCE, WAVE_VARY.distance, scatter(index, 1));
      const textDistance = vary(TEXT_DISTANCE, WAVE_VARY.distance, scatter(index, 6));
      const turn = anyTurn ? CARD_TURNS[Math.floor(scatter(index, 7) * CARD_TURNS.length)] : ROW_TURN;
      const shown = wave.request(key, index, options.turns, (delay) => {
        if (ticket !== seq) return;
        const pace = (salt: number) => Math.round(vary(WAVE_DURATION, WAVE_VARY.duration, scatter(index, salt)));
        const lag = (layer: { base: number; spread: number }, salt: number) =>
          layer.base + Math.round(scatter(index, salt) * layer.spread);
        item.play(slideIn(axis, distance, pace(2)), delay);
        flip.play(coverFlipSpec(turn, pace(4)), delay + lag(LAYER_LAG.cover, 3));
        words.play(slideIn(axis, textDistance, pace(8)), delay + lag(LAYER_LAG.text, 9));
      });
      if (shown) {
        // Hidden where each layer starts until its turn comes.
        item.values.opacity.set(0);
        item.values[axis].set(distance);
        words.values.opacity.set(0);
        words.values[axis].set(textDistance);
        flip.values.opacity.set(0);
        flip.values[turn.channel].set(turn.from);
      } else {
        // Shown before in this entry (a cell given it back): at rest.
        item.reset();
        words.reset();
        flip.reset();
      }
    });
  });
  cleanup(() => {
    item.stop();
    words.stop();
    flip.stop();
  });
  // As a motion's style binds them; the channels at rest are left out (they
  // change nothing).
  const along = (v: AnimatedValue) => (axis === "translateX" ? { translateX: v } : { translateY: v });
  return {
    style: { opacity: item.values.opacity, transform: [along(item.values[axis])] },
    cover: {
      opacity: flip.values.opacity,
      transform: anyTurn
        ? [{ perspective: COVER_PERSPECTIVE }, { rotateX: flip.values.rotateX }, { rotateY: flip.values.rotateY }]
        : [{ perspective: COVER_PERSPECTIVE }, { rotateY: flip.values.rotateY }],
    },
    text: { opacity: words.values.opacity, transform: [along(words.values[axis])] },
  };
}

/** Animates the layout when `step` changes (a breakpoint is crossed: the
 * sidebar opens or narrows, the player bar or Now Playing rearranges):
 * what moves or resizes glides there, what comes or goes fades. Not on every
 * size change (a window being dragged follows the pointer at once), only
 * when the arrangement does. */
export function animateLayoutOn(step: () => string): void {
  let last: string | null = null;
  effect(() => {
    const now = step();
    if (last !== null && now !== last && !reduceMotion()) {
      const curve = { type: "easeInEaseOut" as const };
      LayoutAnimation.configureNext({
        duration: DURATION.base,
        update: curve,
        create: { ...curve, property: "opacity" },
        delete: { ...curve, property: "opacity" },
      });
    }
    last = now;
  });
}
