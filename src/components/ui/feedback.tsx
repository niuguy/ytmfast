// Feedback surfaces: the toasts, a page's error state, and the skeletons
// that stand in for content while it loads.

import { type AnimatedValue, cleanup, createAnimatedValue, createMotion, effect, Overlay, reduceMotion, safeArea, signal, Text, untracked, View, windowSize } from "nsh";
import type { JSX } from "nsh";
import { Button, Toast, type ToastEntry, ToastStack } from "nsh/base";
import { choose, dismiss, dismissNewest, setToastsExpanded, toastContent, toasts } from "../../state/feedback";
import { ActionButton, focusRing, terminal } from "./controls";
import { REVEAL_IN, REVEAL_OUT, SKELETON_PULSE } from "./motion";

function ToastItem(props: { entry: ToastEntry }) {
  const content = () => toastContent(props.entry.id);
  return (
    <Toast
      transitionStatus={props.entry.status}
      accessibilityLabel={content()?.text ?? ""}
      onDismissRequest={() => dismiss(props.entry.id)}
      swipeDirection={terminal ? null : "right"}
      class={
        terminal
          ? "flex-1 flex-row items-center gap-2 px-1"
          : "flex-row items-center gap-3 rounded-(--radius-card) border border-border bg-popover px-4 py-3 shadow-xl transition-all duration-300 ease-out motion-reduce:transition-none"
      }
      startingClass="opacity-0 translate-y-8 scale-90"
      endingClass="opacity-0 translate-x-12 scale-95"
      swipingClass="transition-none"
    >
      <Text class={terminal ? "flex-1 text-foreground" : "flex-1 text-sm font-medium text-popover-foreground"}>{content()?.text ?? ""}</Text>
      <If when={content()?.action}>
        {(action) => (
          <Button
            onPress={() => choose(props.entry.id)}
            class={`rounded-full px-3 py-1 active:opacity-60 ${terminal ? "" : "bg-primary"} ${focusRing}`}
          >
            <Text class={terminal ? "font-bold text-primary" : "text-sm font-bold text-primary-foreground"}>
              {terminal ? `[${action().label}]` : action().label}
            </Text>
          </Button>
        )}
      </If>
    </Toast>
  );
}

/** The toasts: at the bottom, inside the safe area, above the player (a
 * terminal's on its bottom row). */
export function Toaster(props: { bottomOffset?: number }) {
  const stack = (
    <ToastStack
      placement={windowSize().width < 640 ? "bottomCenter" : "bottomRight"}
      class={terminal ? undefined : "w-90 max-w-full"}
      onExpandedChange={({ expanded }) => setToastsExpanded(expanded)}
      onCancel={dismissNewest}
    >
      <Each of={toasts()} key={(e: ToastEntry) => e.id}>
        {(entry) => <ToastItem entry={entry()} />}
      </Each>
    </ToastStack>
  );
  if (terminal) return stack;
  return (
    <Overlay
      style={{
        pointerEvents: "box-none",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 16,
        paddingBottom: safeArea().bottom + (props.bottomOffset ?? 16),
        alignItems: windowSize().width < 640 ? "center" : "flex-end",
      }}
    >
      {stack}
    </Overlay>
  );
}

/** A page that couldn't show its content: one plain sentence, and Retry. */
export function ErrorState(props: { message: string; detail?: string; onRetry: () => void }) {
  return (
    <View role="alert" class="items-center gap-3 px-6 py-16">
      <Text class="text-center text-lg font-bold text-foreground">{props.message}</Text>
      <If when={props.detail}>
        <Text class="max-w-md text-center text-sm text-muted-foreground">{props.detail}</Text>
      </If>
      <ActionButton label="Retry" onPress={props.onRetry} />
    </View>
  );
}

/** A page's empty state: a short title and what to do. */
export function EmptyState(props: { title: string; detail?: string }) {
  return (
    <View class="items-center gap-2 px-6 py-16">
      <Text class="text-center text-lg font-bold text-foreground">{props.title}</Text>
      <If when={props.detail}>
        <Text class="max-w-md text-center text-sm text-muted-foreground">{props.detail}</Text>
      </If>
    </View>
  );
}

// ---- Skeletons and the reveal ----
//
// Ported from transitions.dev's "Skeleton loader and reveal": while content
// loads, a skeleton shaped like it pulses (each shape dims to half and back,
// once a second); when the content arrives the skeleton fades out as the
// content fades in over it, over the same 360ms, ease-in-out. The reference
// also cross-blurs the two layers by 2px; NSH cannot transition a filter, so
// here it is a cross-fade alone. Content already there when the page opens
// (cached) shows at once: no skeleton, no reveal.

/** A placeholder shape that pulses while content loads. The pulse is on the
 * shapes, so the skeleton's own opacity is free for the reveal. */
