// The lyrics in Now Playing: the song's lines, the one sung now bright and
// kept in view as the song moves on, the ones sung already faded. Pressing a
// line plays from it. Lyrics with no times show as plain words, all alike.
// With none, the cover can keep their place (`cover`).

import { cleanup, effect, List, type ListRef, reduceMotion, signal, Text, untracked, View } from "nsh";
import { Button } from "nsh/base";
import { lineAt, type Lyrics, positionAt } from "../../backend/types";
import { lyricsQuery } from "../../data/queries";
import { controlsEnabled, player, seek } from "../../state/player";
import { Cover, focusRing, terminal } from "../ui/controls";
import { ErrorState, Spinner } from "../ui/feedback";
import { enter } from "../ui/motion";

/** How long the lyrics leave the scroll alone after the user scrolls them. */
const HOLD_MS = 4000;
/** How long the scroll events after the lyrics' own scroll are theirs. */
const OWN_SCROLL_MS = 900;
/** Where the line sung now sits: a little above the middle. */
const VIEW_POSITION = 0.4;

/** A quiet sentence in the lyrics' place. */
function Note(props: { text: string }) {
  return (
    <View class="flex-1 items-center justify-center px-6">
      <Text class="text-center text-lg font-bold text-muted-foreground">{props.text}</Text>
    </View>
  );
}

/** The largest a cover in the lyrics' place grows. */
const COVER_MAX = 320;
/** Below this there is no room for a cover: the note alone. */
const COVER_MIN = 96;
/** Room the note under the cover takes, with its gap and margins. */
const CAPTION = 60;

/** No lyrics to show: the cover of what plays in their place, as large as
 * the room allows, the note quietly under it; the note alone without a
 * cover, without room for one, or in a terminal. */
function NoLyrics(props: { text: string; cover?: boolean }) {
  const room = signal({ width: 0, height: 0 });
  const size = () => {
    const { width, height } = room();
    const fitted = Math.floor(Math.min(COVER_MAX, width - 16, height - CAPTION));
    return fitted < COVER_MIN ? 0 : fitted;
  };
  const shown = () => !!props.cover && !terminal && !!player().artwork && size() > 0;
  return (
    <View class="flex-1" onLayout={(e) => room.set({ width: e.bounds.size.width, height: e.bounds.size.height })}>
      <If when={shown()} else={<Note text={props.text} />}>
        <View class="flex-1 items-center justify-center gap-4 px-6" testID="lyrics-cover" style={enter("zoomIn", 60)}>
          <Cover src={player().artwork} size={size()} class="rounded-2xl shadow-xl" />
          <Text class="text-center text-sm font-semibold text-muted-foreground">{props.text}</Text>
        </View>
      </If>
    </View>
  );
}

/** The lyrics of what plays, in every state: none while nothing (or an ad)
 * plays, a spinner while they load, Retry when they don't, a note when the
 * song has none. `large`: a wide window's size. `cover`: the cover in the
 * lyrics' place when there are none (where it shows nowhere else). */
export function LyricsView(props: { large?: boolean; cover?: boolean }) {
  const track = () => (player().ad ? "" : player().trackUri);
  const query = lyricsQuery(track);
  // Only the lyrics of this track: the query keeps the last track's while it
  // loads the next.
  const lyrics = (): Lyrics | undefined => {
    const loaded = query();
    return loaded && loaded.uri === track() ? loaded.lyrics : undefined;
  };
  const failed = () => lyrics() === undefined && query.state() === "errored";
  return (
    <View class="min-h-0 flex-1" testID="lyrics">
      <If
        when={track()}
        else={
          <If when={!player().ad} else={<Note text="Lyrics come back after the ad." />}>
            <NoLyrics text="Lyrics show here while a song plays." cover={props.cover} />
          </If>
        }
      >
        <If
          when={lyrics()}
          else={
            <If
              when={failed()}
              else={
                <View class="flex-1 items-center justify-center">
                  <Spinner label="Loading lyrics" />
                </View>
              }
            >
              <View class="flex-1 justify-center">
                <ErrorState message="The lyrics didn't load." onRetry={query.refetch} />
              </View>
            </If>
          }
        >
          {(l) => (
            <If when={l().lines.length > 0} else={<NoLyrics text="No lyrics for this song." cover={props.cover} />}>
              <LyricLines lyrics={l()} large={props.large} />
            </If>
          )}
        </If>
      </If>
    </View>
  );
}

