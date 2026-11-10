// The app's styled controls, each wrapping a base component once. Pages and
// app components compose these; they do not restyle base controls.
//
// In a terminal (`terminal`), images do not draw: icon-only controls show a
// short text label, and covers take no Cells.

import { type AnimatedValue, effect, Image, platform, type MotionSpec, reduceMotion, signal, Text, token, untracked, View } from "nsh";
import type { JSX, ViewProps } from "nsh";
import { Button, Slider, Tooltip } from "nsh/base";
import { alpha, tint } from "../../state/tint";
import { imageFor } from "../../data/images";
import { Icon, type IconColor, iconMotion, type IconName, SwapIcon } from "./icons";
import { lazyMotion } from "./motion";
import { regionItem } from "./regions";
import { DISTANCE, DURATION, DURATION_CLASS, EASE_CLASS, SCALE, SMOOTH_OUT } from "./tokens";

/** The app runs in a terminal: Cells and text, no images. */
export const terminal = platform.idiom === "terminal";

/** The focus ring every control shares. */
export const focusRing = "focus:outline focus:outline-2 focus:outline-ring";

/** The keyboard's highlight on an item of a list that has the focus
 * (`createListKeys`): the focus ring, drawn by the list's choice since its
 * items are no stops of their own. */
export const keyRing = platform.idiom === "terminal" ? "bg-muted" : "outline outline-2 outline-ring";

/** What takes a press: a `Button` (a stop of Tab), or with
 * `focusable={false}` a view that takes presses with a button's role and
 * states, left to the pointer and to its list's arrow keys
 * (`createListKeys`). `Button` has no `focusable` of its own. Read once. */
export function Pressable(props: {
  focusable?: boolean;
  accessibilityLabel?: string;
  selected?: boolean;
  disabled?: boolean;
  tooltip?: JSX.Element;
  onPress: () => void;
  class?: string;
  classList?: Record<string, boolean>;
  style?: ViewProps["style"];
  children?: JSX.Element;
}) {
  if (untracked(() => props.focusable) === false) {
    return (
      <View
        role="button"
        focusable={false}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={{ selected: props.selected ?? false, disabled: props.disabled ?? false }}
        disabled={props.disabled ?? false}
        tooltip={props.tooltip}
        onPress={props.onPress}
        class={props.class}
        classList={props.classList}
        style={props.style}
      >
        {props.children}
      </View>
    );
  }
  return (
    <Button
      ref={regionItem()}
      accessibilityLabel={props.accessibilityLabel}
      selected={props.selected ?? false}
      disabled={props.disabled ?? false}
      tooltip={props.tooltip}
      onPress={props.onPress}
      class={props.class}
      classList={props.classList}
      style={props.style}
    >
      {props.children}
    </Button>
  );
}

/** The popup surface every menu, popover and tooltip-like panel shares. */
export const popupSurface = "rounded-(--radius-card) border border-border bg-popover p-1 shadow-lg";

/** A menu row: compact, the same padding, radius and states everywhere. */
export const menuItem =
  "h-8 flex-row items-center rounded-(--radius) px-2.5 hover:bg-muted focus:bg-muted active:bg-muted disabled:opacity-40";

/** How an animated layer of a control moves between its states (rest,
 * hover, press): quick, eased, still with reduced motion. */
export const LAYER = `transition ${DURATION_CLASS.fast} ${EASE_CLASS.out} motion-reduce:transition-none`;

/** How a control, or a layer of it, presses in and settles back (after
 * affectui's clean button: a short, soft ease-out; still with reduced
 * motion). */
const PRESS = `transition ${DURATION_CLASS.fast} ${EASE_CLASS.smoothOut} motion-reduce:transition-none`;

/** How a wash or a colour comes and goes: quicker than a press. */
const WASH = `transition ${DURATION_CLASS.instant} ${EASE_CLASS.out} motion-reduce:transition-none`;

