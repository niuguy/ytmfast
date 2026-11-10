// A collection's page: a playlist, album, artist or Liked Songs, with its
// header, a play button and its tracks in a virtualized, recycling list.
// Each opened collection is a page of its own in the stack, with its own
// list and scroll position.

import { effect, List, type ListRef, reduceMotion, Text, untracked, View } from "nsh";
import type { Collection } from "../backend/types";
import { AppPage } from "../components/page";
import { layout, pageEnd, playerOverlap, wideTracks } from "../components/layout";
import { CardGrid } from "../components/library/cards";
import { TrackHeader, TrackRow } from "../components/library/tracks";
import {
  Cover,
  keyRing,
  PlayButton,
  SectionTitle,
  terminal,
} from "../components/ui/controls";
import { AFTER_REVEAL, createListWave, enter } from "../components/ui/motion";
import { createListGroup, createListKeys, KEYS_VIEWABILITY, type ListGroup } from "../components/ui/list-keys";
import { currentRoute, rootOpens } from "../nav";
import {
  EmptyState,
  ErrorState,
  CollectionSkeleton,
  Reveal,
} from "../components/ui/feedback";
import { collectionQuery } from "../data/queries";
import { isCurrentTrack, isPlayingContext, playFrom, rememberTracks, toggleCollection } from "../state/player";
import { ready, signedIn } from "../state/session";
import { setSaved, setSubscribed } from "../state/library";
import { ItemMenuButton } from "../components/library/menus";
import { IconButton } from "../components/ui/controls";

const KIND_LABEL: Record<string, string> = {
  album: "Album",
  artist: "Artist",
  collection: "Playlist",
  playlist: "Playlist",
  history: "Recently played",
};

/** Plays a collection: from its start, or for History (a list of plays, not
 * one queue) its newest song. */
function playAll(data: Collection, uri: string): void {
  if (data.header.kind === "history") {
    const first = data.tracks[0];
    if (first) playFrom(uri, first.uri, first);
  } else toggleCollection(uri);
}

/** The header's actions beside its play button: save to the library, or
 * subscribe to the artist, where the page can; and its menu. */
function HeaderActions(props: { data: Collection }) {
  const header = () => props.data.header;
  const savable = () => header().saved != null && signedIn() === true;
  const subscribable = () => header().subscribed != null && signedIn() === true;
  return (
    <View class="flex-row items-center gap-1">
      <If when={savable()}>
        <IconButton
          name={header().saved ? "bookmarkFilled" : "bookmark"}
          label={header().saved ? "Remove from library" : "Save to library"}
          pressed={!!header().saved}
          hint
          onPress={() => void setSaved(header().uri, !header().saved)}
        />
      </If>
      <If when={subscribable()}>
        <IconButton
          name={header().subscribed ? "userCheck" : "userPlus"}
          label={header().subscribed ? "Unsubscribe" : "Subscribe"}
          pressed={!!header().subscribed}
          hint
          onPress={() => void setSubscribed(header().uri, !header().subscribed)}
        />
      </If>
      <If when={header().kind !== "history"}>
        <ItemMenuButton item={header()} saved={header().saved} />
      </If>
    </View>
  );
}

function Header(props: { uri: string; data: Collection; entrance: boolean; group: ListGroup; reveal: () => void }) {
  // Its layers come in one after another: at once when the page shows
  // straight away (cached), else as the skeleton gives way. Made once.
  const start = untracked(() => (props.entrance ? 0 : AFTER_REVEAL));
  const intro = (preset: "zoomIn" | "fadeInUp", delay = 0) =>
    untracked(() => (terminal ? undefined : enter(preset, start + delay)));
  const coverIn = intro("zoomIn");
  // The words, each line on its own beat: the kind, then the name, then the
  // quieter lines under it.
  const kindIn = intro("fadeInUp", 70);
  const nameIn = intro("fadeInUp", 150);
  const restIn = intro("fadeInUp", 250);
  const playIn = intro("zoomIn", 330);
  const header = () => props.data.header;
  const phone = () => layout() !== "desktop";
  const canPlay = () => ready() && props.data.tracks.length > 0;
  // The play button is the first line of the page's region: Down goes on to
  // the tracks, Return plays (or pauses).
  const keys = createListKeys({
    count: () => 1,
    axis: "horizontal",
    group: props.group,
    order: () => 0,
    activate: () => canPlay() && playAll(props.data, props.uri),
    reveal: props.reveal,
  });
  const play = (size: number) => (
    <View
      ref={keys.ref}
      focusable={keys.focusable()}
      onFocus={keys.onFocus}
      onBlur={keys.onBlur}
      class={`rounded-full ${keys.isActive(0) ? keyRing : ""}`}
    >
      <PlayButton
        focusable={false}
        playing={isPlayingContext(props.uri)}
        size={size}
        disabled={!canPlay()}
        onPress={() => playAll(props.data, props.uri)}
      />
    </View>
  );
  return (
    <View
      class={
        terminal
          ? "gap-1"
          : phone()
            ? "items-center gap-3 px-6 pb-4 pt-1"
            : // Desktop: the header's picture (96pt) is centred over the rows'
              // covers: a row puts its cover's centre 78pt in (12 + 12 inset,
              // 24 number, 12 gap, half of 36), so the header starts 30pt in.
              "flex-row items-end gap-4 pl-[30px] pr-6 pb-4 pt-1"
      }
    >
      <View style={coverIn} class={phone() ? "w-full max-w-40" : ""}>
        <Cover
          src={header().image}
          round={header().kind === "artist"}
          liked={header().kind === "collection"}
          fallback={header().kind === "history" ? "history" : undefined}
          class={phone() ? "w-full shadow-xl" : "w-24 shadow-xl"}
        />
      </View>
      {/* The words as one block centred on the picture: kind, name, and a
          quiet third line (secondary: small and muted). */}
      <View class="min-w-0 flex-1 gap-1 self-stretch justify-center" selectable={!terminal}>
        <View style={kindIn}>
          <Text class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {KIND_LABEL[header().kind] ?? "Playlist"}
          </Text>
        </View>
        <View style={nameIn}>
          <Text role="header" class={`line-clamp-1 font-extrabold text-foreground ${phone() ? "text-2xl" : "text-3xl"}`}>
            {header().name}
          </Text>
        </View>
        <View class="gap-1" style={restIn}>
          <If when={header().description}>
            <Text class="line-clamp-1 text-sm text-muted-foreground">{header().description}</Text>
          </If>
          <Text class="text-xs text-muted-foreground">{header().subtitle}</Text>
        </View>
      </View>
      <View class={`shrink-0 flex-row items-center gap-2 ${phone() ? "" : ""}`} style={playIn}>
        <If when={!terminal}>
          <HeaderActions data={props.data} />
        </If>
        {play(phone() ? 48 : 44)}
      </View>
    </View>
  );
}

