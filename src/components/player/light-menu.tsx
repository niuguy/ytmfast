// The music light's menu, opened at the effect in use: Random first (another effect for each track),
// set apart by a line, then the effects, numbered, one line each, the one in use checked (a
// check on the right; under Random, the one it picked carries a faint
// shuffle mark instead); the list scrolls when it is taller than the room. Its trigger
// is an icon button (the player bar's, Now Playing's); choosing an effect
// changes both, and is remembered (`state/visual`).

import { Scroll, signal, Text, View } from "nsh";
import { Button, Menu, MenuItem, MenuSeparator } from "nsh/base";
import { regionItem } from "../ui/regions";
import { lightEffect, lightName, lightRandom, setLight } from "../../state/visual";
import { focusRing, Hint, LAYER, menuItem, popupSurface, terminal } from "../ui/controls";
import { Icon, iconMotion } from "../ui/icons";
import { menuPopupHidden, menuPopupLeaving, menuPopupStyle } from "../ui/menu";
import { EFFECT_NAMES, TOOLBAR_EFFECTS, type ToolbarEffect } from "../ui/toolbar-fx";

// A row's height (`menuItem`'s h-8) and the list's (`max-h-72`).
const ROW = 32;
const VIEW = 288;

export function LightMenu(props: { placement: "top" | "bottom"; size?: number }) {
  const open = signal(false);
  const hover = iconMotion();
  const size = () => props.size ?? 18;
  const label = () => `Light: ${lightName()}`;
  // The effects' list: rows of ROW points in a window of VIEW. Where it
  // starts, so the effect in use is in the middle of it.
  const openAt = () => {
    const i = TOOLBAR_EFFECTS.indexOf(lightEffect());
    const most = Math.max(0, TOOLBAR_EFFECTS.length * ROW - VIEW);
    return Math.min(most, Math.max(0, i * ROW - (VIEW - ROW) / 2));
  };
  return (
    <Menu
      open={open()}
      onOpenChange={(e) => open.set(e.open)}
      placement={props.placement}
      align="end"
      offset={6}
      popupClass={`w-52 ${popupSurface}`}
      popupStyle={menuPopupStyle(props.placement, "end")}
      popupStartingStyle={menuPopupHidden(props.placement, "end")}
      popupEndingStyle={menuPopupLeaving(props.placement, "end")}
      trigger={
        <Button
          ref={regionItem()}
          accessibilityLabel={label()}
          selected={open()}
          tooltip={open() ? undefined : <Hint label={label()} />}
          class={
            terminal
              ? "px-1 focus:bg-muted"
              : `group relative items-center justify-center rounded-full ${focusRing}`
          }
          style={terminal ? undefined : { width: size() + 16, height: size() + 16 }}
        >
          <If when={terminal}>
            <Text class="text-foreground">[Light]</Text>
          </If>
          <If when={!terminal}>
            {/* The same layers as an icon button: a disc under the pointer
                (kept while the menu is open), the glyph brightening. */}
            <View
              class={`absolute inset-0 rounded-full bg-foreground/10 opacity-0 scale-50 ${LAYER} group-hover:scale-100 group-hover:opacity-100 group-selected:scale-100 group-selected:opacity-100 group-active:scale-90`}
            />
            <View
              onMouseEnter={() => hover.play("sparkles")}
              class={`${LAYER} opacity-70 group-hover:opacity-100 group-selected:opacity-100 group-active:scale-90`}
            >
              <View style={hover.style}>
                <Icon name="sparkles" t={hover.t()} size={size()} color="foreground" />
              </View>
            </View>
          </If>
        </Button>
      }
    >
      <MenuItem
        role="menuitemradio"
        checked={lightRandom()}
        onSelect={() => setLight("random")}
        class={terminal ? "px-1 focus:bg-muted" : `group ${menuItem} gap-2.5`}
        indicatorClass={terminal ? undefined : "hidden"}
      >
        {/* In the numbers' column: a shuffle mark, as wide as two digits. */}
        <If when={!terminal}>
          <View class="w-[15px] items-start">
            <Icon name="shuffle" size={12} color="muted-foreground" />
          </View>
        </If>
        <Text class="line-clamp-1 flex-1 text-sm text-popover-foreground group-checked:font-semibold">Random</Text>
        <If when={!terminal && lightRandom()}>
          <Icon name="check" size={12} color="foreground" />
        </If>
      </MenuItem>
      {/* Random apart from the effects, above a line; the effects scroll
          under it when they are taller than the window allows. */}
      <MenuSeparator class={terminal ? "hidden" : "-mx-1 my-1 h-px bg-border"} />
      {/* Opened where the effect in use is, in the middle when it can be
          (the rows are made afresh on each opening, so this is where each
          opening starts). */}
      <Scroll class="max-h-72" contentOffset={{ y: terminal ? 0 : openAt() }}>
      <Each of={TOOLBAR_EFFECTS} key={(e) => e}>
        {(effect) => (
          <MenuItem
            role="menuitemradio"
            checked={!lightRandom() && lightEffect() === effect()}
            onSelect={() => setLight(effect())}
            class={terminal ? "px-1 focus:bg-muted" : `group ${menuItem} gap-2.5`}
            indicatorClass={terminal ? undefined : "hidden"}
          >
            {/* Its number, two digits (01) in monospace, starting where the title
                does, so the column lines up. */}
            <Text class="font-mono text-xs tabular-nums text-muted-foreground">{String(TOOLBAR_EFFECTS.indexOf(effect()) + 1).padStart(2, "0")}</Text>
            <Text class="line-clamp-1 flex-1 text-sm text-popover-foreground group-checked:font-semibold">{EFFECT_NAMES[effect()]}</Text>
            {/* The one in use: a check on the right. */}
            <If when={!terminal && !lightRandom() && lightEffect() === effect()}>
              <Icon name="check" size={12} color="foreground" />
            </If>
            {/* Random's pick for this track. */}
            <If when={!terminal && lightRandom() && lightEffect() === effect()}>
              <Icon name="shuffle" size={12} color="muted-foreground" />
            </If>
          </MenuItem>
        )}
      </Each>
      </Scroll>
    </Menu>
  );
}
