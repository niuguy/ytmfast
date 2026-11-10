// The player's parts, shared by the desktop bar, the phone's mini player,
// Now Playing and the terminal: the transport, the position, the volume,
// Like and what plays. They read the player store and call its intents.

import { cleanup, createMotion, effect, type Motion, type MotionSpec, reduceMotion, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { regionItem } from "../ui/regions";
import { clock } from "../../backend/types";
import { openPremium } from "../../state/links";
import { setNowPlayingOpen } from "../../state/overlays";
import {
  controlsEnabled,
  cycleRepeat,
  dragSeek,
  dragVolume,
  hasTrack,
  next,
  player,
  position,
  positionFill,
  previous,
  seek,
  setVolume,
  toggle,
  toggleLike,
  toggleMute,
  toggleShuffle,
  volumeLevel,
} from "../../state/player";
import { ready } from "../../state/session";
import { Digits } from "../ui/digits";
import { BarSlider, Cover, focusRing, IconButton, PlayButton, terminal, TextLink } from "../ui/controls";
import type { IconName } from "../ui/icons";
import { lazyMotion } from "../ui/motion";
import { DURATION, EASING, SCALE } from "../ui/tokens";

const REPEAT_LABEL = { off: "Repeat", context: "Repeat one", track: "Don't repeat" } as const;

/** Shuffle, previous, play / pause, next and repeat. `quiet`: a faint play
 * button (Now Playing). */
export function TransportControls(props: { large?: boolean; minimal?: boolean; quiet?: boolean }) {
  const icon = () => (props.large ? 22 : 18);
  const side = () => (props.large ? 18 : 18);
  const usable = () => controlsEnabled() && !player().ad;
  return (
    <View class={`flex-row items-center ${props.large ? "gap-6" : "gap-4"}`} role="toolbar" accessibilityLabel="Playback">
      <If when={!props.minimal}>
        <IconButton
          name="shuffle"
          label="Shuffle"
          size={side()}
          pressed={player().shuffle}
          tinted
          disabled={!usable() || !player().shuffleAvailable}
          onPress={toggleShuffle}
        />
      </If>
      <IconButton name="skipBack" label="Previous" short="Prev" size={icon()} disabled={!usable() || !player().canPrevious} onPress={previous} />
      <PlayButton tinted quiet={props.quiet} playing={player().playing} size={props.large ? 56 : 36} disabled={!ready() || !hasTrack()} onPress={toggle} />
      <IconButton name="skipForward" label="Next" size={icon()} disabled={!usable() || !player().canNext} onPress={next} />
      <If when={!props.minimal}>
        <IconButton
          name={player().repeat === "track" ? "repeatOne" : "repeat"}
          label={REPEAT_LABEL[player().repeat]}
          short={player().repeat === "off" ? "Repeat" : player().repeat === "context" ? "Repeat: all" : "Repeat: one"}
          size={side()}
          pressed={player().repeat !== "off"}
          tinted
          disabled={!usable()}
          onPress={cycleRepeat}
        />
      </If>
    </View>
  );
}

/** The playback position: a slider with the elapsed and total times beside
 * it (`inline`) or under it. Seeking is off during an ad. */
export function SeekBar(props: { inline?: boolean; quiet?: boolean }) {
  const duration = () => Math.max(1, player().durationMs);
  // The times in LED digits (`Digits`).
  const times = () => `text-xs text-muted-foreground ${props.quiet ? "opacity-60" : ""}`;
  const elapsed = () => <Digits class={times()}>{clock(position())}</Digits>;
  const total = () => <Digits class={times()}>{clock(hasTrack() ? player().durationMs : 0)}</Digits>;
  const slider = (
    <BarSlider
      tinted
      quiet={props.quiet}
      label="Playback position"
      value={position()}
      max={duration()}
      fill={positionFill}
      disabled={!controlsEnabled() || player().ad}
      class="flex-1"
      onChange={dragSeek}
      onChangeEnd={seek}
    />
  );
  if (props.inline) {
    return (
      <View class="w-full flex-row items-center gap-2">
        <View class="w-10 items-end">{elapsed()}</View>
        {slider}
        <View class="w-10">{total()}</View>
      </View>
    );
  }
  return (
    <View class="w-full gap-1">
      <View class="flex-row">{slider}</View>
      <View class="flex-row justify-between">
        {elapsed()}
        {total()}
      </View>
    </View>
  );
}

/** Mute and the volume slider. `quiet`: a thin, faint slider. */
export function VolumeControl(props: { class?: string; collapsible?: boolean; quiet?: boolean }) {
  const icon = (): IconName => {
    const v = volumeLevel();
    if (v <= 0) return "volumeMute";
    if (v < 0.5) return "volumeLow";
    return "volume";
  };
  // Collapsible: the slider opens while the pointer is on the control, while
  // the keyboard is in it, and while it is dragged; Mute stays visible.
  const hovering = signal(false);
  const dragging = signal(false);
  const open = () => !props.collapsible || hovering() || dragging();
  return (
    <View
      class={`group flex-row items-center ${props.class ?? ""}`}
      onMouseEnter={() => hovering.set(true)}
      onMouseLeave={() => hovering.set(false)}
    >
      <IconButton
        name={icon()}
        label={player().muted ? "Unmute" : "Mute"}
        disabled={!ready() || !hasTrack()}
        onPress={toggleMute}
      />
      <If when={!terminal}>
        {/* Its room stays; the slider slides out from the speaker and fades
            in (a width change would jump: layout does not animate). */}
        <View
          class={`${props.collapsible ? "w-18" : "w-24"} pl-1 pr-3 transition duration-300 ease-out motion-reduce:transition-none ${
            open()
              ? "translate-x-0 opacity-100"
              : "-translate-x-2 opacity-0 focus-within:translate-x-0 focus-within:opacity-100"
          }`}
        >
            <BarSlider
              tinted
              quiet={props.quiet}
              label="Volume"
              value={volumeLevel()}
              max={1}
              disabled={!ready() || !hasTrack()}
              class="w-full"
              onChange={(v) => {
                dragging.set(true);
                dragVolume(v);
              }}
              onChangeEnd={(v) => {
                dragging.set(false);
                setVolume(v);
              }}
            />
        </View>
      </If>
    </View>
  );
}

/** Saves the track to Liked Songs, or removes it. Liking pops the heart and
 * sprays a burst of red dots (transitions.dev's "Like button"); unliking only
 * dips it. Both play from the press alone, never when a track changes. */
export function LikeButton(props: { size?: number }) {
  // Made with the first press: most hearts are never pressed (each dot's
  // motion is nine native values).
  const pop = lazyMotion();
  let dots: Motion[] = [];
  const made = signal(false);
  const makeDots = () => {
    if (dots.length === 0) {
      dots = Array.from({ length: LIKE_DOTS }, () => createMotion({ initial: { opacity: 0 } }));
      made.set(true);
    }
    return dots;
  };
  cleanup(() => {
    pop.stop();
    for (const d of dots) d.stop();
  });
  // The reference is drawn for a 16pt heart; scale its distances to ours.
  const k = () => (props.size ?? 18) / 16;
  const dotSize = () => LIKE_DOT_SIZE * k();
  // The dots exist only while a burst flies: nothing of them is on screen at
  // rest, whatever a motion's resting opacity is. `burstId` lets only the
  // latest burst take them away when it ends.
  const bursting = signal(false);
  let burstId = 0;
  const press = () => {
    const liking = !player().liked;
    toggleLike();
    // Nothing changed (controls locked): nothing moves.
    if (player().liked !== liking || terminal || reduceMotion()) return;
    const id = ++burstId;
    if (!liking) {
      // As the reference drops its burst: the dots go at once.
      for (const d of dots) d.stop();
      bursting.set(false);
      void pop.play(UNLIKE_DIP);
      return;
    }
    void pop.play(LIKE_POP);
    const flying = makeDots();
    bursting.set(true);
    // Each like re-rolls every dot's angle, reach, size, speed and start, so
    // the spray never repeats.
    void Promise.all(flying.map((d, i) => d.play(burst(i, k())))).then(() => {
      if (id === burstId) bursting.set(false);
    });
  };
  return (
    <View class="items-center justify-center">
      <View style={pop.style}>
        <IconButton
          // Always the filled heart: white while not liked, red once it is.
          name="heartFilled"
          label={player().liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
          short={player().liked ? "Liked" : "Like"}
          size={props.size ?? 18}
          pressed={player().liked}
          pressedColor="liked"
          disabled={!controlsEnabled() || player().ad}
          onPress={press}
        />
      </View>
      <If when={!terminal && bursting() && made()}>
        {makeDots().map((d) => (
          <View
            class="pointer-events-none absolute rounded-full bg-liked"
            // Mounted only while a burst plays; it starts and ends at opacity 0.
            style={{ width: dotSize(), height: dotSize(), ...d.style }}
          />
        ))}
      </If>
    </View>
  );
}

// transitions.dev "Like button" (p23), ported. Reference tokens: pop 350ms
// cubic-bezier(0.34, 1.96, 0.64, 1) 1 → 0.82 (at 30%) → 1; fill 150ms;
// 8 dots of 2.5px flung 20px over 600ms ease-out; per dot ±16° of angle,
// 0.68–1.18 of the reach, 0.78–1.22 of the duration, 0–70ms of delay,
// 0.6–1.4 of the size, and an end scale of 0.35–0.75.
const LIKE_DOTS = 8;
const LIKE_DOT_SIZE = 2.5;
const LIKE_REACH = 20;
const LIKE_BURST_MS = 600;
/** The reference's spring-like overshoot curve, segment by segment. */
const LIKE_SPRING: [number, number, number, number] = [0.34, 1.96, 0.64, 1];

/** The heart squashes, then springs back past its size and settles. */
const LIKE_POP: MotionSpec = {
  keyframes: [{ scale: 1 }, { scale: 0.82, offset: 0.3 }, { scale: 1 }],
  duration: DURATION.slow,
  easing: LIKE_SPRING,
};

/** Unliking: a small, quiet dip, no burst. */
const UNLIKE_DIP: MotionSpec = {
  keyframes: [{ scale: 1 }, { scale: SCALE.press }, { scale: 1 }],
  duration: DURATION.fast,
  easing: EASING.out,
};

/** Dot `i`'s flight: it appears a quarter of the way out, then drifts the
 * rest of its reach, shrinking and fading. */
function burst(i: number, k: number): MotionSpec {
  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  const angle = (((360 / LIKE_DOTS) * i + rand(-16, 16)) * Math.PI) / 180;
  const reach = LIKE_REACH * k * rand(0.68, 1.18);
  const x = Math.cos(angle) * reach;
  const y = Math.sin(angle) * reach;
  const size = rand(0.6, 1.4);
  return {
    keyframes: [
      { opacity: 0, translateX: 0, translateY: 0, scale: 0.4 * size },
      { opacity: 1, translateX: x * 0.25, translateY: y * 0.25, scale: size, offset: 0.2 },
      { opacity: 0, translateX: x, translateY: y, scale: rand(0.35, 0.75) * size },
    ],
    duration: Math.round(LIKE_BURST_MS * rand(0.78, 1.22)),
    delay: Math.round(rand(0, 70)),
    easing: EASING.out,
  };
}

/** A new track's arrival: the cover settles in with a small overshoot,
 * the words rise after it. */
export const NEW_COVER: MotionSpec = {
  keyframes: [
    { opacity: 0.4, scale: 0.9 },
    { opacity: 1, scale: 1.04 },
    { opacity: 1, scale: 1 },
  ],
  duration: 420,
  easing: "easeOut",
};
const NEW_WORDS: MotionSpec = {
  keyframes: [
    { opacity: 0, translateY: 6 },
    { opacity: 1, translateY: 0 },
  ],
  duration: 320,
  delay: 80,
  easing: "easeOut",
};

/** What plays: the cover (`cover` points; 0 for none), which opens Now
 * Playing when `openable`, the title and the artist; during an ad, the ad's own artwork and title, and a link to
 * Premium. */
export function NowPlayingSummary(props: { cover?: number; round?: boolean; openable?: boolean; large?: boolean; center?: boolean }) {
  const subtitle = () => (player().ad ? "Advertisement" : player().artist);
  // Each new track arrives: the cover, then the words (not the first one
  // shown, which comes in with the player).
  // Made with the first new track.
  const coverIn = lazyMotion();
  const wordsIn = lazyMotion();
  let shown = `${player().title}|${player().artwork}`;
  effect(() => {
    const now = `${player().title}|${player().artwork}`;
    if (now !== shown && player().title && !terminal) {
      void coverIn.play(NEW_COVER);
      void wordsIn.play(NEW_WORDS);
    }
    shown = now;
  });
  cleanup(() => {
    coverIn.stop();
    wordsIn.stop();
  });
  const cover = () => (
    <View style={coverIn.style}>
      <Cover src={player().artwork} size={props.cover ?? 56} round={props.round} />
    </View>
  );
  const words = (selectable: boolean) => (
    <View class={`min-w-0 flex-1 gap-0.5 ${props.center ? "items-center" : ""}`} style={wordsIn.style} selectable={selectable}>
      <Text class={`line-clamp-1 font-semibold text-foreground ${props.large ? "text-3xl font-extrabold" : "text-sm"} ${props.center ? "text-center" : ""}`}>
        {player().title || "Nothing playing"}
      </Text>
      <View class={`min-w-0 flex-row items-center gap-2 ${props.center ? "justify-center" : ""}`}>
        <Text class={`line-clamp-1 min-w-0 shrink text-muted-foreground ${props.large ? "text-base" : "text-xs"} ${props.center ? "text-center" : ""}`}>{subtitle()}</Text>
        <If when={player().ad}>
          <TextLink label="Get Premium" onPress={openPremium} />
        </If>
      </View>
    </View>
  );
  const withCover = () => !terminal && props.cover !== 0;
  // Openable: the whole of it (cover and words) opens Now Playing; during an
  // ad it stays plain, its Premium link pressable on its own.
  return (
    <If
      when={props.openable && hasTrack() && !player().ad && !terminal}
      else={
        <View class="min-w-0 flex-1 flex-row items-center gap-3">
          <If when={withCover()}>{cover()}</If>
          {/* Words that are only read can be selected and copied. */}
          {words(!props.openable && !terminal)}
        </View>
      }
    >
      <Button
        ref={regionItem()}
        testID="open-now-playing"
        accessibilityLabel={`Open Now Playing: ${player().title}, ${player().artist}`}
        onPress={() => setNowPlayingOpen(true)}
        class={`group min-w-0 flex-1 flex-row items-center gap-3 rounded-full pr-2 active:scale-[0.98] motion-reduce:active:scale-100 ${focusRing}`}
      >
        <If when={withCover()}>
          <View class="transition duration-150 ease-out group-hover:opacity-85 motion-reduce:transition-none">{cover()}</View>
        </If>
        {words(false)}
      </Button>
    </If>
  );
}
