// The app's icons: one family of glyphs (Tabler Icons), drawn
// as an SVG data-URI through `Image`, in a theme token's color. TSX has no
// inline-SVG element, so the token's value is put into the SVG and read
// again when the appearance changes. A terminal draws no images: icon-only
// controls show text there instead (see `controls.tsx`).

import { batch, cleanup, colorScheme, effect, Image, type MotionName, type MotionSpec, reduceMotion, signal, type Tokens, token, untracked, View } from "nsh";
import { lazyMotion } from "./motion";
import { BLUR, DURATION, EASING, SCALE } from "./tokens";

export type IconName =
  | "home" | "search" | "library" | "play" | "pause" | "skipBack" | "skipForward"
  | "shuffle" | "repeat" | "repeatOne" | "heart" | "heartFilled" | "volume" | "volumeLow"
  | "volumeMute" | "chevronLeft" | "chevronRight" | "chevronDown" | "music" | "user"
  | "logIn" | "logOut" | "disc" | "clock" | "alert" | "close"
  | "sparkles" | "externalLink" | "info" | "github" | "code" | "check"
  | "sidebarCollapse" | "sidebarExpand" | "power" | "crown" | "activity" | "compass" | "microphone";

// Tabler Icons 3.19.0 (MIT, tabler.io/icons): Outline at a 1.5pt stroke,
// and Filled for the transport and the liked heart. Each is the inside of a
// 24×24 SVG, its colour `@`.
const BODY: Record<IconName, string> = {
  home: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l-2 0l9 -9l9 9l-2 0" /> <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" /> <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" /></g>`,
  compass: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 16l2 -6l6 -2l-2 6l-6 2" /> <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /> <path d="M12 3v2" /> <path d="M12 19v2" /> <path d="M3 12h2" /> <path d="M19 12h2" /></g>`,
  search: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /> <path d="M21 21l-6 -6" /></g>`,
  library: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" /> <path d="M9 4m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z" /> <path d="M5 8h4" /> <path d="M9 16h4" /> <path d="M13.803 4.56l2.184 -.53c.562 -.135 1.133 .19 1.282 .732l3.695 13.418a1.02 1.02 0 0 1 -.634 1.219l-.133 .041l-2.184 .53c-.562 .135 -1.133 -.19 -1.282 -.732l-3.695 -13.418a1.02 1.02 0 0 1 .634 -1.219l.133 -.041z" /> <path d="M14 9l4 -1" /> <path d="M16 16l3.923 -.98" /></g>`,
  play: `<g fill="@"><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></g>`,
  pause: `<g fill="@"><path d="M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" /> <path d="M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" /></g>`,
  skipBack: `<g fill="@"><path d="M19.496 4.136l-12 7a1 1 0 0 0 0 1.728l12 7a1 1 0 0 0 1.504 -.864v-14a1 1 0 0 0 -1.504 -.864z" /> <path d="M4 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z" /></g>`,
  skipForward: `<g fill="@"><path d="M3 5v14a1 1 0 0 0 1.504 .864l12 -7a1 1 0 0 0 0 -1.728l-12 -7a1 1 0 0 0 -1.504 .864z" /> <path d="M20 4a1 1 0 0 1 .993 .883l.007 .117v14a1 1 0 0 1 -1.993 .117l-.007 -.117v-14a1 1 0 0 1 1 -1z" /></g>`,
  shuffle: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4l3 3l-3 3" /> <path d="M18 20l3 -3l-3 -3" /> <path d="M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5" /> <path d="M21 7h-5a4.978 4.978 0 0 0 -3 1m-4 8a4.984 4.984 0 0 1 -3 1h-3" /></g>`,
  repeat: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" /> <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" /></g>`,
  repeatOne: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3" /> <path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3" /> <path d="M11 11l1 -1v4" /></g>`,
  heart: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" /></g>`,
  heartFilled: `<g fill="@"><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" /></g>`,
  volume: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8" /> <path d="M17.7 5a9 9 0 0 1 0 14" /> <path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" /></g>`,
  volumeLow: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8" /> <path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" /></g>`,
  volumeMute: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" /> <path d="M16 10l4 4m0 -4l-4 4" /></g>`,
  chevronLeft: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6l6 6" /></g>`,
  chevronRight: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6l-6 6" /></g>`,
  chevronDown: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6l6 -6" /></g>`,
  music: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M13 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /> <path d="M9 17v-13h10v13" /> <path d="M9 8h10" /></g>`,
  user: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /> <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /></g>`,
  logIn: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 8v-2a2 2 0 0 1 2 -2h7a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-2" /> <path d="M3 12h13l-3 -3" /> <path d="M13 15l3 -3" /></g>`,
  logOut: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2" /> <path d="M9 12h12l-3 -3" /> <path d="M18 15l3 -3" /></g>`,
  disc: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /> <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /> <path d="M7 12a5 5 0 0 1 5 -5" /> <path d="M12 17a5 5 0 0 0 5 -5" /></g>`,
  clock: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /> <path d="M12 7v5l3 3" /></g>`,
  alert: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /> <path d="M12 8v4" /> <path d="M12 16h.01" /></g>`,
  close: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6l-12 12" /> <path d="M6 6l12 12" /></g>`,
  sparkles: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" /></g>`,
  externalLink: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7l-10 10" /> <path d="M8 7l9 0l0 9" /></g>`,
  info: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /> <path d="M12 9h.01" /> <path d="M11 12h1v4h1" /></g>`,
  github: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" /></g>`,
  code: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8l-4 4l4 4" /> <path d="M17 8l4 4l-4 4" /> <path d="M14 4l-4 16" /></g>`,
  check: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5l10 -10" /></g>`,
  sidebarCollapse: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /> <path d="M9 4v16" /> <path d="M15 10l-2 2l2 2" /></g>`,
  sidebarExpand: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" /> <path d="M9 4v16" /> <path d="M14 10l2 2l-2 2" /></g>`,
  power: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6a7.75 7.75 0 1 0 10 0" /> <path d="M12 4l0 8" /></g>`,
  crown: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6l4 6l5 -4l-2 10h-14l-2 -10l5 4z" /></g>`,
  activity: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8l4 -16l3 8h4" /></g>`,
  microphone: `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" /> <path d="M5 10a7 7 0 0 0 14 0" /> <path d="M8 21l8 0" /> <path d="M12 17l0 4" /></g>`,
};

