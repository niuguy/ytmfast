// Search: a field, then songs, artists, albums and playlists. A new search
// keeps the results that show, with a spinner, until its own arrive.

import { effect, resource, Scroll, signal, Text, token, untracked, View } from "nsh";
import { Input } from "nsh/base";
import type { Item, SearchFilter, SearchResults, Track } from "../backend/types";
import { CardGrid } from "../components/library/cards";
import { ActionButton, focusRing, LAYER, Pressable } from "../components/ui/controls";
import { AppPage } from "../components/page";
import { pageEnd, wideTracks } from "../components/layout";
import { CardRow } from "../components/library/cards";
import { TrackHeader, TrackRow } from "../components/library/tracks";
import { SectionTitle, terminal } from "../components/ui/controls";
import { EmptyState, ErrorState, Reveal, SearchSkeleton, Spinner } from "../components/ui/feedback";
import { createListWave } from "../components/ui/motion";
import { createListGroup, createListKeys } from "../components/ui/list-keys";
import { currentRoute, rootOpens } from "../nav";
import { Icon } from "../components/ui/icons";
import { backend } from "../state/engine";
import { playTrack } from "../state/player";
import { dataEpoch, ready } from "../state/session";

import { filter, query } from "../state/search";
import { layout } from "../components/layout";

/** Milliseconds of quiet typing before a search runs. */
const DEBOUNCE = 280;

function isEmpty(found: SearchResults): boolean {
  return found.tracks.length + found.artists.length + found.albums.length + found.playlists.length === 0;
}

/** The tabs of Search: everything, or one kind. */
const TABS: { id: "all" | SearchFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "playlists", label: "Playlists" },
  { id: "videos", label: "Videos" },
];

function Tabs() {
  return (
    <View role="tablist" class={terminal ? "flex-row gap-1" : "flex-row flex-wrap gap-2 px-6 pb-3"}>
      <Each of={TABS} key={(t) => t.id}>
        {(tab) => {
          const on = () => filter() === tab().id;
          return (
            <Pressable
              accessibilityLabel={tab().label}
              selected={on()}
              onPress={() => filter.set(tab().id)}
              class={
                terminal
                  ? "px-1 focus:bg-muted selected:bg-muted"
                  : `h-8 items-center justify-center rounded-(--radius) px-3 ${LAYER} active:scale-95 ${focusRing} ${on() ? "bg-foreground" : "bg-secondary hover:bg-muted"}`
              }
            >
              <Text class={`text-sm font-medium ${on() ? "text-background" : "text-foreground"}`}>{tab().label}</Text>
            </Pressable>
          );
        }}
      </Each>
    </View>
  );
}

/** What YouTube Music suggests for the query, as chips that search for it. */
function Suggestions(props: { term: string }) {
  const suggested = resource(
    () => props.term || null,
    async (term, { signal: abort }) => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE));
      if (abort.aborted) throw new Error("superseded");
      return backend.searchSuggestions(term);
    },
  );
  // The query itself is no suggestion.
  const shown = () => (suggested() ?? []).filter((s) => s.toLowerCase() !== props.term.toLowerCase()).slice(0, 6);
  return (
    <If when={shown().length > 0 && !terminal}>
      <View class="flex-row flex-wrap items-center gap-2 px-6 pb-3">
        <Each of={shown()} key={(s) => s}>
          {(s) => (
            <Pressable
              accessibilityLabel={`Search for ${s()}`}
              onPress={() => query.set(s())}
              class={`h-7 flex-row items-center gap-1.5 rounded-full border border-border px-3 ${LAYER} hover:bg-row-hover active:scale-95 ${focusRing}`}
            >
              <Icon name="search" size={12} color="muted-foreground" />
              <Text class="text-xs text-muted-foreground">{s()}</Text>
            </Pressable>
          )}
        </Each>
      </View>
    </If>
  );
}

/** Search narrowed to one kind: a page of results, and more pages as asked
 * for. */
function Narrowed(props: { term: string; kind: SearchFilter }) {
  const tracks = signal<Track[]>([]);
  const items = signal<Item[]>([]);
  const more = signal("");
  const state = signal<"loading" | "ready" | "failed">("loading");
  let asked = 0;
  const load = async (continuation: string | null) => {
    const mine = ++asked;
    state.set("loading");
    try {
      const page = await backend.searchFiltered(props.term, props.kind, continuation);
      if (mine !== asked) return;
      tracks.set(continuation ? [...tracks(), ...page.tracks] : page.tracks);
      items.set(continuation ? [...items(), ...page.items] : page.items);
      more.set(page.continuation);
      state.set("ready");
    } catch (error) {
      if (mine !== asked) return;
      console.warn("ytmfast: search:", String(error));
      state.set("failed");
    }
  };
  // A new query or kind starts again, after the typing pauses.
  effect(() => {
    const term = props.term;
    props.kind;
    dataEpoch();
    untracked(() => {
      tracks.set([]);
      items.set([]);
      more.set("");
      const mine = ++asked;
      state.set("loading");
      setTimeout(() => {
        if (mine === asked && term) void load(null);
      }, DEBOUNCE);
    });
  });
  const songs = () => props.kind === "songs" || props.kind === "videos";
  const empty = () => state() === "ready" && tracks().length + items().length === 0;
  return (
    <View class={terminal ? "gap-1" : "gap-4"}>
      <If when={empty()}>
        <EmptyState title="No results" detail="Check the spelling, or try fewer words." />
      </If>
      <If when={state() === "failed" && tracks().length + items().length === 0}>
        <ErrorState message="Search didn't work." onRetry={() => void load(null)} />
      </If>
      <If when={songs()} else={<View class="px-3"><CardGrid items={items()} /></View>}>
        <View>
          <Each of={tracks()} key={(t) => t.uri}>
            {(track, i) => <TrackRow track={track()} number={i()} showAlbum={wideTracks()} disabled={!ready()} onPress={() => playTrack(track())} />}
          </Each>
        </View>
      </If>
      <If when={state() === "loading"}>
        <If when={tracks().length + items().length === 0} else={<View class="items-center py-2"><Spinner label="Loading more" /></View>}>
          <SearchSkeleton />
        </If>
      </If>
      <If when={!!more() && state() === "ready"}>
        <View class="items-center pt-2">
          <ActionButton label="Show more" onPress={() => void load(more())} />
        </View>
      </If>
    </View>
  );
}