function Tracks(props: { uri: string; data: Collection; instant: boolean }) {
  // What plays is found among these when the player can't name it.
  effect(() => rememberTracks(props.uri, props.data.tracks));
  const artist = () => props.data.header.kind === "artist";
  const showAlbum = () => wideTracks() && !artist();
  // The rows wave in, top to bottom, when this page opens (not when it is
  // gone back to): at once when cached, as the skeleton fades when they
  // loaded. Rows scrolled to come in on their own.
  const wave = untracked(() =>
    createListWave({
      isTop: () => {
        const route = currentRoute();
        return route.name === "collection" && route.uri === props.uri;
      },
      // Liked Songs is a root on the phone: its tab chosen again enters it
      // anew.
      reenter: rootOpens,
      afterReveal: !props.instant,
    }),
  );
  const play = (index: number) => {
    const track = props.data.tracks[index];
    if (track && ready()) playFrom(props.uri, track.uri, track);
  };
  // The list is one stop of Tab; the arrows move through its rows, Return
  // plays one. The keyboard starts at the playing track when it is here.
  const group = createListGroup({
    region: "main",
    when: () => {
      const route = currentRoute();
      return route.name === "collection" && route.uri === props.uri;
    },
  });
  // The header and the releases are the list's own header and footer: it
  // scrolls to them as they take the focus.
  let list: ListRef | null = null;
  const toTop = () => list?.scrollToOffset({ offset: 0, animated: !reduceMotion() });
  const toEnd = () => list?.scrollToEnd({ animated: !reduceMotion() });
  const keys = createListKeys({
    count: () => props.data.tracks.length,
    group,
    order: () => 1,
    activate: play,
    // Rows are 48pt; the player floats over the bottom of the page.
    cover: { inset: playerOverlap, itemSize: 48 },
    start: () => props.data.tracks.findIndex((t) => isCurrentTrack(t.uri)),
  });
  return (
    <List
      each={props.data.tracks}
      keyExtractor={(t) => t.uid + t.uri}
      estimatedItemSize={48}
      ref={(n: ListRef) => {
        list = n;
        keys.ref(n);
      }}
      focusable={keys.focusable()}
      onFocus={keys.onFocus}
      onBlur={keys.onBlur}
      onViewableItemsChange={keys.onViewableItemsChange}
      viewabilityConfig={KEYS_VIEWABILITY}
      header={() => (
        <View>
          <Header uri={props.uri} data={props.data} entrance={props.instant} group={group} reveal={toTop} />
          <TrackHeader showAlbum={showAlbum()} />
        </View>
      )}
      footer={() => (
        <View class={pageEnd()}>
          <If when={props.data.releases.length > 0}>
            <View class="gap-2 px-3 pt-8">
              <SectionTitle class="px-3">Discography</SectionTitle>
              <CardGrid items={props.data.releases} wave={wave} group={group} order={2} reveal={toEnd} />
            </View>
          </If>
        </View>
      )}
      empty={() => <EmptyState title="Nothing here yet" />}
      class="flex-1"
    >
      {(row, index) => (
        <TrackRow
          track={row()}
          number={index()}
          showAlbum={showAlbum()}
          secondary={artist() ? "album" : "artists"}
          disabled={!ready()}
          wave={wave}
          keys={keys}
          context={{ uri: props.uri, editable: !!props.data.header.editable }}
          onPress={() => play(index())}
        />
      )}
    </List>
  );
}

export function CollectionPage(props: { uri: string }) {
  const query = collectionQuery(() => props.uri);
  const title = () => query.data()?.header.name ?? "";
  const liked = () => query.data()?.header.kind === "collection";
  const body = () => (
    <Reveal
      data={query.data()}
      placeholder={
        <If when={query.error()} else={<CollectionSkeleton phone={layout() !== "desktop"} />}>
          <ErrorState
            message="This page didn't load."
            onRetry={query.refetch}
          />
        </If>
      }
      class="flex-1"
    >
      {(data, instant) => <Tracks uri={props.uri} data={data()} instant={instant} />}
    </Reveal>
  );
  return (
    <AppPage
      title={title()}
      testID={`page-${props.uri}`}
      shown={() => {
        const route = currentRoute();
        return route.name === "collection" && route.uri === props.uri;
      }}
    >
      {body()}
    </AppPage>
  );
}