/** The speaker alone: the first frame of the volume icons' morph. */
const SPEAKER = `<g stroke="@" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5" /></g>`;

/** The glyph at `t` (0..1) through its hover morph: the drawing itself
 * changes, in a way that says what the control does. At 0 and 1, the glyph
 * at rest. */
type Morph = (body: string, t: number) => string;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const C = 12; // the glyphs' centre, in their 24 units

/** A fading echo trails the glyph the way it skips. */
const trail =
  (dir: number): Morph =>
  (body, t) => {
    const e = env(t);
    return `<g opacity="${(0.45 * e).toFixed(3)}" transform="translate(${(dir * 3.2 * e).toFixed(2)} 0)">${body}</g>${body}`;
  };

const MORPHS: Partial<Record<IconName, [Morph, number]>> = {
  skipForward: [trail(1), 380],
  skipBack: [trail(-1), 380],
  // The crossing lines change places, and back.
  shuffle: [(body, t) => `<g transform="translate(0 ${C}) scale(1 ${Math.cos(2 * Math.PI * ease(t)).toFixed(3)}) translate(0 ${-C})">${body}</g>`, 520],
  // The arrows go once round (half a turn brings the glyph back to itself).
  repeat: [(body, t) => `<g transform="rotate(${(180 * ease(t)).toFixed(2)} ${C} ${C})">${body}</g>`, 480],
  repeatOne: [(body, t) => `<g transform="rotate(${(360 * ease(t)).toFixed(2)} ${C} ${C})">${body}</g>`, 560],
  // One beat.
  heart: [(body, t) => scaled(body, 1 + 0.14 * env(t)), 320],
  heartFilled: [(body, t) => scaled(body, 1 + 0.14 * env(t)), 320],
  // The sound comes back: the speaker alone, then its waves one by one.
  volume: [(body, t) => (t < 0.3 ? SPEAKER : t < 0.6 ? BODY.volumeLow : body), 420],
  volumeLow: [(body, t) => (t < 0.45 ? SPEAKER : body), 300],
  volumeMute: [(body, t) => (t < 0.45 ? SPEAKER : body), 300],
  // The bars press together a little; the triangle leans on.
  pause: [(body, t) => `<g transform="translate(${C} 0) scale(${(1 - 0.18 * env(t)).toFixed(3)} 1) translate(${-C} 0)">${body}</g>`, 300],
  play: [(body, t) => `<g transform="translate(${(1.3 * env(t)).toFixed(2)} 0)">${body}</g>`, 300],
};