/** A whole button pressed: a little smaller, not on reduced motion. */
const PRESSED = `active:scale-[${SCALE.pressSoft}] disabled:active:scale-100 motion-reduce:active:scale-100`;

/** A label coming in after it changed (affectui's label morph, without its
 * blur): up a little from below as it fades in. */
const LABEL_IN: MotionSpec = {
  keyframes: { opacity: [0, 1], translateY: [DISTANCE.small, 0] },
  duration: DURATION.slow,
  easing: SMOOTH_OUT,
};

/** A hint bubble: shown by the desktops while the pointer rests on a
 * control, and as the keyboard focus reaches it. */
export function Hint(props: { label: string }) {
  return (
    <Tooltip class="rounded-(--radius) bg-popover px-2 py-1 shadow-md" placement="right">
      <Text class="text-xs font-medium text-popover-foreground">{props.label}</Text>
    </Tooltip>
  );
}

export interface IconButtonProps {
  name: IconName;
  /** What it does: screen readers say it, a terminal shows it. */
  label: string;
  /** A terminal's shorter label (default `label`). */
  short?: string;
  /** Points (default 18). */
  size?: number;
  /** A toggle that is on: drawn in the primary color, on a soft disc of it. */
  pressed?: boolean;
  /** The color while `pressed`, instead of the primary color and the dot
   * (Liked's red heart). */
  pressedColor?: IconColor;
  /** While `pressed`, the colour of what plays (`state/tint`), not the
   * primary. */
  tinted?: boolean;
  disabled?: boolean;
  /** Shows `label` in a tooltip (for icons whose meaning is not obvious). */
  hint?: boolean;
  /** Selected (a navigation destination): screen readers say so. */
  selected?: boolean;
  onPress: () => void;
}

/** A borderless icon button: brighter on hover, primary while `pressed`. */
export function IconButton(props: IconButtonProps) {
  const size = () => props.size ?? 18;
  const item = regionItem();
  if (terminal) {
    return (
      <Button
        ref={item}
        accessibilityLabel={props.label}
        disabled={props.disabled ?? false}
        selected={props.selected ?? false}
        onPress={props.onPress}
        class="px-1 focus:bg-muted disabled:opacity-50"
      >
        <Text class={props.pressed ? "font-bold text-primary" : "text-foreground"}>[{props.short ?? props.label}]</Text>
      </Button>
    );
  }
  const color = (): IconColor => (props.pressed ? (props.pressedColor ?? "primary") : "foreground");
  // On, with the primary's look (not a colour of its own, as Liked's heart).
  const on = () => (props.pressed ?? false) && !props.pressedColor;
  const hover = iconMotion();
  return (
    <View onMouseEnter={() => !props.disabled && hover.play(props.name)}>
    <Button
      ref={item}
      accessibilityLabel={props.label}
      disabled={props.disabled ?? false}
      selected={props.selected ?? false}
      onPress={props.onPress}
      tooltip={props.hint ? <Hint label={props.label} /> : undefined}
      class={`group relative items-center justify-center rounded-full disabled:opacity-30 ${focusRing}`}
      style={{ width: size() + 16, height: size() + 16 }}
    >
      {/* Layer 1: a translucent disc that settles in under the pointer and
          deepens as it presses: whatever is behind shows through. A toggle
          that is on keeps it, in its own colour. */}
      <View
        class={`absolute inset-0 rounded-full ${PRESS} group-active:scale-[${SCALE.press}] ${
          on() ? "bg-primary/15 opacity-100 scale-100" : `bg-foreground/10 opacity-0 scale-[${SCALE.enter}] group-hover:scale-100 group-hover:opacity-100 group-active:bg-foreground/15 group-disabled:opacity-0`
        }`}
        style={on() && props.tinted ? { backgroundColor: alpha(tint(), 0.18) } : undefined}
      />
      {/* Layer 2: the glyph brightens (its drawing morphs, `iconMotion`), then
          sinks as it presses; a new glyph swaps in (`SwapIcon`). */}
      <View
        class={`${PRESS} group-active:scale-[${SCALE.press}] group-disabled:scale-100 ${
          props.pressed ? "opacity-100" : "opacity-70 group-hover:opacity-100"
        }`}
      >
        <View style={hover.style}>
          <SwapIcon name={props.name} t={hover.t()} size={size()} color={color()} hex={props.pressed && props.tinted && !props.pressedColor ? alpha(tint(), 0.95) : undefined} />
        </View>
      </View>
    </Button>
    </View>
  );
}