function Block(props: { class: string }) {
  if (terminal) return <View class={`bg-muted ${props.class}`} />;
  const pulse = joinPulse();
  cleanup(pulse.leave);
  return <View class={`rounded-sm bg-muted ${props.class}`} style={{ opacity: pulse.value }} />;
}

/** The pulse of the shapes made together (a skeleton's, in one go). */
interface Pulse {
  value: AnimatedValue;
  users: number;
}

/** The pulse the shapes made in this turn share. */
let forming: Pulse | null = null;

/** A shape's pulse: one opacity, `SKELETON_PULSE` played on it, for every
 * shape made in the same turn. They would each have played their own from
 * the same frame, in step: one value draws the same, without nine native
 * values per shape made, stopped and released with each skeleton. It stops
 * when its last shape goes. */
function joinPulse(): { value: AnimatedValue; leave: () => void } {
  let pulse = forming;
  if (!pulse) {
    const made: Pulse = { value: createAnimatedValue(1), users: 0 };
    // As `motion.play` does: with less motion asked for, it rests where it
    // ends (fully shown).
    if (!reduceMotion()) {
      const { keyframes, ...timing } = SKELETON_PULSE;
      void made.value.keyframes((keyframes as { opacity: number[] }).opacity, timing);
    }
    forming = made;
    void Promise.resolve().then(() => {
      if (forming === made) forming = null;
    });
    pulse = made;
  }
  const joined = pulse;
  joined.users += 1;
  return {
    value: joined.value,
    leave: () => {
      joined.users -= 1;
      if (joined.users > 0) return;
      if (forming === joined) forming = null;
      void joined.value.stop();
    },
  };
}

/** Content that loads: `placeholder` (a skeleton, or an error) while there is
 * no `data`, then the reveal. `children` gets the data and whether it was
 * there at once (`instant`: nothing was revealed, so a list's rows start
 * their wave at once; after a reveal, as the skeleton fades: `AFTER_REVEAL`). `class` sizes both layers (`flex-1` around a `List`). */
export function Reveal<T>(props: {
  data: T | undefined | null;
  placeholder: JSX.Element;
  class?: string;
  children: (data: () => T, instant: boolean) => JSX.Element;
}) {
  const instant = untracked(() => props.data != null);
  if (terminal) {
    return (
      <If when={props.data} else={props.placeholder}>
        {(data) => props.children(data as () => T, instant)}
      </If>
    );
  }
  // Whether the placeholder has finished leaving.
  const gone = signal(instant);
  effect(() => {
    if (props.data == null) gone.set(false);
  });
  return (
    <View class={`relative ${props.class ?? ""}`}>
      <If when={props.data}>
        {(data) => (
          <Revealed instant={instant} class={props.class}>
            {props.children(data as () => T, instant)}
          </Revealed>
        )}
      </If>
      <If when={!gone()}>
        <Leaving leaving={props.data != null} onGone={() => gone.set(true)}>
          {props.placeholder}
        </Leaving>
      </If>
    </View>
  );
}

/** The content's layer: fades in unless it was there at once. */
function Revealed(props: { instant: boolean; class?: string; children: JSX.Element }) {
  const style = untracked(() => (props.instant ? undefined : createMotion({ enter: REVEAL_IN }).style));
  return (
    <View class={props.class ?? ""} style={style}>
      {props.children}
    </View>
  );
}

/** The placeholder's layer: in the flow while it stands in, then over the
 * content, fading out, until it is gone. */
function Leaving(props: { leaving: boolean; onGone: () => void; children: JSX.Element }) {
  const motion = createMotion();
  effect(() => {
    if (!props.leaving) return;
    untracked(() => void motion.play(REVEAL_OUT).then(() => props.onGone()));
  });
  cleanup(() => motion.stop());
  return (
    <View class={props.leaving ? "pointer-events-none absolute inset-x-0 top-0" : ""} style={motion.style}>
      {props.children}
    </View>
  );
}

/** One track row loading, shaped like `TrackRow`: number, cover, title and
 * second line, length. */
function TrackRowBones(props: { index: number }) {
  // Lines of a few lengths, so the column does not read as a grid.
  const title = ["w-2/5", "w-1/2", "w-1/3", "w-3/5"][props.index % 4];
  const second = ["w-1/4", "w-1/5", "w-1/3", "w-1/4"][props.index % 4];
  return (
    <View class={terminal ? "h-1" : "mx-3 h-12 flex-row items-center gap-3 px-3"}>
      <View class="w-6 items-end">
        <Block class="h-3 w-3" />
      </View>
      <Block class="size-9" />
      <View class="min-w-0 flex-1 gap-1.5">
        <Block class={`h-3 ${title}`} />
        <Block class={`h-2.5 ${second}`} />
      </View>
      <View class="w-12 items-end">
        <Block class="h-3 w-8" />
      </View>
    </View>
  );
}

