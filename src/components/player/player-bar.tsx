// The player as each shell shows it: the desktop's bar, the phone's mini
// player and the terminal's status rows. All are made of `parts.tsx`.

import { effect, Text, token, View, windowSize } from "nsh";
import { Button, Toolbar } from "nsh/base";
import { openLyrics, setNowPlayingOpen } from "../../state/overlays";
import { hasTrack, player, toggle } from "../../state/player";
import { ready } from "../../state/session";
import { Cover, focusRing, IconButton, PlayButton } from "../ui/controls";
import { coverColorsQuery } from "../../data/queries";
import { setCoverTint } from "../../state/tint";
import { lightEffect } from "../../state/visual";
import { LightMenu } from "./light-menu";
import { PlayerGlass } from "../ui/toolbar-fx";
import { Region } from "../ui/regions";
import { barSize } from "../layout";
import { enter } from "../ui/motion";
import { LikeButton, NowPlayingSummary, SeekBar, TransportControls, VolumeControl } from "./parts";

/** The desktop's bar: what plays, the transport over the position, the
 * volume, in a flat pill floating over the pages; it rises in. */
export function PlayerBar() {
  // The light takes the cover's color (the theme's primary until it is known).
  const colors = coverColorsQuery(() => player().artwork);
  const cover = () => colors()[0] ?? "";
  const light = () => cover() || String(token("primary"));
  // The controls take the same colour.
  effect(() => setCoverTint(cover()));
  // Too narrow for shuffle and repeat beside the rest.
  const tiny = () => windowSize().width < 560;
  const stacked = () => barSize() === "stacked";
  return (
    <View style={enter("fadeInUp", 120)}>
    <View class={`shadow-xl ${stacked() ? "rounded-[36px]" : "rounded-full"}`}>
    {/* One stop of Tab, Left and Right between its buttons (the position
        and the volume are stops of their own). */}
    <Region.Provider value={{ name: "player" }}>
    <Toolbar accessibilityLabel="Player">
    <PlayerGlass
      effect={lightEffect()}
      colors={colors()}
      playing={player().playing}
      testID="player"
      radius={stacked() ? 36 : undefined}
      // The toolbar around it lays it out in a row: it takes the row's width.
      class={stacked() ? "flex-1 gap-2 rounded-[36px] px-3.5 pb-2.5 pt-3.5" : "h-18 flex-1 flex-row items-center justify-between gap-4 rounded-full pl-3.5 pr-5"}
    >
      <If
        when={barSize() === "full"}
        else={
          <If
            when={stacked()}
            else={
              // Compact (a middle width): one row, left and right: what plays
              // and Like take the room on the left; the transport and the
              // light's menu sit on the right. No position or volume (Now
              // Playing has both).
              <>
                <View class="min-w-0 flex-1 flex-row items-center gap-2">
                  <NowPlayingSummary openable round cover={44} />
                  <LikeButton />
                </View>
                <TransportControls quiet />
                <LightMenu placement="top" />
              </>
            }
          >
          {/* Stacked (a narrow window): taller, in two rows, so nothing
              runs out of the pill. Above, what plays (its words centred
              between the cover and Like); below, the transport, centred,
              the light's menu at the end. No volume or position. */}
          <>
            <View class="h-11 flex-row items-center gap-2">
              <NowPlayingSummary openable round center cover={44} />
              <LikeButton />
            </View>
            <View class="h-10 flex-row items-center">
              <View class="w-9" />
              <View class="min-w-0 flex-1 items-center">
                <TransportControls quiet minimal={tiny()} />
              </View>
              <View class="w-9 items-end">
                <LightMenu placement="top" />
              </View>
            </View>
          </>
          </If>
        }
      >
        <View class="w-1/4 min-w-0 flex-row items-center gap-2">
          {/* A smaller round cover, concentric with the pill: 14pt from its
              edge on every side (72 = 44 + 2 × 14). */}
          <NowPlayingSummary openable round cover={44} />
          <LikeButton />
        </View>
        <View class="max-w-180 flex-1 items-center gap-1">
          <TransportControls quiet />
          <SeekBar inline quiet />
        </View>
        <View class="w-1/4 flex-row items-center justify-end gap-1 pr-2">
          {/* The lyrics (in Now Playing); the volume always shows its slider
              here, balancing what plays on the left; the light's menu at the
              very end. */}
          <IconButton name="microphone" label="Lyrics" hint disabled={!hasTrack()} onPress={openLyrics} />
          <VolumeControl quiet />
          <LightMenu placement="top" />
        </View>
      </If>
    </PlayerGlass>
    </Toolbar>
    </Region.Provider>
    </View>
    </View>
  );
}

/** The phone's mini player, over the tabs; it opens Now Playing. Hidden
 * while nothing is loaded. */
export function MiniPlayer() {
  return (
    <If when={hasTrack()}>
      <View class="mx-2 mb-2 h-14 flex-row items-center gap-3 rounded-(--radius-card) border border-border bg-secondary px-2">
        <Button
          accessibilityLabel={`Open Now Playing: ${player().title}`}
          onPress={() => setNowPlayingOpen(true)}
          class={`min-w-0 flex-1 flex-row items-center gap-3 rounded-(--radius) active:opacity-70 ${focusRing}`}
        >
          <Cover src={player().artwork} size={40} />
          <View class="min-w-0 flex-1 gap-0.5">
            <Text class="line-clamp-1 text-sm font-semibold text-foreground">{player().title}</Text>
            <Text class="line-clamp-1 text-xs text-muted-foreground">{player().ad ? "Advertisement" : player().artist}</Text>
          </View>
        </Button>
        <PlayButton playing={player().playing} size={36} disabled={!ready()} onPress={toggle} />
      </View>
    </If>
  );
}

/** The terminal's player: two rows of text and bracketed controls. */
export function TerminalPlayer() {
  return (
    <View class="border-t border-border">
      <View class="flex-row items-center gap-2">
        <NowPlayingSummary />
        <LikeButton />
      </View>
      <View class="flex-row items-center gap-2">
        <TransportControls />
        <View class="flex-1">
          <SeekBar inline />
        </View>
        <VolumeControl />
      </View>
    </View>
  );
}
