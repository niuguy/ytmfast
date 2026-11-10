// The system theme's mapping onto Spotish's tokens, with two real Omarchy
// palettes (./fixtures): pure functions, no app needed.
import { describe, expect, test } from "nsh/test";

import { adventure, catppuccinLatte } from "./fixtures/palettes";
import { contrast, mapPalette, mix, parseHex } from "./palette";
import { needsPlaybackUpdate } from "./media";
import { trayIcon, trayTitle } from "./desktop";
import { themeFor } from "./theme";
import { checkForUpdates } from "./updater";
import { colorScheme, setColorScheme, setTheme, token } from "nsh";

/** Every token theme.json defines a color for. */
const COLOR_TOKENS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
  "accent", "accent-foreground", "destructive", "border", "input", "ring",
  "sidebar", "sidebar-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border",
  "shell", "player", "control", "control-foreground", "row-hover",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
];

describe("color helpers", () => {
  test("parse and mix hex colors", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#11223344")).toEqual([17, 34, 51]);
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(contrast("#000000", "#ffffff")).toBeGreaterThan(20.9);
  });
});

describe("mapPalette", () => {
  for (const [name, palette] of [["adventure", adventure], ["catppuccin-latte", catppuccinLatte]] as const) {
    test(`${name}: fills every color token with #rrggbb`, () => {
      const t = mapPalette(palette)!;
      for (const key of COLOR_TOKENS) expect(t[key] ?? `missing ${key}`).toMatch(/^#[0-9a-f]{6}$/);
    });

    test(`${name}: text reads on its surfaces`, () => {
      const t = mapPalette(palette)!;
      expect(contrast(t.foreground, t.background)).toBeGreaterThanOrEqual(7);
      expect(contrast(t["muted-foreground"], t.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["primary-foreground"], t.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t["accent-foreground"], t.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.primary, t.background)).toBeGreaterThanOrEqual(3);
      expect(contrast(t["control-foreground"], t.control)).toBeGreaterThanOrEqual(7);
    });
  }

  test("adventure (dark): takes the theme's colors; the frame recedes", () => {
    const t = mapPalette(adventure)!;
    expect(t.background).toBe("#040404");
    expect(t.foreground).toBe("#feffff");
    expect(t.primary).toBe("#5da602");
    expect(t.ring).toBe("#5da602");
    expect(t.destructive).toBe("#d84a33");
    // Raised surfaces are lighter than the background, the shell darker.
    expect(contrast(t.secondary, "#000000")).toBeGreaterThan(contrast(t.background, "#000000"));
    expect(contrast(t.shell, "#000000")).toBeLessThanOrEqual(contrast(t.background, "#000000"));
  });

  test("catppuccin-latte (light): dark text on light surfaces", () => {
    const t = mapPalette(catppuccinLatte)!;
    expect(t.background).toBe("#eff1f5");
    expect(t.primary).toBe("#1e66f5");
    // Raised and hovered surfaces step toward the text: darker in a light theme.
    expect(contrast(t["row-hover"], "#ffffff")).toBeGreaterThan(contrast(t.background, "#ffffff"));
    expect(contrast(t.foreground, "#ffffff")).toBeGreaterThan(7);
  });

  test("a palette without background or foreground maps to null", () => {
    expect(mapPalette({ mode: "dark", colors: { accent: "#ff0000" } })).toBeNull();
  });

  test("an accent too dim to see on the background is raised to 3:1", () => {
    const t = mapPalette({ mode: "dark", colors: { background: "#0a0708", foreground: "#bfb8b6", accent: "#3a0d12" } })!;
    expect(contrast(t.primary, t.background)).toBeGreaterThanOrEqual(3);
  });
});

describe("themeFor", () => {
  test("NSH takes the mapped theme, keeping theme.json's lengths", () => {
    const radius = token("radius");
    const theme = themeFor(adventure, { radius: `${radius}px`, "font-mono": token("font-mono") })!;
    try {
      setTheme(theme);
      setColorScheme(adventure.mode);
      expect(colorScheme()).toBe("dark");
      expect(token("background")).toMatch(/^#040404/);
      expect(token("primary")).toMatch(/^#5da602/);
      expect(token("radius")).toBe(radius);
    } finally {
      setTheme(null);
      setColorScheme("system");
    }
  });
});

describe("media controls", () => {
  test("report play/pause and seeks, not every tick", () => {
    const last = { playing: true, positionMs: 10_000, at: 0 };
    expect(needsPlaybackUpdate(null, last)).toBe(true);
    expect(needsPlaybackUpdate(last, { playing: true, positionMs: 11_000, at: 1_000 })).toBe(false);
    expect(needsPlaybackUpdate(last, { playing: false, positionMs: 11_000, at: 1_000 })).toBe(true);
    expect(needsPlaybackUpdate(last, { playing: true, positionMs: 60_000, at: 1_000 })).toBe(true);
  });
});

describe("tray", () => {
  test("titles and icon", () => {
    expect(trayTitle("  ")).toBe("Not playing");
    expect(trayTitle("x".repeat(80))).toHaveLength(60);
    expect(decodeURIComponent(trayIcon("#ffeeddff"))).toContain('fill="#ffeedd"');
  });
});

describe("updates", () => {
  test("a development run finds nothing and says nothing", async () => {
    const said: string[] = [];
    await checkForUpdates({ notify: (message) => said.push(message) });
    expect(said).toEqual([]);
  });
});