function scaled(body: string, k: number): string {
  return `<g transform="translate(${C} ${C}) scale(${k.toFixed(3)}) translate(${-C} ${-C})">${body}</g>`;
}

/** Whether `name` changes its drawing on hover (else it moves as a whole). */
export function morphs(name: IconName): boolean {
  return name in MORPHS;
}

const URIS = new Map<string, string>();
const STEPS = 24;

function dataUri(name: IconName, color: string, t = 0): string {
  const morph = MORPHS[name];
  const q = morph && t > 0 && t < 1 ? Math.round(t * STEPS) : 0;
  const key = `${name}|${color}|${q}`;
  let uri = URIS.get(key);
  if (!uri) {
    const body = q > 0 && q < STEPS && morph ? morph[0](BODY[name], q / STEPS) : BODY[name];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none">${body.replaceAll("@", color)}</svg>`;
    uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    URIS.set(key, uri);
  }
  return uri;
}

/** A theme token an icon can be drawn in. */
export type IconColor = keyof Tokens & string;

export interface IconProps {
  name: IconName;
  /** Points (default 24). */
  size?: number;
  /** A theme token (default `"foreground"`). */
  color?: IconColor;
  /** A colour of its own (`#rrggbb`), over `color`. */
  hex?: string;
  /** How far through its hover morph (`iconMotion().t()`), 0 at rest. */
  t?: number;
}

/** The colour an icon draws in: `hex`, or its token's value now (reading the
 * appearance, so it follows light and dark). */
function colorOf(props: IconProps): string {
  colorScheme();
  return props.hex || String(token((props.color ?? "foreground") as never));
}

/** The named glyph, in a theme token's color. */
export function Icon(props: IconProps) {
  const size = () => props.size ?? 24;
  return (
    <Image
      src={dataUri(props.name, colorOf(props), props.t)}
      accessibilityElementsHidden
      style={{ width: size(), height: size() }}
    />
  );
}

/** A glyph swapping for another (transitions.dev's icon swap): both at
 * once, the old one shrinking to a quarter, blurring and fading as the new
 * one grows from a quarter, sharpens and comes in. */
const SWAP_IN: MotionSpec = {
  keyframes: { opacity: [0, 1], scale: [SCALE.swap, 1] },
  duration: DURATION.base,
  easing: EASING.inOut,
};
const SWAP_OUT: MotionSpec = {
  keyframes: { opacity: [1, 0], scale: [1, SCALE.swap] },
  duration: DURATION.base,
  easing: EASING.inOut,
};
/** NSH draws a blur but cannot animate one: it steps, this many times
 * through the swap (a few timeouts per swap, nothing at rest). */
const BLUR_STEPS = 4;
/** The same glyph changing colour (the like heart turning red): the old
 * colour fades off the new one, like transitions.dev's 150ms colour fade. */