/** Track rows loading, as a track list lays them out (a page's list, or the
 * songs of a search). */
export function RowsSkeleton(props: { rows?: number; header?: boolean }) {
  const rows = Array.from({ length: props.rows ?? 8 }, (_, i) => i);
  return (
    <View accessibilityLabel="Loading" testID="skeleton">
      <If when={props.header && !terminal}>
        {/* Where the list's header row goes. */}
        <View class="mx-3 mb-1 h-8 border-b border-border/60" />
      </If>
      <Each of={rows}>{(i) => <TrackRowBones index={i()} />}</Each>
    </View>
  );
}

/** A collection's page loading: its header (cover, kind, name, details,
 * play button) over track rows. */
export function CollectionSkeleton(props: { phone: boolean }) {
  return (
    <View accessibilityLabel="Loading" testID="skeleton">
      <View
        class={
          terminal
            ? "gap-1"
            : props.phone
              ? "items-center gap-3 px-6 pb-4 pt-1"
              : "flex-row items-end gap-4 px-6 pb-4 pt-1"
        }
      >
        <Block class={props.phone ? "size-40 rounded-(--radius)" : "size-24 rounded-(--radius)"} />
        <View class={props.phone ? "w-full items-center gap-2" : "min-w-0 flex-1 gap-2 pb-1"}>
          <Block class="h-2.5 w-14" />
          <Block class={props.phone ? "h-6 w-48" : "h-7 w-72 max-w-full"} />
          <Block class="h-3 w-40" />
        </View>
        <Block class="size-11 shrink-0 rounded-full" />
      </View>
      <RowsSkeleton header />
    </View>
  );
}

/** Rows of cards loading, shaped like `CardRow`: a title over cards (cover,
 * name, what it is). */
export function CardsSkeleton(props: { rows?: number }) {
  const rows = Array.from({ length: props.rows ?? 2 }, (_, i) => i);
  return (
    <View accessibilityLabel="Loading" class={terminal ? "gap-1" : "gap-8"} testID="skeleton">
      <Each of={rows}>
        {() => (
          <View class="gap-2">
            <Block class="mx-3 h-6 w-48" />
            <View class="h-[216px] flex-row overflow-hidden pt-1">
              <Each of={[0, 1, 2, 3, 4, 5, 6, 7]}>
                {() => (
                  <View class="w-36 shrink-0 gap-2 p-2.5">
                    <Block class="aspect-square w-full rounded-(--radius)" />
                    <View class="gap-1.5">
                      <Block class="h-3 w-4/5" />
                      <Block class="h-2.5 w-1/2" />
                    </View>
                  </View>
                )}
              </Each>
            </View>
          </View>
        )}
      </Each>
    </View>
  );
}

/** The library loading, shaped like its rows: a round cover and a name (the
 * rail: covers alone). */
export function LibrarySkeleton(props: { compact: boolean; rows?: number }) {
  const rows = Array.from({ length: props.rows ?? 6 }, (_, i) => i);
  return (
    <View accessibilityLabel="Loading" class={terminal ? "" : "px-2 pt-2"} testID="skeleton">
      <Each of={rows}>
        {(i) => (
          <View class="pb-1">
            <View class={`h-11 flex-row items-center gap-3 px-2 ${props.compact ? "justify-center" : ""}`}>
              <Block class={`${props.compact ? "size-9" : "size-[30px]"} rounded-full`} />
              <If when={!props.compact}>
                <Block class={`h-3 ${["w-3/5", "w-2/5", "w-1/2"][i() % 3]}`} />
              </If>
            </View>
          </View>
        )}
      </Each>
    </View>
  );
}

/** Search results loading: songs, then a row of cards. */
export function SearchSkeleton() {
  return (
    <View accessibilityLabel="Loading" class={terminal ? "gap-1" : "gap-8"} testID="skeleton">
      <View class="gap-2">
        <Block class="mx-6 h-6 w-24" />
        <RowsSkeleton rows={4} header />
      </View>
      <View class="px-3">
        <CardsSkeleton rows={1} />
      </View>
    </View>
  );
}

/** A small spinner for work behind content that still shows (a search
 * running again). Still when the user asked for less motion. */
export function Spinner(props: { label: string }) {
  if (terminal) return <Text class="text-muted-foreground">…</Text>;
  const motion = createMotion();
  void motion.play("spin", { duration: 900, iterations: "infinite", easing: "linear" });
  cleanup(() => motion.stop());
  return (
    <View
      role="progressbar"
      accessibilityLabel={props.label}
      class="size-4 rounded-full border-2 border-muted-foreground border-t-transparent"
      style={motion.style}
    />
  );
}