export function SearchPage() {
  const term = () => query().trim();
  const results = resource(
    // Only "All" asks for everything; a narrowed tab asks for its kind.
    () => (term() && filter() === "all" ? { term: term(), epoch: dataEpoch() } : null),
    async (s, { signal: abort }) => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE));
      if (abort.aborted) throw new Error("superseded");
      return { term: s.term, found: await backend.search(s.term) };
    },
  );
  const busy = () => results.state() === "pending" || results.state() === "refreshing";
  const shown = () => (term() ? results()?.found : undefined);

  return (
    <AppPage title="Search" testID="page-search" shown={() => currentRoute().name === "search"}>
      {/* On the desktop the field is in the header's top-right corner
          (`SearchField`); the phone and the terminal keep it here. */}
      <If when={layout() !== "desktop" || terminal}>
      <View class={terminal ? "flex-row items-center gap-1" : "flex-row items-center gap-3 px-6 pb-4"}>
        <View
          class={
            terminal
              ? "flex-1 flex-row items-center border border-border"
              : "h-12 max-w-120 flex-1 flex-row items-center gap-3 rounded-full border border-secondary bg-secondary px-4 focus-within:border-foreground"
          }
        >
          <If when={!terminal}>
            <Icon name="search" size={20} color="muted-foreground" />
          </If>
          <Input
            value={query()}
            onChange={({ value }) => query.set(value)}
            placeholder="What do you want to play?"
            accessibilityLabel="Search YouTube Music"
            returnKeyType="search"
            autoFocus={!terminal}
            class="flex-1 text-base text-foreground"
            style={{ placeholderColor: token("muted-foreground"), caretColor: token("primary") }}
          />
        </View>
        <If when={busy() && !!term()}>
          <Spinner label="Searching" />
        </If>
      </View>
      </If>
      <If when={term()}>
        <Tabs />
        <Suggestions term={term()} />
      </If>
      <Scroll class="flex-1" contentClass={pageEnd()}>
        <If when={term()} else={<EmptyState title="Search YouTube Music" detail="Find songs, artists, albums and playlists." />}>
        <If when={filter() === "all"} else={<Narrowed term={term()} kind={filter() as SearchFilter} />}>
          {/* Results come in with the skeleton's reveal when nothing showed
              before them, their songs in a wave; a new search then keeps
              them, with the spinner, and its own just take their place. */}
          <Reveal
            data={shown()}
            placeholder={
              <If when={results.state() === "errored"} else={<SearchSkeleton />}>
                <ErrorState message="Search didn't work." onRetry={results.refetch} />
              </If>
            }
          >
            {(found, instant) => {
              // Songs and cards wave in each time Search is entered, and each
              // new search's own results wave in as they take the old ones'
              // place; items scrolled to come in on their own.
              const wave = createListWave({ isTop: () => currentRoute().name === "search", reenter: rootOpens, afterReveal: !instant });
              effect(() => {
                found();
                untracked(() => wave.restart());
              });
              // The results are one region: one stop of Tab, the arrows
              // going down the songs and on into the rows of cards.
              const group = createListGroup({ region: "main", when: () => currentRoute().name === "search" });
              const songs = createListKeys({
                count: () => found().tracks.length,
                group,
                order: () => 0,
                activate: (i) => {
                  const track = found().tracks[i];
                  if (track && ready()) playTrack(track);
                },
              });
              return (
              <If when={!isEmpty(found())} else={<EmptyState title="No results" detail="Check the spelling, or try fewer words." />}>
                <View class={terminal ? "gap-1" : "gap-8"}>
                  <If when={found().tracks.length > 0}>
                    <View class="gap-2">
                      <SectionTitle class="px-6">Songs</SectionTitle>
                      <TrackHeader showAlbum={wideTracks()} />
                      <View ref={songs.ref} focusable={songs.focusable()} onFocus={songs.onFocus} onBlur={songs.onBlur}>
                      <Each of={found().tracks} key={(t) => t.uid || t.uri}>
                        {(track, i) => (
                          <TrackRow
                            track={track()}
                            number={i()}
                            showAlbum={wideTracks()}
                            disabled={!ready()}
                            wave={wave}
                            keys={songs}
                            onPress={() => playTrack(track())}
                          />
                        )}
                      </Each>
                      </View>
                    </View>
                  </If>
                  <If when={found().artists.length > 0}>
                    <CardRow title="Artists" items={found().artists} wave={wave} class="px-3" group={group} order={1} />
                  </If>
                  <If when={found().albums.length > 0}>
                    <CardRow title="Albums" items={found().albums} wave={wave} delay={120} class="px-3" group={group} order={2} />
                  </If>
                  <If when={found().playlists.length > 0}>
                    <CardRow title="Playlists" items={found().playlists} wave={wave} delay={240} class="px-3" group={group} order={3} />
                  </If>
                </View>
              </If>
              );
            }}
          </Reveal>
        </If>
        </If>
      </Scroll>
    </AppPage>
  );
}