/** The round play / pause button, `size` across. */
/** `quiet`: no border or shadow, a faint disc (Now Playing, where the music
 * light leads). */
export function PlayButton(props: {
  playing: boolean;
  size?: number;
  disabled?: boolean;
  tinted?: boolean;
  quiet?: boolean;
  /** `false`: no stop of Tab (a card's, in a list the arrow keys move
   * through). */
  focusable?: boolean;
  onPress: () => void;
}) {
  const size = () => props.size ?? 36;
  const label = () => (props.playing ? "Pause" : "Play");
  if (terminal) {
    return (
      <Button accessibilityLabel={label()} disabled={props.disabled ?? false} onPress={props.onPress} class="px-1 focus:bg-muted disabled:opacity-50">
        <Text class="font-bold text-primary">[{label()}]</Text>
      </Button>
    );
  }
  const hover = iconMotion();
  return (
    <View onMouseEnter={() => !props.disabled && hover.play(props.playing ? "pause" : "play")}>
    <Pressable
      focusable={props.focusable}
      accessibilityLabel={label()}
      disabled={props.disabled ?? false}
      onPress={props.onPress}
      class={`group items-center justify-center overflow-hidden rounded-full ${props.quiet ? "" : "bg-background/80 shadow-md hover:shadow-lg active:shadow-sm"} ${PRESS} ${PRESSED} disabled:opacity-40 ${focusRing}`}
      style={{ width: size(), height: size(), ...(props.tinted || props.quiet ? { backgroundColor: alpha(tint(), props.quiet ? 0.08 : 0.16) } : {}) }}
    >
      {/* A shade that comes in on hover and deepens as it presses. */}
      <View class={`absolute inset-0 rounded-full bg-foreground opacity-0 ${WASH} group-hover:opacity-10 group-active:opacity-15 group-disabled:opacity-0`} />
      <View class={`${PRESS} group-active:scale-[${SCALE.press}] group-disabled:scale-100`}>
        <View style={hover.style}>
          <SwapIcon name={props.playing ? "pause" : "play"} t={hover.t()} size={size() * 0.4} color="foreground" hex={props.tinted ? tint() : undefined} />
        </View>
      </View>
    </Pressable>
    </View>
  );
}

/** A labeled button: `primary` for the one emphasized commitment of an
 * area, `outline` (default) for the others. */
