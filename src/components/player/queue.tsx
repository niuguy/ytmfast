// The queue panel: what plays now and next (press one to play it, ✕ to take
// it out), then what autoplay adds after the queue (+ puts one in it). It
// opens from the player (the queue button) over the pages' right edge on
// the desktop, from the bottom on phones. Read when it opens and when the
// song changes, and every few seconds while it is open.

import { cleanup, effect, Scroll, Text, untracked, View } from "nsh";
import { clock, type QueueItem } from "../../backend/types";
import { addToQueue, jumpInQueue, loadQueue, queue, removeFromQueue } from "../../state/library";
import { queueOpen, setQueueOpen } from "../../state/overlays";
import { isPlaying, player } from "../../state/player";
import { ready } from "../../state/session";
import { layout } from "../layout";
import { Cover, focusRing, IconButton, LAYER, Pressable, SectionTitle, terminal } from "../ui/controls";
import { Digits } from "../ui/digits";
import { EmptyState } from "../ui/feedback";
import { AppSheet } from "../ui/overlays";
import { PlayingBars } from "../ui/playing";

/** How often the open panel reads the queue again, ms. */
const REFRESH = 4000;

/** One song of the queue (or of autoplay). */
function QueueRow(props: { item: QueueItem; autoplay?: boolean }) {
  return (
    <Pressable
      accessibilityLabel={`${props.item.name}, ${props.item.artists}`}
      selected={props.item.current}
      disabled={!ready() || props.autoplay}
      onPress={() => void jumpInQueue(props.item.id)}
      class={
        terminal
          ? "flex-row gap-2 px-1 focus:bg-muted selected:bg-muted"
          : `group h-14 flex-row items-center gap-3 rounded-(--radius) px-2 ${LAYER} hover:bg-row-hover selected:bg-row-hover ${focusRing}`
      }
    >
      <View class="relative">
        <Cover src={props.item.image} size={40} fallback="music" class="rounded-sm" />
        <If when={props.item.current && !terminal}>
          <View class="absolute inset-0 items-center justify-center rounded-sm bg-shell/60">
            <PlayingBars playing={isPlaying()} />
          </View>
        </If>
      </View>
      <View class="min-w-0 flex-1 gap-0.5">
        <Text class={`line-clamp-1 text-sm text-foreground ${props.item.current ? "font-semibold" : "font-medium"}`}>{props.item.name}</Text>
        <Text class="line-clamp-1 text-xs text-muted-foreground">{props.item.artists}</Text>
      </View>
      <Digits class="text-xs text-muted-foreground">{props.item.durationMs ? clock(props.item.durationMs) : ""}</Digits>
      <View class={terminal ? "" : `opacity-0 ${LAYER} group-hover:opacity-100 focus-within:opacity-100`}>
        <If
          when={props.autoplay}
          else={
            <IconButton name="close" label={`Remove ${props.item.name} from the queue`} size={16} disabled={props.item.current} onPress={() => void removeFromQueue(props.item.id)} />
          }
        >
          <IconButton name="plus" label={`Add ${props.item.name} to the queue`} size={16} onPress={() => void addToQueue(props.item.uri, false)} />
        </If>
      </View>
    </Pressable>
  );
}

function QueueBody() {
  // Read now, again when the song changes, and every few seconds.
  effect(() => {
    player().trackUri;
    untracked(() => void loadQueue());
  });
  const timer = setInterval(() => void loadQueue(), REFRESH);
  cleanup(() => clearInterval(timer));
  const items = () => queue()?.items ?? [];
  const current = () => queue()?.current ?? -1;
  const now = () => (current() >= 0 ? items()[current()] : undefined);
  const next = () => items().slice(current() + 1);
  const autoplay = () => queue()?.autoplay ?? [];
  return (
    <View testID="queue-panel" class={terminal ? "flex-1 gap-1" : "flex-1 gap-2"}>
      <View class={terminal ? "flex-row items-center" : "flex-row items-center justify-between px-4 pt-4"}>
        <Text role="header" class="text-xl font-bold text-foreground">
          Queue
        </Text>
        <IconButton name="close" label="Close the queue" onPress={() => setQueueOpen(false)} />
      </View>
      <Scroll class="flex-1" contentClass={terminal ? "gap-1" : "gap-1 px-2 pb-6"}>
        <If when={items().length > 0} else={<EmptyState title="Nothing queued" detail="Play something, or add songs with Play next and Add to queue." />}>
          <If when={now()}>
            {(item) => (
              <View class="gap-1">
                <SectionTitle class="px-2 pt-1 text-sm">Now playing</SectionTitle>
                <QueueRow item={item()} />
              </View>
            )}
          </If>
          <If when={next().length > 0}>
            <SectionTitle class="px-2 pt-4 text-sm">Next up</SectionTitle>
            <Each of={next()} key={(i) => i.id}>
              {(item) => <QueueRow item={item()} />}
            </Each>
          </If>
          <If when={autoplay().length > 0}>
            <SectionTitle class="px-2 pt-4 text-sm">Autoplay</SectionTitle>
            <Each of={autoplay()} key={(i) => i.id}>
              {(item) => <QueueRow item={item()} autoplay />}
            </Each>
          </If>
        </If>
      </Scroll>
    </View>
  );
}

/** The queue panel, over the pages. */
export function QueuePanel() {
  return (
    <AppSheet
      open={queueOpen()}
      onOpenChange={setQueueOpen}
      side={layout() === "desktop" ? "right" : "bottom"}
      tall
      closeOnSwipe
      testID="queue"
    >
      <If when={queueOpen()}>
        <QueueBody />
      </If>
    </AppSheet>
  );
}
