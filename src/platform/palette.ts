// Maps a system palette (an Omarchy theme's `colors.toml`) onto Spotish's
// semantic tokens (theme.json). Pure: no NSH imports, so it is tested
// headless with the palettes in ./fixtures.
//
// Omarchy names its colors by role (`background`, `foreground`, `accent`,
// `selection`, `muted`, `*_background`, `*_foreground`, the ANSI names), but
// themes use the steps inconsistently (a "dark_background" lighter than
// `background`, a `muted` that is a surface in one theme and text in
// another). So only `background`, `foreground`, `accent` and `red` are taken
// as given; every other role is derived from them by mixing, with contrast
// checks where text sits on it.

/** A system theme's palette: its appearance and its colors by name. */
export interface SystemPalette {
  mode: "light" | "dark";
  colors: Record<string, string>;
}

/** Spotish's color tokens (theme.json), by name. */
export type ColorTokens = Record<string, string>;

type Rgb = [number, number, number];

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as 0–255 RGB (alpha ignored);
 * null when it is none of them. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  else if (h.length === 8) h = h.slice(0, 6);
  else if (h.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** RGB as `#rrggbb`. */
export function toHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `a` moved toward `b` by `t` (0: a, 1: b), in sRGB. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as Rgb);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color` moved toward `toward` in small steps until it reaches `min`
 * contrast on `on` (or `toward` itself). */
export function readable(color: string, on: string, min: number, toward: string): string {
  let c = color;
  for (let t = 0.1; contrast(c, on) < min && t <= 1.0001; t += 0.1) c = mix(color, toward, t);
  return c;
}

/** Whichever of `a` and `b` reads better on `on`. */
function bestOn(on: string, a: string, b: string): string {
  return contrast(a, on) >= contrast(b, on) ? a : b;
}

const BLACK = "#000000";
const WHITE = "#ffffff";

/**
 * Spotish's color tokens for `palette`: the surfaces, text, primary color and
 * charts, for `palette.mode`'s appearance. Every value is `#rrggbb`. Null when
 * the palette lacks a readable `background` or `foreground`.
 */
export function mapPalette(palette: SystemPalette): ColorTokens | null {
  const c = palette.colors;
  const bgRgb = c.background && parseHex(c.background);
  const fgRgb = c.foreground && parseHex(c.foreground);
  if (!bgRgb || !fgRgb) return null;
  const bg = toHex(bgRgb);
  const dark = palette.mode === "dark";
  // Text must read on the background whatever the theme says.
  const fg = readable(toHex(fgRgb), bg, 7, dark ? WHITE : BLACK);
  // Raised surfaces step toward the foreground; the window's frame recedes.
  const up = (t: number) => mix(bg, fg, t);
  const recede = (t: number) => mix(bg, BLACK, t);

  // The theme's accent, or blue, kept visible as a fill and as text on the
  // background (3:1, WCAG's for large text and UI parts).
  const accentRaw = (parseHex(c.accent ?? "") && c.accent) || (parseHex(c.blue ?? "") && c.blue) || fg;
  const primary = readable(toHex(parseHex(accentRaw)!), bg, 3, fg);
  const primaryForeground = readable(bestOn(primary, bg, fg), primary, 4.5, bestOn(primary, BLACK, WHITE));

  const secondary = up(dark ? 0.07 : 0.05);
  const muted = up(dark ? 0.11 : 0.08);
  const border = up(dark ? 0.12 : 0.1);
  const accentSurface = mix(bg, primary, dark ? 0.18 : 0.12);
  const red = (parseHex(c.red ?? "") && c.red) || (dark ? "#f1676c" : "#d43a4a");
  const destructive = readable(toHex(parseHex(red)!), bg, 3, fg);
  // Liked Songs' own color: the theme's red, as a fill and as the heart.
  const liked = destructive;
  // A white heart wherever it reads (3:1, a glyph), else the better of black and white.
  const likedForeground = readable(WHITE, liked, 3, bestOn(liked, BLACK, WHITE));

  return {
    background: bg,
    foreground: fg,
    card: bg,
    "card-foreground": fg,
    popover: dark ? up(0.04) : bg,
    "popover-foreground": fg,
    primary,
    "primary-foreground": primaryForeground,
    secondary,
    "secondary-foreground": fg,
    muted,
    "muted-foreground": readable(mix(fg, bg, 0.4), bg, 4.5, fg),
    accent: accentSurface,
    "accent-foreground": readable(primary, accentSurface, 4.5, fg),
    destructive,
    liked,
    "liked-foreground": likedForeground,
    border,
    input: up(dark ? 0.15 : 0.14),
    ring: primary,
    sidebar: dark ? recede(0.5) : bg,
    "sidebar-foreground": fg,
    "sidebar-accent": secondary,
    "sidebar-accent-foreground": fg,
    "sidebar-border": border,
    shell: dark ? recede(0.5) : recede(0.06),
    player: dark ? up(0.04) : bg,
    control: fg,
    "control-foreground": bg,
    "row-hover": up(dark ? 0.06 : 0.04),
    "chart-1": primary,
    "chart-2": mix(primary, fg, 0.25),
    "chart-3": mix(primary, fg, 0.5),
    "chart-4": mix(primary, bg, 0.3),
    "chart-5": mix(primary, bg, 0.5),
  };
}