export function ActionButton(props: {
  label: string;
  variant?: "primary" | "outline";
  disabled?: boolean;
  onPress: () => void;
}) {
  const primary = () => props.variant === "primary";
  const item = regionItem();
  if (terminal) {
    return (
      <Button ref={item} disabled={props.disabled ?? false} onPress={props.onPress} class="px-1 focus:bg-muted disabled:opacity-50">
        <Text class={primary() ? "font-bold text-primary" : "text-foreground"}>[{props.label}]</Text>
      </Button>
    );
  }
  // A new label comes in (not the first: that one just shows). Made with
  // the first new label.
  const label = lazyMotion();
  let shown = untracked(() => props.label);
  effect(() => {
    const now = props.label;
    if (now === shown) return;
    shown = now;
    if (!untracked(reduceMotion)) void label.play(LABEL_IN);
  });
  return (
    <Button
      ref={item}
      disabled={props.disabled ?? false}
      onPress={props.onPress}
      class={`group h-9 items-center justify-center overflow-hidden rounded-full px-5 ${PRESS} ${PRESSED} disabled:opacity-40 ${focusRing} ${
        primary() ? "bg-foreground shadow-sm hover:shadow-md" : "border border-border bg-secondary hover:border-muted-foreground"
      }`}
    >
      {/* A wash that comes in over the button on hover and deepens as it
          presses. */}
      <View
        class={`absolute inset-0 rounded-full opacity-0 ${WASH} group-hover:opacity-10 group-active:opacity-15 group-disabled:opacity-0 ${
          primary() ? "bg-background" : "bg-foreground"
        }`}
      />
      <Text class={`text-sm font-bold ${primary() ? "text-background" : "text-foreground"}`} style={label.style}>
        {props.label}
      </Text>
    </Button>
  );
}

/** A quiet text button for a link that leaves the app (the `link` role):
 * underlined on hover, pressed in as a whole. */
export function TextLink(props: { label: string; onPress: () => void; small?: boolean; class?: string }) {
  return (
    <Button
      role="link"
      onPress={props.onPress}
      class={`group self-start rounded-sm ${PRESS} ${PRESSED} active:opacity-70 ${focusRing} ${props.class ?? ""}`}
    >
      <Text class={`font-semibold text-primary hover:underline ${props.small ? "text-xs" : "text-sm"}`}>{props.label}</Text>
    </Button>
  );
}

/** An item's image, square (or round for an artist), with a glyph while it
 * has none. Sized by `size` (points) or by `class` (`w-full max-w-52`). In a
 * terminal it takes no Cells. `liked` is Liked Songs' own cover, a red heart
 * tile, in place of the artwork. */
export function Cover(props: {
  src: string;
  size?: number;
  round?: boolean;
  liked?: boolean;
  fallback?: IconName;
  class?: string;
}) {
  if (terminal) return <View class="hidden" />;
  const glyph = () => (props.size ? Math.max(16, props.size * 0.42) : 72);
  return (
    <View
      class={`shrink-0 items-center justify-center overflow-hidden ${props.liked ? "bg-liked" : "bg-secondary"} ${
        props.round ? "rounded-full" : "rounded-md"
      } ${props.size ? "" : "aspect-square w-full"} ${props.class ?? ""}`}
      style={props.size ? { width: props.size, height: props.size } : {}}
    >
      <Icon
        name={props.liked ? "heartFilled" : (props.fallback ?? "music")}
        size={props.liked ? glyph() : props.size ? Math.max(16, props.size * 0.4) : 40}
        color={props.liked ? "liked-foreground" : "muted-foreground"}
      />
      <If when={props.src && !props.liked}>
        <Image src={imageFor(props.src, props.size)} accessibilityElementsHidden class="absolute inset-0 object-cover" />
      </If>
    </View>
  );
}

/** A slider (position, volume): a track with a filled range and a thumb
 * that shows on hover, focus and drag. */
