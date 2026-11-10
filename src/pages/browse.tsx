// Browse pages: Explore (a root, from the sidebar), and the pages it opens:
// new releases, charts, moods and genres, one mood or genre. A page is its
// title, then its rows: covers in rows that scroll sideways, and pages to
// open as chips.

import { List, Text, untracked, View } from "nsh";
import type { Section } from "../backend/types";
import { pageEnd, playerOverlap } from "../components/layout";
import { CardRow } from "../components/library/cards";
import { PageChips } from "../components/library/chips";
import { AppPage } from "../components/page";
import { SectionTitle, terminal } from "../components/ui/controls";
import { CardsSkeleton, ErrorState, Reveal } from "../components/ui/feedback";
import { createListGroup, KEYS_VIEWABILITY } from "../components/ui/list-keys";
import { createListWave, enter, waveDelay } from "../components/ui/motion";
import { currentRoute, rootOpens } from "../nav";
import { pageQuery } from "../data/queries";

/** Explore's own URI. */
export const EXPLORE_URI = "ytm:page:FEmusic_explore";

function Title(props: { text: string; entrance?: boolean }) {
  const style = untracked(() => (props.entrance && !terminal ? enter("fadeInUp") : undefined));
  return (
    <Text role="header" class="px-3 text-4xl font-extrabold text-foreground" style={style}>
      {props.text}
    </Text>
  );
}

/** One row of a page: chips (with their title, when they have one), or
 * cards. */
function Row(props: { section: Section; index: number; wave: ReturnType<typeof createListWave>; group: ReturnType<typeof createListGroup> }) {
  return (
    <If
      when={props.section.kind === "buttons"}
      else={
        <CardRow
          title={props.section.title}
          items={props.section.items}
          wave={props.wave}
          delay={waveDelay(props.index, 4)}
          group={props.group}
          order={props.index}
          class={terminal ? "" : "pt-8"}
        />
      }
    >
      <View class={terminal ? "gap-1" : "gap-3 pt-8"}>
        <If when={props.section.title}>
          <SectionTitle class="px-3">{props.section.title}</SectionTitle>
        </If>
        <PageChips items={props.section.items} class="px-3" />
      </View>
    </If>
  );
}

/** A browse page by URI; `root` when it is Explore, a root of the stack. */
export function BrowsePage(props: { uri: string; root?: boolean }) {
  const page = pageQuery(() => props.uri);
  const isTop = () => {
    const route = currentRoute();
    return props.root ? route.name === "explore" : route.name === "page" && route.uri === props.uri;
  };
  const title = () => page.data()?.title || (props.root ? "Explore" : "");
  return (
    <AppPage title={title()} testID={props.root ? "page-explore" : `page-${props.uri}`} shown={isTop}>
      <Reveal
        data={page.data()}
        placeholder={
          <View class={terminal ? "gap-1" : `gap-8 px-3 ${pageEnd()}`}>
            <Title text={title()} entrance />
            <If when={page.error()} else={<CardsSkeleton />}>
              <ErrorState message="This page didn't load." onRetry={page.refetch} />
            </If>
          </View>
        }
        class="flex-1"
      >
        {(data, instant) => {
          const wave = createListWave({ isTop, reenter: rootOpens, afterReveal: !instant });
          const group = createListGroup({
            count: () => data().sections.length,
            region: "main",
            when: isTop,
            cover: { inset: playerOverlap, itemSize: 270 },
          });
          return (
            <List
              ref={group.ref}
              onViewableItemsChange={group.onViewableItemsChange}
              viewabilityConfig={KEYS_VIEWABILITY}
              each={data().sections}
              keyExtractor={(s) => `${s.kind}:${s.title}:${s.items[0]?.uri ?? ""}`}
              estimatedItemSize={terminal ? 4 : 270}
              class="flex-1"
              contentClass={terminal ? "" : "px-3"}
              header={() => <Title text={data().title || title()} entrance={instant} />}
              footer={() => <View class={pageEnd()} />}
            >
              {(section, i) => <If when={section()}>{(s) => <Row section={s()} index={i()} wave={wave} group={group} />}</If>}
            </List>
          );
        }}
      </Reveal>
    </AppPage>
  );
}
