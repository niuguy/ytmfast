// Track lists: the header row and one track's row. A row is used in a
// recycling `List`, so it reads its track where it is used and keeps no
// state of its own.

import { Digits } from "../ui/digits";
import { Text, untracked, View } from "nsh";
import { clock, type Track } from "../../backend/types";
import { isCurrentTrack, isPlaying } from "../../state/player";
import { Cover, LAYER, focusRing, keyRing, Pressable, terminal } from "../ui/controls";
import type { ListKeys } from "../ui/list-keys";
import { PlayingBars } from "../ui/playing";
import { Icon } from "../ui/icons";
import { listItemEntrance, type ListWave, WAVE } from "../ui/motion";
import { type MenuContext, SongContextMenu, SongMenuButton } from "./menus";

/** The header row above a track list. */
export function TrackHeader(props: { showAlbum: boolean }) {
  if (terminal) return <View class="hidden" />;
  return (
    <View class="mx-3 mb-1 h-8 flex-row items-center gap-3 border-b border-border/60 px-3">
      {/* The number column has no heading; "Title" starts where the covers
          do, so the cover column and the title share one left edge. It
          spans the row's cover and its gap (48 pt) and the title's share,
          so the shares match the row's and "Album" is over the albums. */}
      <View class="w-6" />
      <Text class="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground" style={{ flexBasis: 48 }}>
        Title
      </Text>
      <If when={props.showAlbum}>
        <Text class="flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Album</Text>
      </If>
      <View class="w-12 items-end">
        <Icon name="clock" size={14} color="muted-foreground" />
      </View>
      {/* Over the rows' "…" buttons. */}
      <View class="w-8" />
    </View>
  );
}

/** One track: its number (or a mark while it is the one loaded), cover,
 * title and artists, album and length. */
export function TrackRow(props: {
  track: Track | undefined;
  number: number;
  showAlbum: boolean;
  /** What the second line says: the artists (default), or the album where
   * every row has the same artist (an artist's page), which would only
   * repeat down the list. */
  secondary?: "artists" | "album";
  disabled?: boolean;
  /** The list's wave: the row comes in with it each time the page is
   * entered, and on its own when it is scrolled into view. */
  wave?: ListWave;
  /** Its list's keyboard: the row is no stop of Tab then, and shows the
   * list's highlight. */
  keys?: ListKeys;
  /** The collection it is listed in, for its menu (a playlist of the
   * account's own can take it out). */
  context?: MenuContext;
  onPress: () => void;
}) {
  // The row slides in from the right, its cover flips open and its words
  // slide in after it, each on a timeline of its own, once per track per
  // entry. Made here, once, and bound as plain values: the row
  // re-reads its style whenever any of its props changes (`selected` follows
  // every player update), and a motion made in that binding would play
  // again each time.
  const { style: entrance, cover: coverIn, text: textIn } = untracked(() =>
    listItemEntrance({
      wave: props.wave,
      key: () => (props.track ? props.track.uid + props.track.uri : ""),
      index: () => props.number,
      axis: "translateX",
      turns: WAVE.rows,
    }),
  );
  const current = () => isCurrentTrack(props.track?.uri ?? "");
  const playing = () => current() && isPlaying();
  const label = () => (props.track ? `${props.track.name}, ${props.track.artists}` : "");
  const keyed = () => props.keys?.isActive(props.number) ?? false;
  const song = () =>
    props.track ? { uri: props.track.uri, name: props.track.name, albumUri: props.track.albumUri, uid: props.track.uid } : undefined;
  return (
    <SongContextMenu song={song()} context={props.context}>
    <Pressable
      focusable={!props.keys}
      accessibilityLabel={label()}
      selected={current()}
      disabled={props.disabled ?? false}
      onPress={() => {
        props.keys?.pressed(props.number);
        props.onPress();
      }}
      class={`${
        terminal
          ? "flex-row gap-2 px-1 focus:bg-muted selected:bg-muted"
          : `group mx-3 h-12 flex-row items-center gap-3 rounded-(--radius) px-3 transition duration-150 ease-out hover:bg-row-hover active:bg-muted selected:bg-row-hover disabled:opacity-50 motion-reduce:transition-none ${focusRing}`
      } ${keyed() ? keyRing : ""}`}
      classList={{ "opacity-45": !!props.track && !props.track.playable }}
      style={entrance}
    >
      <View class="w-6 items-end">
        <If
          when={current() && !terminal}
          else={
            <View class="relative items-end justify-center">
              <Text class={`text-xs tabular-nums text-muted-foreground ${LAYER} group-hover:opacity-0 group-hover:-translate-y-1`}>
                {props.number + 1}
              </Text>
              <If when={!terminal}>
                <View class={`absolute right-0 opacity-0 scale-50 ${LAYER} group-hover:opacity-100 group-hover:scale-100 group-active:scale-90`}>
                  <Icon name="play" size={12} color="foreground" />
                </View>
              </If>
            </View>
          }
        >
          <PlayingBars playing={playing()} />
        </If>
      </View>
      <View style={coverIn}>
        <Cover src={props.track?.image ?? ""} size={36} fallback="music" class="rounded-sm" />
      </View>
      <View class={terminal ? "min-w-0 flex-1 flex-row gap-2" : "min-w-0 flex-1 gap-0.5"} style={textIn}>
        <Text class={`line-clamp-1 text-sm text-foreground ${current() ? "font-semibold" : "font-medium"}`}>{props.track?.name ?? ""}</Text>
        <View class="flex-row items-center gap-1.5">
          <If when={!!props.track?.explicit && !terminal}>
            <Text accessibilityLabel="Explicit" class="rounded-sm bg-muted-foreground px-1 text-[9px] font-bold text-background">
              E
            </Text>
          </If>
          <Text class="line-clamp-1 flex-1 text-xs text-muted-foreground">
            {/* Never an empty second line: the album where asked, else (or when
                the album is unknown, as for an artist's top tracks) the artists. */}
            {(props.secondary === "album" && props.track?.album ? props.track.album : props.track?.artists || props.track?.album) ?? ""}
          </Text>
        </View>
      </View>
      <If when={props.showAlbum}>
        <Text class="line-clamp-1 min-w-0 flex-1 text-xs text-muted-foreground">{props.track?.album ?? ""}</Text>
      </If>
      <Digits class="w-12 text-right text-xs text-muted-foreground">{props.track ? clock(props.track.durationMs) : ""}</Digits>
      {/* The song's menu: shown on hover (and while open), always in a
          terminal. */}
      <If when={song()}>
        {(s) => (
          <View class={terminal ? "" : `w-8 items-center opacity-0 ${LAYER} group-hover:opacity-100 focus-within:opacity-100`}>
            <SongMenuButton song={s()} context={props.context} />
          </View>
        )}
      </If>
    </Pressable>
    </SongContextMenu>
  );
}