function LyricLines(props: { lyrics: Lyrics; large?: boolean }) {
  // The line sung now: worked out when the player says where it is, then
  // again just as the next line starts (the shown position ticks only once
  // a second, too late for a line).
  const current = signal(-1);
  effect(() => {
    const lyrics = props.lyrics;
    const p = player();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const step = () => {
      const at = positionAt(p, Date.now());
      const index = lineAt(lyrics, at);
      current.set(index);
      const next = lyrics.lines[index + 1];
      if (!lyrics.synced || !p.playing || !next) return;
      timer = setTimeout(step, Math.max(16, next.startMs - at + 10));
    };
    step();
    cleanup(() => {
      if (timer !== null) clearTimeout(timer);
    });
  });

  // The line sung now stays in view, gliding there as it changes; new
  // lyrics start there at once. Scrolled by hand, they stay where the user
  // put them for a while.
  let list: ListRef | undefined;
  const mounted = signal(false);
  let shown: Lyrics | null = null;
  let heldUntil = 0;
  let ownUntil = 0;
  effect(() => {
    const index = current();
    const lyrics = props.lyrics;
    if (!mounted() || !list) return;
    const fresh = lyrics !== shown;
    shown = lyrics;
    if (!fresh && Date.now() < heldUntil) return;
    ownUntil = Date.now() + OWN_SCROLL_MS;
    list.scrollToIndex({ index: Math.max(0, index), animated: !fresh && !untracked(reduceMotion), viewPosition: VIEW_POSITION });
  });
  const hold = () => {
    if (Date.now() > ownUntil) heldUntil = Date.now() + HOLD_MS;
  };

  // Read, not shouted: a size a little over the title's line, semibold.
  const size = () => (props.large ? "text-xl" : "text-lg");
  const tone = (index: number) => {
    if (!props.lyrics.synced) return "text-foreground";
    const now = current();
    if (index === now) return "text-foreground";
    // The line sung now stands out: the rest step well back, the lines
    // still to come less than the ones sung already.
    return index < now ? "text-foreground opacity-25 hover:opacity-60" : "text-foreground opacity-40 hover:opacity-80";
  };
  return (
    <List
      each={props.lyrics.lines}
      keyExtractor={(_, index) => String(index)}
      estimatedItemSize={props.large ? 40 : 36}
      ref={(node) => {
        list = node;
        mounted.set(true);
      }}
      onScroll={hold}
      onScrollDragStart={() => (heldUntil = Date.now() + HOLD_MS)}
      scrollEventThrottle={100}
      scrollbar={false}
      class="flex-1"
      contentClass="px-3"
      header={() => <View class="h-16" />}
      footer={() => (
        <View class="gap-2 px-3 pb-40 pt-8">
          <If when={props.lyrics.provider}>
            <Text class="text-xs text-muted-foreground">{`Lyrics provided by ${props.lyrics.provider}`}</Text>
          </If>
        </View>
      )}
    >
      {(line, index) => (
        <Button
          accessibilityLabel={line()?.words ?? ""}
          selected={props.lyrics.synced && index() === current()}
          testID={props.lyrics.synced && index() === current() ? "lyric-now" : undefined}
          disabled={!props.lyrics.synced || !controlsEnabled()}
          onPress={() => {
            const l = line();
            if (l) seek(l.startMs);
          }}
          class={`rounded-(--radius) px-3 py-1.5 transition duration-200 ease-out hover:bg-foreground/5 disabled:hover:bg-transparent motion-reduce:transition-none ${focusRing}`}
        >
          <Text class={`font-semibold leading-normal tracking-tight transition duration-300 ease-out motion-reduce:transition-none ${size()} ${tone(index())}`}>
            {line()?.words ?? ""}
          </Text>
        </Button>
      )}
    </List>
  );
}
