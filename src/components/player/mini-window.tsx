// The mini player: a small window of its own that floats over every other
// app (and on every desktop Space), with what plays, Like, the transport
// and the position. Switching to it hides the main window; its expand
// button (or switching again) brings the main window back. It renders in
// the same engine as the main window, so it reads the same player store.
// Desktops only (macOS, Windows, Linux): elsewhere it never opens.

import { platform, Text, View } from "nsh";
import { isAvailable, Window } from "nsh/desktop";
import { coverColorQuery } from "../../data/queries";
import { miniPlayerOpen, setMiniPlayerOpen } from "../../state/overlays";
import { controlsEnabled, dragSeek, hasTrack, player, position, positionFill, seek } from "../../state/player";
import { BarSlider, Cover, IconButton, terminal } from "../ui/controls";
import { LikeButton, TransportControls } from "./parts";

/** Whether this platform has a mini player (a desktop app's windows). */
export const hasMiniPlayer = isAvailable && !terminal;

/** The window's content size, in points. */
const SIZE = { width: 380, height: 128 };

/** macOS draws the rounded card on a clear window; elsewhere the window is
 * the card (Linux compositors may not do transparent windows). */
const clear = platform.os === "macos";

/** Shows the main window and brings it to the front. */
function showMain(): void {
  const main = Window.get("main");
  main?.show();
  main?.focus();
}

/** Switches to the mini player: it opens, and the main window hides. */
export function openMiniPlayer(): void {
  if (!hasMiniPlayer) return;
  setMiniPlayerOpen(true);
  Window.get("main")?.hide();
}

/** Switches back: the mini player closes, and the main window shows. */
export function closeMiniPlayer(): void {
  setMiniPlayerOpen(false);
  showMain();
}

/** Switches to the mini player, or back. */
export function toggleMiniPlayer(): void {
  if (miniPlayerOpen()) closeMiniPlayer();
  else openMiniPlayer();
}

/** The player bar's button that switches to the mini player. */
export function MiniPlayerButton() {
  return (
    <If when={hasMiniPlayer}>
      <IconButton name="pictureInPicture" label="Mini player" hint pressed={miniPlayerOpen()} onPress={toggleMiniPlayer} />
    </If>
  );
}

function MiniPlayerBody() {
  const p = () => player();
  // A wash of the cover's colour over the card.
  const color = coverColorQuery(() => p().artwork);
  return (
    <View
      testID="mini-player"
      // Dragging it anywhere but its controls moves the window.
      desktop={{ windowDrag: true }}
      class={`flex-1 overflow-hidden border border-border bg-sidebar ${clear ? "rounded-2xl" : ""}`}
    >
      <If when={color()}>
        {(c) => <View class="absolute inset-0" style={{ backgroundColor: c(), opacity: 0.18 }} />}
      </If>
      <View class="flex-1 flex-row items-center gap-4 px-4 py-3">
        <Cover src={p().artwork} size={88} class="rounded-lg shadow-md" />
        <View class="min-w-0 flex-1 gap-2">
          <View class="flex-row items-start gap-1">
            <View class="min-w-0 flex-1 gap-0.5">
              <Text class="line-clamp-1 text-sm font-semibold text-foreground">{p().title || "Nothing playing"}</Text>
              <Text class="line-clamp-1 text-xs text-muted-foreground">{p().ad ? "Advertisement" : p().artist}</Text>
            </View>
            <IconButton name="arrowsDiagonal" label="Back to the full player" hint size={16} onPress={closeMiniPlayer} />
          </View>
          <View class="flex-row items-center justify-between">
            <TransportControls quiet minimal />
            <LikeButton size={16} />
          </View>
          <BarSlider
            tinted
            quiet
            label="Playback position"
            value={position()}
            max={Math.max(1, p().durationMs)}
            fill={positionFill}
            disabled={!controlsEnabled() || p().ad || !hasTrack()}
            onChange={dragSeek}
            onChangeEnd={seek}
          />
        </View>
      </View>
    </View>
  );
}

/** The mini player's window, open while `miniPlayerOpen()`. Mount it once,
 * in the root. */
export function MiniPlayerWindow() {
  if (!hasMiniPlayer) return <View class="hidden" />;
  return (
    <Window
      id="mini-player"
      kind="panel"
      title="YTMFast mini player"
      open={miniPlayerOpen()}
      // Closed some other way (the system's close shortcut): back to the
      // main window, so the app is never left without one.
      onOpenChange={({ open }) => {
        if (!open && miniPlayerOpen()) closeMiniPlayer();
      }}
      defaultSize={SIZE}
      minSize={SIZE}
      maxSize={SIZE}
      resizable={false}
      frame="none"
      transparent={clear}
      // Its own: it takes the keys (space plays and pauses) when clicked.
      activate
      workspaces="all"
      restoreBounds
    >
      <MiniPlayerBody />
    </Window>
  );
}