const RECOLOR: MotionSpec = {
  keyframes: { opacity: [1, 0] },
  duration: DURATION.fast,
  easing: EASING.out,
};

/** `Icon`, whose glyph swaps when `name` changes (play and pause, the
 * heart, repeat, the volume's levels): the glyph leaving keeps the colour it
 * had. A new colour of the same glyph fades in (`RECOLOR`). Its first
 * glyph just shows; nothing moves at rest or with reduced motion. `t` (the hover morph) is the glyph showing. */
export function SwapIcon(props: IconProps) {
  // Made on the first swap: most glyphs never swap.
  const incoming = lazyMotion();
  const outgoing = lazyMotion();
  /** The glyph going: swapped out (`swap`, blurring) or a colour fading off. */
  const leaving = signal<{ name: IconName; hex: string; swap: boolean } | null>(null);
  /** How far through the swap's blur: `BLUR_STEPS` at rest. */
  const step = signal(BLUR_STEPS);
  let timers: ReturnType<typeof setTimeout>[] = [];
  const stopBlur = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };
  let name = untracked(() => props.name);
  let hex = untracked(() => colorOf(props));
  effect(() => {
    const now = props.name;
    const color = colorOf(props);
    if (now === name) {
      if (color === hex) return;
      const was = { name, hex, swap: false };
      hex = color;
      untracked(() => {
        // A swap going on takes the new colour as it is.
        if (leaving() || reduceMotion()) return;
        outgoing.reset();
        leaving.set(was);
        void outgoing.play(RECOLOR).then(({ finished }) => finished && leaving.set(null));
      });
      return;
    }
    const was = { name, hex, swap: true };
    name = now;
    hex = color;
    untracked(() => {
      stopBlur();
      incoming.stop();
      outgoing.stop();
      if (reduceMotion()) {
        batch(() => {
          leaving.set(null);
          step.set(BLUR_STEPS);
        });
        incoming.reset();
        return;
      }
      batch(() => {
        leaving.set(was);
        step.set(0);
      });
      void incoming.play(SWAP_IN);
      void outgoing.play(SWAP_OUT).then(({ finished }) => finished && leaving.set(null));
      for (let i = 1; i <= BLUR_STEPS; i++) {
        timers.push(setTimeout(() => step.set(i), (DURATION.base * i) / BLUR_STEPS));
      }
    });
  });
  cleanup(() => {
    stopBlur();
    incoming.stop();
    outgoing.stop();
  });
  const size = () => props.size ?? 24;
  const blur = (amount: number) => (amount > 0 ? `blur(${amount.toFixed(2)}px)` : undefined);
  return (
    <View class="items-center justify-center" style={{ width: size(), height: size() }}>
      <View style={incoming.style}>
        <View style={{ filter: blur(BLUR.small * (1 - step() / BLUR_STEPS)) }}>
          <Icon name={props.name} size={size()} color={props.color} hex={props.hex} t={props.t} />
        </View>
      </View>
      <If when={leaving()}>
        {(was) => (
          <View class="absolute inset-0 items-center justify-center" style={outgoing.style}>
            <View style={{ filter: was().swap ? blur((BLUR.small * step()) / BLUR_STEPS) : undefined }}>
              <Icon name={was().name} size={size()} hex={was().hex} />
            </View>
          </View>
        )}
      </If>
    </View>
  );
}

/** A glyph's one hover move: where it is (points, degrees) at `t`, 0..1
 * through the move. Each rides a half-sine envelope, so it leaves rest and
 * comes back to it without a jump; the amplitudes are small, felt more than
 * seen (after allsum's sidebar icons). */
type Pose = (t: number) => { x?: number; y?: number; rotate?: number; scale?: number };

const env = (t: number) => Math.sin(t * Math.PI);
const deg = (rad: number) => (rad * 180) / Math.PI;