export function BarSlider(props: {
  label: string;
  value: number;
  max: number;
  disabled?: boolean;
  /** The range in the colour of what plays (`state/tint`). */
  tinted?: boolean;
  /** Thin and faint, for where something else leads (Now Playing). */
  quiet?: boolean;
  class?: string;
  onChange: (value: number) => void;
  onChangeEnd: (value: number) => void;
  /** Where the range ends, 0..1, as an animated value that moves natively
   * (the position while it plays): the range follows it on the compositor,
   * every display frame, with no JS and nothing redrawn, and `value` need
   * only change when its screen-reader value should. */
  fill?: AnimatedValue;
}) {
  const fill = props.fill;
  // The range drawn natively from `fill` (not in a terminal, which draws
  // its own slider of glyphs). The slider's own range stays for its
  // layout and states, transparent.
  const drawn = !!fill && !terminal;
  return (
    <Slider
      accessibilityLabel={props.label}
      value={props.value}
      min={0}
      max={props.max}
      step={0}
      disabled={props.disabled ?? false}
      class={props.class}
      trackClass="group h-5 justify-center"
      // The range fills the track, so both share one centre line.
      // One height at rest and on hover (the taller one): it never jumps.
      indicatorClass={`rounded-full ${props.quiet ? "h-1.5 bg-foreground/8" : "h-2 bg-foreground/12"}`}
      rangeClass={`h-full rounded-full ${props.quiet ? "bg-foreground/35" : "bg-foreground/55"} disabled:bg-muted-foreground ${drawn ? "opacity-0" : ""}`}
      // No thumb dot: the bar itself is the control (it still takes the
      // keyboard focus and screen readers through the slider).
      thumbClass="size-0 opacity-0"
      rangeStyle={
        props.tinted && !props.disabled && !drawn
          ? { backgroundImage: `linear-gradient(90deg, ${alpha(tint(), props.quiet ? 0.2 : 0.3)}, ${alpha(tint(), props.quiet ? 0.4 : 0.6)})` }
          : undefined
      }
      onChange={({ value }) => typeof value === "number" && props.onChange(value)}
      onChangeEnd={({ value }) => typeof value === "number" && props.onChangeEnd(value)}
    >
      {drawn ? (
        // Over the indicator (the track centres it), presses going through.
        <View class="pointer-events-none absolute inset-0 justify-center">
          <NativeRange fill={fill} quiet={props.quiet} disabled={props.disabled} tinted={props.tinted} />
        </View>
      ) : undefined}
    </Slider>
  );
}

/** The range of a `BarSlider` with `fill`, as its classes draw it: a pill
 * from the start to `fill` of the width, in `bg-foreground/55` (`/35`
 * quiet; `muted-foreground` disabled) and, tinted, the cover's gradient
 * over it, spread over the range as `linear-gradient(90deg, ..)` is.
 *
 * Moved, not drawn: a pill as wide as the track slides in from the left
 * (`translate`, its round end the range's), clipped by the track (its
 * round start), and the gradient is squeezed to the range from the pill's
 * end (`scale` about the right). The compositor moves both every display
 * frame from `fill`; nothing is redrawn as it plays (a canvas drawn from
 * it was rasterized again each frame). Only the colours and the width run
 * JS, when they change. */
function NativeRange(props: { fill: AnimatedValue; quiet?: boolean; disabled?: boolean; tinted?: boolean }) {
  const width = signal(0);
  const fill = props.fill;
  return (
    <View
      class={`w-full overflow-hidden rounded-full ${props.quiet ? "h-1.5" : "h-2"}`}
      onLayout={(e) => width.set(e.bounds.size.width)}
    >
      <View
        class={`absolute inset-0 overflow-hidden rounded-full ${
          props.disabled ? "bg-muted-foreground" : props.quiet ? "bg-foreground/35" : "bg-foreground/55"
        }`}
        // Out of sight until the track has a width to slide along.
        style={{ opacity: width() > 0 ? 1 : 0, translate: fill.mul(width()).sub(width()) }}
      >
        <If when={props.tinted && !props.disabled}>
          <View
            class="absolute inset-0"
            style={{
              backgroundImage: `linear-gradient(90deg, ${alpha(tint(), props.quiet ? 0.2 : 0.3)}, ${alpha(tint(), props.quiet ? 0.4 : 0.6)})`,
              transformOrigin: "right center",
              scale: [fill, 1],
            }}
          />
        </If>
      </View>
    </View>
  );
}

/** A section's title. */
export function SectionTitle(props: { children: JSX.Element; class?: string }) {
  return (
    <Text role="header" class={`text-xl font-bold text-foreground ${props.class ?? ""}`}>
      {props.children}
    </Text>
  );
}
