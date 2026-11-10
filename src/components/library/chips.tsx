// Chips: pages to open as a wrapping row of pills (Explore's own pages, the
// moods and genres, each with its colour), and Home's filters as a row of
// toggles that scrolls sideways.

import { Scroll, Text, View } from "nsh";
import type { Chip, Item } from "../../backend/types";
import { open } from "../../nav";
import { focusRing, LAYER, Pressable, terminal } from "../ui/controls";
import { routeOf } from "./cards";

/** Pages to open, as pills that wrap; a mood's colour is a stripe at its
 * start. */
export function PageChips(props: { items: Item[]; class?: string }) {
  return (
    <View class={`flex-row flex-wrap gap-2 ${props.class ?? ""}`}>
      <Each of={props.items} key={(i) => i.uri}>
        {(item) => (
          <Pressable
            accessibilityLabel={item().name}
            onPress={() => open(routeOf(item()))}
            class={
              terminal
                ? "px-1 focus:bg-muted"
                : `h-10 min-w-36 flex-row items-center gap-3 overflow-hidden rounded-(--radius) bg-secondary pr-4 ${LAYER} hover:bg-muted active:scale-[0.98] ${focusRing}`
            }
          >
            <If when={!terminal}>
              <View class="h-full w-1.5" style={{ backgroundColor: item().color || "transparent" }} />
            </If>
            <Text class="line-clamp-1 text-sm font-semibold text-foreground">{item().name}</Text>
          </Pressable>
        )}
      </Each>
    </View>
  );
}

/** Home's filters: one is on at a time; choosing the one that is on turns
 * it off (Home unfiltered). */
export function FilterChips(props: { chips: Chip[]; selected: string; onSelect: (params: string) => void }) {
  return (
    <Scroll horizontal scrollbar={false} class="-mx-3 shrink-0" contentClass="flex-row gap-2 px-3">
      <Each of={props.chips} key={(c) => c.params}>
        {(chip) => {
          const on = () => props.selected === chip().params;
          return (
            <Pressable
              accessibilityLabel={chip().title}
              selected={on()}
              onPress={() => props.onSelect(on() ? "" : chip().params)}
              class={
                terminal
                  ? "px-1 focus:bg-muted selected:bg-muted"
                  : `h-8 items-center justify-center rounded-(--radius) px-3 ${LAYER} active:scale-95 ${focusRing} ${
                      on() ? "bg-foreground" : "bg-secondary hover:bg-muted"
                    }`
              }
            >
              <Text class={`text-sm font-medium ${on() ? "text-background" : "text-foreground"}`}>{chip().title}</Text>
            </Pressable>
          );
        }}
      </Each>
    </Scroll>
  );
}
