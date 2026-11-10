// Search: a field, then songs, artists, albums and playlists. A new search
// keeps the results that show, with a spinner, until its own arrive.

import { effect, resource, Scroll, token, untracked, View } from "nsh";
import { Input } from "nsh/base";
import type { SearchResults } from "../backend/types";
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

import { query } from "../state/search";
import { layout } from "../components/layout";

/** Milliseconds of quiet typing before a search runs. */
const DEBOUNCE = 280;

function isEmpty(found: SearchResults): boolean {
  return found.tracks.length + found.artists.length + found.albums.length + found.playlists.length === 0;
}

export function SearchPage() {
  const term = () => query().trim();
  const results = resource(
    () => (term() ? { term: term(), epoch: dataEpoch() } : null),
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
      <Scroll class="flex-1" contentClass={pageEnd()}>
        <If when={term()} else={<EmptyState title="Search YouTube Music" detail="Find songs, artists, albums and playlists." />}>
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
      </Scroll>
    </AppPage>
  );
}
