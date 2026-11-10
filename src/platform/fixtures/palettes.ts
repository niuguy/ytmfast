// Two real Omarchy palettes, as `SystemTheme.current()` gives them
// (copied from this repo's *.colors.toml fixtures: `#hex` values only,
// lowercased; src/theme.rs parses the .toml files themselves).

import type { SystemPalette } from "../palette";

/** `adventure` (dark). */
export const adventure: SystemPalette = {
  "mode": "dark",
  "colors": {
    "accent": "#5da602",
    "background": "#040404",
    "blue": "#417ab3",
    "bright_blue": "#97d7ef",
    "bright_cyan": "#97efd6",
    "bright_foreground": "#ffffff",
    "bright_green": "#99b52c",
    "bright_magenta": "#e599bc",
    "bright_red": "#d76b42",
    "bright_yellow": "#ffb670",
    "brown": "#4b6479",
    "cyan": "#41b3a9",
    "dark_background": "#171717",
    "dark_foreground": "#777b80",
    "darker_background": "#0f1112",
    "foreground": "#feffff",
    "green": "#5da602",
    "light_foreground": "#e4d5c7",
    "lighter_background": "#0e0e0e",
    "magenta": "#882252",
    "muted": "#777b80",
    "orange": "#eebb6e",
    "red": "#d84a33",
    "selection": "#294a01",
    "yellow": "#aa7900"
  }
};

/** `catppuccin-latte` (light). */
export const catppuccinLatte: SystemPalette = {
  "mode": "light",
  "colors": {
    "accent": "#1e66f5",
    "background": "#eff1f5",
    "blue": "#1e66f5",
    "bright_blue": "#1e66f5",
    "bright_cyan": "#179299",
    "bright_foreground": "#4c4f69",
    "bright_green": "#40a02b",
    "bright_magenta": "#ea76cb",
    "bright_red": "#d20f39",
    "bright_yellow": "#df8e1d",
    "brown": "#6c2715",
    "cyan": "#179299",
    "dark_background": "#e3e4e8",
    "dark_foreground": "#9ca0b0",
    "darker_background": "#d7d8dc",
    "foreground": "#4c4f69",
    "green": "#40a02b",
    "light_foreground": "#5c5f77",
    "lighter_background": "#dce0e8",
    "magenta": "#ea76cb",
    "muted": "#acb0be",
    "orange": "#d84e2b",
    "red": "#d20f39",
    "selection": "#ccd0da",
    "yellow": "#df8e1d"
  }
};
