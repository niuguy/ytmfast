// Motion tokens: the one set of durations, easings, distances and scales
// every animation in Spotish uses (transitions, createMotion specs). Change
// a value here, not in a component. The names follow transitions.dev's
// token kinds (duration, easing, distance, blur, scale).

/** Durations, ms. */
export const DURATION = {
  /** A press, a hover wash, a colour change. */
  instant: 120,
  /** Most state changes: a control's hover and press layers, a menu item. */
  fast: 180,
  /** Something moving into place: a menu opening, a tab indicator sliding,
   * an icon swapping. */
  base: 240,
  /** Larger surfaces and reveals: a skeleton giving way to content, a
   * like's burst. */
  slow: 360,
  /** Unhurried entrances: a list's rows and cards coming in, their covers
   * flipping open. */
  slower: 520,
} as const;

/** Easings, as NSH names them (`createMotion`'s `easing`). Tailwind classes
 * use `ease-out` / `ease-in-out` to match. */
export const EASING = {
  /** Entering, settling: most motion. */
  out: "easeOut",
  /** Moving between two places on screen (a sliding indicator). */
  inOut: "easeInOut",
  /** Leaving. */
  in: "easeIn",
} as const;

/** Distances, points: how far things travel as they come in. */
export const DISTANCE = {
  small: 4,
  base: 8,
  large: 16,
} as const;

/** Scales: how much things grow or shrink in motion. */
export const SCALE = {
  /** Pressed. */
  press: 0.95,
  /** Coming in or swapping out. */
  enter: 0.9,
  /** Hovered lift. */
  hover: 1.04,
  /** A pop (a like). */
  pop: 1.25,
  /** A button pressed as a whole (affectui's clean button: 0.97). */
  pressSoft: 0.97,
  /** Where a glyph swapping for another starts and ends (transitions.dev's
   * icon swap: a quarter). */
  swap: 0.25,
} as const;

/** Blurs, points (transitions.dev's blur tokens). NSH draws `filter:
 * blur()` but cannot transition it: motion steps it (see `SwapIcon`). */
export const BLUR = {
  /** An icon swapping. */
  small: 2,
} as const;

/** A long, soft settle as cubic-Bézier points (transitions.dev's
 * `--ease-smooth-out`, affectui's button ease): a press. `createMotion`
 * takes it as its `easing`; Tailwind uses `EASE_CLASS.smoothOut`. */
export const SMOOTH_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Tailwind easing classes for the same tokens. */
export const EASE_CLASS = {
  out: "ease-out",
  inOut: "ease-in-out",
  smoothOut: "ease-[cubic-bezier(0.22,1,0.36,1)]",
} as const;

/** Tailwind duration classes for the same tokens. */
export const DURATION_CLASS = {
  instant: "duration-120",
  fast: "duration-180",
  base: "duration-240",
  slow: "duration-360",
} as const;
