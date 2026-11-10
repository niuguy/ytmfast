// The app's overlay surfaces: `nsh/base`'s `Dialog` and `Sheet` with the
// app's look. They bring focus, Escape, Android's back and dismissal; the
// caller owns `open` and follows `onOpenChange`.

import { createMotion, type JSX, type MotionSpec, View } from "nsh";
import { Dialog, Sheet } from "nsh/base";
import { terminal } from "./controls";
import { enter } from "./motion";
import { TitleBar } from "./title-bar";

/** A dialog's entrance: up a little from slightly smaller, settling
 * without overshoot, as the scrim fades. */
const RISE: MotionSpec = {
  keyframes: { opacity: [0, 1], scale: [0.97, 1], translateY: [10, 0] },
  duration: 240,
  easing: "easeOut",
};

/** The scrim behind a modal surface. */
const BACKDROP = "bg-shell/80";

/** A centered dialog. `closeOnEscape` (default true) lets Escape and back
 * close it; `onOpenChange` hears it close. */
export function AppDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeOnEscape?: boolean;
  closeOnBackdropPress?: boolean;
  testID?: string;
  children?: JSX.Element;
}) {
  return (
    <Dialog
      open={props.open}
      testID={props.testID}
      animation={terminal ? "none" : "fade"}
      closeOnEscape={props.closeOnEscape ?? true}
      closeOnBackdropPress={props.closeOnBackdropPress ?? true}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      class={
        terminal
          ? "m-auto w-full max-w-2xl border border-border bg-popover p-2"
          : "m-auto w-full max-w-md overflow-hidden rounded-(--radius-panel) bg-popover shadow-2xl"
      }
      backdropClass={terminal ? undefined : BACKDROP}
    >
      {/* The panel pops in as the scrim fades. */}
      <If when={!terminal} else={props.children}>
        <View style={createMotion({ enter: RISE }).style}>{props.children}</View>
      </If>
    </Dialog>
  );
}

/** A panel at an edge: the phone's drawer (`left`), the desktop's queue
 * (`right`), Now Playing, the first-run sheet and the phone's queue
 * (`bottom`). */
export function AppSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right" | "bottom";
  /** Covers the whole screen (Now Playing). */
  full?: boolean;
  /** A bottom sheet that takes most of the screen (the queue's list
   * scrolls in it). */
  tall?: boolean;
  closeOnSwipe?: boolean;
  testID?: string;
  children?: JSX.Element;
}) {
  const panel = () => {
    if (props.full) return "h-full w-full bg-background";
    if (props.side === "left") return "h-full w-80 max-w-full bg-background";
    if (props.side === "right") return "h-full w-96 max-w-full border-l border-border bg-background";
    return `${props.tall ? "h-[85%]" : "max-h-full"} w-full rounded-t-(--radius-panel) bg-popover pb-[env(safe-area-inset-bottom)]`;
  };
  return (
    <Sheet
      open={props.open}
      side={props.side}
      testID={props.testID}
      closeOnSwipe={props.closeOnSwipe ?? false}
      onOpenChange={(e) => props.onOpenChange(e.open)}
      popupClass={panel()}
      backdropClass={props.full ? "bg-background" : BACKDROP}
    >
      {/* A side panel reaches the window's top edge: the title bar's band
          keeps it clear of the window controls and drags the window. A
          full one (Now Playing) places its own top row under them. */}
      <If when={props.side === "left" && !props.full}>
        <TitleBar brand={false} />
      </If>
      {/* The content rises in behind the sliding panel. */}
      <If when={!terminal} else={props.children}>
        <View class={props.full || props.side !== "bottom" || props.tall ? "flex-1" : ""} style={enter("fadeInUp", 90)}>
          {props.children}
        </View>
      </If>
    </Sheet>
  );
}
