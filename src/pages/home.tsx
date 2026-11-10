// Home: the greeting, then the sections of the day.

import { List, signal, Text, untracked, View } from "nsh";
import { FilterChips } from "../components/library/chips";
import { pageEnd, playerOverlap } from "../components/layout";
import { homeQuery } from "../data/queries";
import { CardRow } from "../components/library/cards";
import { CardsSkeleton, ErrorState, Reveal } from "../components/ui/feedback";
import { terminal } from "../components/ui/controls";
import { createListWave, enter, waveDelay } from "../components/ui/motion";
import { createListGroup, KEYS_VIEWABILITY } from "../components/ui/list-keys";
import { currentRoute, rootOpens } from "../nav";
import { AppPage } from "../components/page";

/** The greeting. It rises in only when made with `entrance` (the page
 * opening): made again as the list's header, it just shows. */
function Greeting(props: { text: string; entrance?: boolean }) {
  const style = untracked(() => (props.entrance && !terminal ? enter("fadeInUp") : undefined));
  return (
    <Text role="header" class="px-3 text-4xl font-extrabold text-foreground" style={style}>
      {props.text}
    </Text>
  );
}

/** The chip Home is filtered by ("" for none); kept while the app runs. */
const chip = signal("");

export function HomePage() {
  const home = homeQuery(chip);
  return (
    <AppPage title="Home" testID="page-home" shown={() => currentRoute().name === "home"}>
      {/* Virtualized both ways: the sections down the page are a list, and
          each section's cards a list across, so only what is near the view
          exists. */}
      <Reveal
        data={home.data()}
        placeholder={
          <View class={terminal ? "gap-1" : `gap-8 px-3 ${pageEnd()}`}>
            <Greeting text="Home" entrance />
            <If when={home.error()} else={<CardsSkeleton />}>
              <ErrorState message="Home didn't load." onRetry={home.refetch} />
            </If>
          </View>
        }
        class="flex-1"
      >
        {(data, instant) => {
          // When Home opens (not when it is gone back to; again when it is
          // chosen again from the sidebar or its tab), each section's
          // cards come in as a wave, each section a little after the one above; cards scrolled
          // to come in on their own.
          const wave = createListWave({ isTop: () => currentRoute().name === "home", reenter: rootOpens, afterReveal: !instant });
          // The rows of cards are one region: one stop of Tab, Left and
          // Right along a row, Up and Down from row to row.
          const group = createListGroup({
            count: () => data().sections.length,
            region: "main",
            when: () => currentRoute().name === "home",
            // A section is about 270pt; the player floats over the bottom.
            cover: { inset: playerOverlap, itemSize: 270 },
          });
          return (
          <List
            ref={group.ref}
            onViewableItemsChange={group.onViewableItemsChange}
            viewabilityConfig={KEYS_VIEWABILITY}
            each={data().sections}
            keyExtractor={(s) => s.title}
            estimatedItemSize={terminal ? 4 : 270}
            class="flex-1"
            contentClass={terminal ? "" : "px-3"}
            header={() => (
              <View class={terminal ? "gap-1" : "gap-4"}>
                <Greeting text={data().greeting || "Home"} entrance={instant} />
                {/* Home's filters ("Relax", "Workout"): one at a time. */}
                <If when={(data().chips ?? []).length > 0 && !terminal}>
                  <View class="px-3">
                    <FilterChips chips={data().chips ?? []} selected={chip()} onSelect={(p) => chip.set(p)} />
                  </View>
                </If>
              </View>
            )}
            footer={() => <View class={pageEnd()} />}
          >
            {(section, i) => (
              <If when={section()}>
                {(s) => (
                  <CardRow
                    title={s().title}
                    items={s().items}
                    wave={wave}
                    delay={waveDelay(i(), 4)}
                    group={group}
                    order={i()}
                    class={terminal ? "" : "pt-8"}
                  />
                )}
              </If>
            )}
          </List>
          );
        }}
      </Reveal>
    </AppPage>
  );
}