/** Up 2 points with a slight lean back (300 ms). */
const lift: Pose = (t) => ({ y: -2 * env(t), rotate: deg(-0.12 * env(t)) });
/** Two swings about the centre, dying away (480 ms). */
const swing: Pose = (t) => ({ rotate: deg(Math.sin(t * 4 * Math.PI) * env(t) * 0.18) });
/** Out along a direction and back (300 ms). */
const nudge =
  (dx: number, dy: number): Pose =>
  (t) => ({ x: dx * env(t), y: dy * env(t) });
/** A quick double beat (420 ms). */
const beat: Pose = (t) => ({ scale: 1 + 0.14 * Math.abs(Math.sin(t * 2 * Math.PI)) * env(t) });
/** A part turn and back (420 ms). */
const turn =
  (by: number): Pose =>
  (t) => ({ rotate: by * env(t) });
/** A small scribble: side to side twice, lifting (560 ms). */
const scribble: Pose = (t) => {
  const stroke = Math.sin(t * 4 * Math.PI);
  return { x: stroke * 1.5 * env(t), y: -Math.abs(stroke) * 0.6 * env(t), rotate: deg(-0.2 * env(t)) };
};

const MOVES: Partial<Record<IconName, [Pose, number]>> = {
  home: [lift, 300],
  compass: [swing, 480],
  search: [swing, 480],
  library: [lift, 300],
  chevronLeft: [nudge(-2, 0), 300],
  chevronRight: [nudge(2, 0), 300],
  chevronDown: [nudge(0, 2), 300],
  logIn: [nudge(2, 0), 300],
  logOut: [nudge(2, 0), 300],
  externalLink: [nudge(1.5, -1.5), 300],
  user: [lift, 300],
  sparkles: [swing, 480],
  crown: [lift, 300],
  activity: [lift, 300],
  microphone: [lift, 300],
  info: [lift, 300],
  github: [swing, 480],
  code: [scribble, 560],
  close: [turn(90), 300],
};

/** Samples a pose into keyframes the native animation plays (linear
 * between samples: the pose has its own easing). */
function spec(pose: Pose, duration: number): MotionSpec {
  const steps = Math.max(8, Math.round(duration / 16));
  const frames = Array.from({ length: steps + 1 }, (_, i) => {
    const p = pose(i / steps);
    return { translateX: p.x ?? 0, translateY: p.y ?? 0, rotate: `${p.rotate ?? 0}deg`, scale: p.scale ?? 1 };
  });
  return { keyframes: frames, duration, easing: "linear" };
}

const SPECS = new Map<IconName, MotionSpec>();
function specOf(name: IconName): MotionSpec {
  let s = SPECS.get(name);
  if (!s) {
    const [pose, duration] = MOVES[name] ?? [lift, 300];
    s = spec(pose, duration);
    SPECS.set(name, s);
  }
  return s;
}

/** A glyph's hover move: spread `style` on a view around the icon and call
 * `play(name)` as the pointer enters the control (`onMouseEnter`). Each
 * entry plays it once from rest, ending at rest; nothing when the user
 * asked for less motion. */
export function iconMotion() {
  // Made on the first hover: most glyphs are never hovered.
  const motion = lazyMotion();
  const t = signal(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  const stopMorph = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    t.set(0);
  };
  try {
    cleanup(stopMorph);
  } catch {
    // Outside a component: nothing to stop with.
  }
  return {
    /** Bind it in a binding (`style={hover.style}`): it follows. */
    get style() {
      return motion.style;
    },
    /** How far through the glyph's morph (pass to `Icon`'s `t`). */
    t: () => t(),
    play(name: IconName) {
      if (reduceMotion()) return;
      const morph = MORPHS[name];
      if (morph) {
        stopMorph();
        const start = Date.now();
        timer = setInterval(() => {
          const k = (Date.now() - start) / morph[1];
          if (k >= 1) stopMorph();
          else t.set(k);
        }, 16);
        return;
      }
      motion.stop();
      void motion.play(specOf(name));
    },
  };
}
