// The desktop shell: a tray icon with the player's controls, and a main
// window that hides instead of quitting when it is closed, so music keeps
// playing (as music players do). Desktop only: on the
// web, phones and terminals `installDesktopShell` does nothing.
//
// Wiring (App.tsx, in the root component's body, which runs once):
//
//   installDesktopShell({
//     isPlaying: () => store.player().playing,
//     title: () => nowPlayingTitle(store.player()),
//     togglePlay: store.toggle,
//     next: () => store.control("next", () => store.ytm.next()),
//     previous: () => store.control("previous", () => store.ytm.previous()),
//     showNowPlaying: () => store.nowPlaying.set(true),
//   });
//
// It must run while a component renders: `currentWindow()` throws
// elsewhere. Everything it sets up goes with that component.
//
// Platform notes:
// - Linux: the tray is a StatusNotifierItem (Waybar, Plasma; GNOME needs the
//   AppIndicator extension). Without a tray host the hidden window has no
//   way back except the media controls' Raise (MPRIS) and launching the app
//   again; pass `hideOnClose: false` where that matters.
// - macOS: the tray icon is a template image in the menu bar; Cmd+Q quits.
// - Windows: the notification area.

import { cleanup, effect, platform, token } from "nsh";
import { Application, currentWindow, isAvailable, Tray, type WindowRef, windows } from "nsh/desktop";
import { MARK } from "../ui/logo";

/** What the desktop shell needs from the player. */
export interface DesktopShellOptions {
  /** Whether music plays now (reactive). */
  isPlaying: () => boolean;
  /** What plays now, as one line ("Title · Artist"; empty for nothing)
   * (reactive). */
  title: () => string;
  /** Plays or pauses. */
  togglePlay(): void;
  /** The next track. */
  next(): void;
  /** The previous track. */
  previous(): void;
  /** Opens the Now Playing view; shown in the tray menu when given. */
  showNowPlaying?(): void;
  /** Switches to the mini player, or back; shown in the tray menu when
   * given. */
  toggleMiniPlayer?(): void;
  /** Closing the main window hides it (true, the default) or quits. */
  hideOnClose?: boolean;
}

/** What the desktop shell installed: show the main window from elsewhere
 * (the media controls' Raise, a second launch). */
export interface DesktopShell {
  /** Shows the main window and brings it to the front. */
  showWindow(): void;
}

const NONE: DesktopShell = { showWindow() {} };

/** A tray menu line for what plays: "Title · Artist", or "Not playing". */
export function trayTitle(title: string): string {
  const t = title.trim();
  if (!t) return "Not playing";
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

/** The tray glyph (the logo's play mark and speed lines) in `color`, as an
 * SVG data URI. Monochrome: a template on macOS, the panel's text color
 * elsewhere. */
export function trayIcon(color: string): string {
  // `token()` gives #rrggbbaa; SVG renderers differ on 8-digit hex.
  if (/^#[0-9a-f]{8}$/i.test(color)) color = color.slice(0, 7);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 28 28" width="24" height="24">` +
    `<g fill="${color}">${MARK}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Whether there is an app window to close and an app to exit (a desktop
 * app; not the web, a phone or a terminal). */
export const hasAppWindow = isAvailable;

/** Exits the app (its windows close, the music stops). */
export function quitApp(): void {
  if (isAvailable) Application.quit();
}

/** Whether closing the main window hides it (the shell is installed with
 * `hideOnClose`). */
let hidesOnClose = false;

/** Closes the main window as its title bar's close does: hidden while the
 * tray keeps the app (the music plays on), else closed (the app ends). */
export function closeMainWindow(): void {
  if (!isAvailable) return;
  const win = windows().find((w) => w.id === "main") ?? windows()[0];
  if (!win) return;
  if (hidesOnClose) win.hide();
  else win.close();
}

/** The main window, found while rendering. */
function mainWindow(): WindowRef | null {
  try {
    return currentWindow();
  } catch {
    return windows()[0] ?? null;
  }
}

/**
 * Installs the tray icon and hide-on-close for the main window. Call it once
 * from the root component's body. Returns a handle to show the window; on
 * platforms without desktop windows it does nothing.
 */
export function installDesktopShell(opts: DesktopShellOptions): DesktopShell {
  if (!isAvailable) return NONE;
  const win = mainWindow();
  if (!win) return NONE;
  // Linux keeps the system's title bar: nsh.json hides it for a bar of the
  // app's own (`TitleBar`), which suits macOS and Windows, but a tiling
  // desktop such as Omarchy's draws none, and the page header has Close.
  if (platform.os === "linux") win.set({ titleBar: { style: "default" } });

  const showWindow = () => {
    win.show(); // Also restores it when minimized.
    win.focus();
  };

  if (opts.hideOnClose !== false) {
    win.set({ closeOnPress: false });
    hidesOnClose = true;
    const stop = win.on("closePress", () => win.hide());
    cleanup(() => {
      hidesOnClose = false;
      stop();
      win.set({ closeOnPress: true });
    });
  }

  // The tray follows the player and the theme (its ink is the foreground
  // token, so it reads on the panel in either appearance).
  effect(() => {
    const playing = opts.isPlaying();
    const title = trayTitle(opts.title());
    const ink = token("foreground");
    const showNowPlaying = opts.showNowPlaying;
    const toggleMiniPlayer = opts.toggleMiniPlayer;
    Tray.set({
      icon: trayIcon(ink),
      tooltip: opts.title().trim() ? `YTMFast: ${title}` : "YTMFast",
      onClick: showWindow,
      menu: [
        // The app, on its own.
        { label: "Open YTMFast", onSelect: showWindow },
        { type: "separator" },
        // What plays, and its controls.
        { label: title, disabled: true },
        { label: playing ? "Pause" : "Play", onSelect: () => opts.togglePlay() },
        { label: "Next track", onSelect: () => opts.next() },
        { label: "Previous track", onSelect: () => opts.previous() },
        showNowPlaying && {
          label: "Show Now Playing",
          onSelect: () => {
            showWindow();
            showNowPlaying();
          },
        },
        toggleMiniPlayer && { label: "Mini player", onSelect: () => toggleMiniPlayer() },
        { type: "separator" },
        { label: "Exit", onSelect: quitApp },
      ],
    });
  });
  cleanup(() => Tray.set(null));

  return { showWindow };
}
