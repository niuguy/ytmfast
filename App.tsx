// The app's entry: picks the shell for the window (desktop, phone or
// terminal), and mounts what shows over every shell (Now Playing, About,
// the sign-in prompt, the first-run sheet and the toasts) and the keyboard
// shortcuts, and installs the desktop integration (`src/platform`). Pages
// and state live under `src/`.

import { cleanup, keymap, mount, View } from "nsh";
import { layout } from "./src/components/layout";
import { NowPlayingSheet } from "./src/components/player/now-playing";
import { Toaster } from "./src/components/ui/feedback";
import { TitleBar } from "./src/components/ui/title-bar";
import { AboutDialog, FirstRunSheet, NewPlaylistDialog, ShortcutsDialog, SigningInDialog } from "./src/pages/dialogs";
import { QueuePanel } from "./src/components/player/queue";
import { bindRegionKeys } from "./src/components/ui/regions";
import { DesktopShell } from "./src/shells/desktop";
import { PhoneShell } from "./src/shells/phone";
import { TerminalShell } from "./src/shells/terminal";
import { installDesktopShell } from "./src/platform/desktop";
import { installMediaControls } from "./src/platform/media";
import { followSystemTheme } from "./src/platform/theme";
import { checkForUpdates } from "./src/platform/updater";
import { positionAt } from "./src/backend/types";
import { isDemo } from "./src/state/engine";
import { announce } from "./src/state/feedback";
import { setNowPlayingOpen, setShortcutsOpen } from "./src/state/overlays";
import { next, pause, play, player, previous, seek, toggle } from "./src/state/player";

/** How often a long-running app looks for updates again. */
const UPDATE_EVERY = 6 * 60 * 60 * 1000;

/** The desktop integration: the tray and hide-on-close, the system's media
 * keys and Now Playing, Omarchy's theme, and updates. Each piece does
 * nothing where its platform has none; everything goes with the root. */
function installPlatform() {
  const shell = installDesktopShell({
    isPlaying: () => player().playing,
    title: () => {
      const p = player();
      return p.title ? (p.artist ? `${p.title} · ${p.artist}` : p.title) : "";
    },
    togglePlay: toggle,
    next,
    previous,
    showNowPlaying: () => setNowPlayingOpen(true),
  });
  installMediaControls({
    // The position where it is now, so the system's own clock runs on from it.
    player: () => {
      const p = player();
      return { ...p, positionMs: positionAt(p, Date.now()) };
    },
    toggle,
    play,
    pause,
    next,
    previous,
    seek,
    raise: shell.showWindow,
  });
  followSystemTheme();
  // The demo (tests, the web, phones) is no release to update.
  if (!isDemo) {
    const check = () => void checkForUpdates({ notify: (message, action) => announce(message, action) });
    check();
    const timer = setInterval(check, UPDATE_EVERY);
    cleanup(() => clearInterval(timer));
  }
}

function Shortcuts() {
  // Media-style keys that leave text editing alone: none of them fires
  // while a text input has the focus. Escape belongs to the overlays.
  keymap.bind("space", () => toggle(), { when: "notEditing" });
  keymap.bind("mod+shift+right", () => next(), { when: "notEditing" });
  keymap.bind("mod+shift+left", () => previous(), { when: "notEditing" });
  // Ctrl and an arrow move between the window's regions; `?` lists the keys.
  bindRegionKeys();
  keymap.bind("shift+/", () => setShortcutsOpen(true), { when: "notEditing" });
  return <View class="hidden" />;
}

function App() {
  installPlatform();
  return (
    <View class="flex-1 bg-sidebar">
      <Shortcuts />
      {/* The desktop shell keeps only its columns under the window controls
          clear of them; the others start below the whole title bar. */}
      <If when={layout() !== "desktop"}>
        <TitleBar />
      </If>
      <If when={layout() === "desktop"}>
        <DesktopShell />
      </If>
      <If when={layout() === "phone"}>
        <PhoneShell />
      </If>
      <If when={layout() === "terminal"}>
        <TerminalShell />
      </If>
      <NowPlayingSheet />
      <QueuePanel />
      <NewPlaylistDialog />
      <AboutDialog />
      <ShortcutsDialog />
      <SigningInDialog />
      <FirstRunSheet />
      <Toaster bottomOffset={layout() === "desktop" ? 96 : 140} />
    </View>
  );
}

mount(App);
