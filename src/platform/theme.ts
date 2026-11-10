// Follows the system theme: on Omarchy, the app takes the current theme's
// colors and appearance and changes with it when the user switches themes
// (Super+Ctrl+Shift+Space). Elsewhere it does nothing, and the app keeps
// theme.json and `"appearance": "system"`.
//
// Wiring (App.tsx, in the root component's body, which runs once):
//
//   followSystemTheme();
//
// Rust (`SystemTheme`, src/theme.rs) finds, reads and watches the palette;
// the mapping onto tokens is ./palette.ts.

import { cleanup, setColorScheme, setTheme, token, type Theme } from "nsh";
import { SystemTheme } from "spotish/native";

import { mapPalette, type SystemPalette } from "./palette";

/** The non-color tokens of theme.json, kept as they are: `setTheme`
 * replaces the whole theme. Add a token here when theme.json gains one that
 * is not a color. */
const KEEP = ["radius", "radius-card", "radius-panel", "radius-inset", "font-mono"] as const;

/** theme.json's non-color tokens, read back from the running theme
 * (lengths come back in points). */
function keptTokens(): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const name of KEEP) {
    try {
      const v = token(name as never) as unknown;
      if (typeof v === "number") out[name] = `${v}px`;
      else if (typeof v === "string" && v) out[name] = v;
    } catch {
      // A token theme.json no longer has.
    }
  }
  return out;
}

/** The theme `setTheme` takes for `palette`: its colors in both
 * appearances (the scheme is forced to the palette's), over `kept`. */
export function themeFor(palette: SystemPalette, kept: Record<string, string | number> = {}): Theme | null {
  const colors = mapPalette(palette);
  if (!colors) return null;
  const { radius, "radius-card": card, "radius-panel": panel, "radius-inset": inset, ...rest } = kept;
  const lengths: Record<string, string | number> = {};
  if (radius !== undefined) lengths.radius = radius;
  if (card !== undefined) lengths["radius-card"] = card;
  if (panel !== undefined) lengths["radius-panel"] = panel;
  if (inset !== undefined) lengths["radius-inset"] = inset;
  const values = { ...rest, ...colors };
  return { cssVars: { theme: lengths, light: values, dark: values } };
}

/**
 * Takes the system theme's colors and appearance, now and whenever the user
 * switches themes, until the calling component goes. Returns whether a
 * system theme was found; without one (any system but Omarchy) it changes
 * nothing.
 */
export function followSystemTheme(): boolean {
  let system: SystemTheme;
  try {
    system = new SystemTheme();
  } catch (error) {
    console.warn("system theme: unavailable:", error);
    return false;
  }
  if (!system.available) {
    system.dispose();
    return false;
  }
  const kept = keptTokens();
  let applied = false;

  const apply = (palette: SystemPalette | null) => {
    const theme = palette && themeFor(palette, kept);
    try {
      if (theme && palette) {
        setTheme(theme);
        setColorScheme(palette.mode);
        applied = true;
      } else if (applied) {
        // The theme went (or cannot be read): back to theme.json.
        setTheme(null);
        setColorScheme("system");
        applied = false;
      }
    } catch (error) {
      // A value NSH cannot read: keep what is shown.
      console.warn("system theme: not applied:", error);
    }
  };

  apply(system.current());
  const stop = system.onChange((palette) => apply(palette));
  system.run().catch((error: unknown) => console.warn("system theme: watching stopped:", error));
  cleanup(() => {
    stop();
    system.dispose();
    if (applied) {
      setTheme(null);
      setColorScheme("system");
    }
  });
  return true;
}
