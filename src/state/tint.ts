// The player's controls' colour (the play button, the position and volume,
// toggles that are on): the theme's foreground, white on the dark player,
// so they read over whatever light the cover gives the bar behind them.
// `vivid` turns a cover colour into a control colour, should one be wanted.

import { signal, token } from "nsh";

const cover = signal("");

/** Sets the cover's colour (`#rrggbb`, or "" when unknown). */
export function setCoverTint(hex: string): void {
  cover.set(hex);
}

function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  if (hi === lo) return [0, 0, l];
  const d = hi - lo;
  const s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
  const h = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** A cover colour as a control colour: saturated and of a middle
 * lightness, or null for a grey (no hue to show). Exported for tests. */
export function vivid(hex: string): string | null {
  const rgb = parse(hex);
  if (!rgb) return null;
  const [h, s] = hsl(rgb);
  if (s < 0.12) return null;
  return fromHsl(h, Math.max(0.6, Math.min(0.85, s)), 0.58);
}

/** The controls' colour now (tracked). */
export function tint(): string {
  cover();
  return String(token("foreground"));
}

/** A deeper shade of the tint, for gradients' start. */
export function tintDeep(): string {
  const rgb = parse(tint());
  if (!rgb) return tint();
  const [h, s, l] = hsl(rgb);
  return fromHsl(h, s, Math.max(0.25, l - 0.18));
}

/** Black or white, whichever reads on the tint. */
export function onTint(): string {
  const rgb = parse(tint());
  if (!rgb) return "#000000";
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return lum > 0.55 ? "#0b0c0d" : "#ffffff";
}

/** A colour with an alpha (0..1), multiplied into any it has: a
 * translucent fill that lets what is behind show through. Takes `#rgb`,
 * `#rrggbb`, `#rrggbbaa` and `rgb()`/`rgba()` (what `token()` may give);
 * anything else comes back as it is. */
export function alpha(color: string, a: number): string {
  const rgba = parseColor(color);
  if (!rgba) return color;
  const [r, g, b, own] = rgba;
  const k = Math.round(Math.max(0, Math.min(1, a * own)) * 255);
  return toHex(r, g, b) + k.toString(16).padStart(2, "0");
}

function parseColor(color: string): [number, number, number, number] | null {
  const c = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) {
    const [r, g, b] = [...m[1]].map((d) => parseInt(d + d, 16));
    return [r, g, b, 1];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (m) {
    const own = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [+m[1], +m[2], +m[3], own];
  }
  return null;
}
