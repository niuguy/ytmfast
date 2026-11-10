// Fictional music for `DemoBackend`: every name here is made up. The covers
// are left empty, so the UI draws its own placeholders; `enrich` (the
// `demo: "rich"` host parameter, for performance runs) gives everything a
// cover and makes the library as large as a real one.

import type { Chip, Collection, Home, Item, Library, Lyrics, Page, PlaylistChoice, SearchFilter, SearchPage, Section, Track } from "./types";
import cover00 from "./demo-covers/cover-00.jpg";
import cover01 from "./demo-covers/cover-01.jpg";
import cover02 from "./demo-covers/cover-02.jpg";
import cover03 from "./demo-covers/cover-03.jpg";
import cover04 from "./demo-covers/cover-04.jpg";
import cover05 from "./demo-covers/cover-05.jpg";
import cover06 from "./demo-covers/cover-06.jpg";
import cover07 from "./demo-covers/cover-07.jpg";
import cover08 from "./demo-covers/cover-08.jpg";
import cover09 from "./demo-covers/cover-09.jpg";
import cover10 from "./demo-covers/cover-10.jpg";
import cover11 from "./demo-covers/cover-11.jpg";
import cover12 from "./demo-covers/cover-12.jpg";
import cover13 from "./demo-covers/cover-13.jpg";
import cover14 from "./demo-covers/cover-14.jpg";
import cover15 from "./demo-covers/cover-15.jpg";

const COVERS = [
  cover00, cover01, cover02, cover03, cover04, cover05, cover06, cover07,
  cover08, cover09, cover10, cover11, cover12, cover13, cover14, cover15,
].map((c) => c.url);

/** Whether `enrich` ran. */
let rich = false;

/** The cover of the thing `id` names: none until `enrich`, then one of the
 * covers, the same for the same id. */
function coverOf(id: string): string {
  if (!rich) return "";
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVERS[h % COVERS.length];
}

interface ArtistSeed {
  id: string;
  name: string;
}

interface AlbumSeed {
  id: string;
  name: string;
  artist: ArtistSeed;
  year: number;
  titles: string[];
}

const QUIET_FIELDS: ArtistSeed = { id: "quietfields", name: "The Quiet Fields" };
const MIRA_VALE: ArtistSeed = { id: "miravale", name: "Mira Vale" };
const LOW_HARBOR: ArtistSeed = { id: "lowharbor", name: "Low Harbor" };

export const ARTISTS = [QUIET_FIELDS, MIRA_VALE, LOW_HARBOR];

const ALBUMS: AlbumSeed[] = [
  {
    id: "paperlanterns",
    name: "Paper Lanterns",
    artist: QUIET_FIELDS,
    year: 2021,
    titles: ["First Light", "Paper Lanterns", "Slow River", "Window Seat", "Hollow Pines", "Kites", "Small Hours", "Homeward"],
  },
  {
    id: "neonorchard",
    name: "Neon Orchard",
    artist: MIRA_VALE,
    year: 2023,
    titles: ["Orchard", "Glass Bees", "Overpass", "Static Bloom", "Night Market", "Afterglow"],
  },
  {
    id: "saltlines",
    name: "Salt Lines",
    artist: LOW_HARBOR,
    year: 2019,
    titles: ["Breakwater", "Tidewatch", "Lighthouse Keeper", "Fog Signal", "Ropes", "Harbor Lights", "Ebb"],
  },
];

function trackOf(album: AlbumSeed, index: number): Track {
  const title = album.titles[index];
  // A length between 2:30 and 4:50 that stays the same between runs.
  const seconds = 150 + ((index * 37 + album.id.length * 11) % 140);
  return {
    uri: `ytm:track:${album.id}${index + 1}`,
    uid: `${album.id}-${index + 1}`,
    name: title,
    artists: album.artist.name,
    album: album.name,
    albumUri: `ytm:album:${album.id}`,
    image: coverOf(album.id),
    durationMs: seconds * 1000,
    explicit: index === 3,
    playable: true,
  };
}

let ALL_TRACKS: Track[] = ALBUMS.flatMap((album) => album.titles.map((_, i) => trackOf(album, i)));

function pick(uris: number[]): Track[] {
  return uris.map((i) => ALL_TRACKS[i % ALL_TRACKS.length]);
}

interface PlaylistSeed {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
  /** The account's own: its songs can be taken out, and songs added. */
  own?: boolean;
}

const PLAYLISTS: PlaylistSeed[] = [
  { id: "morningstatic", name: "Morning Static", description: "Soft starts for slow mornings.", tracks: pick([0, 8, 14, 2, 10, 16, 4, 12, 18, 6]) },
  { id: "latetrains", name: "Late Trains", description: "For the last ride home.", tracks: pick([13, 9, 3, 15, 11, 5, 19, 7]) },
  { id: "harborwalk", name: "Harbor Walk", description: "Salt air and long coats.", tracks: pick([14, 15, 16, 17, 18, 19, 20]) },
  { id: "roadtrip", name: "Road Trip", description: "Made by you.", tracks: pick([2, 9, 17]), own: true },
];

/** What the account saved and subscribes to. */
const saved = new Set<string>(["ytm:album:paperlanterns"]);
const subscribed = new Set<string>(["ytm:artist:lowharbor"]);

let LIKED: Track[] = pick([1, 9, 15, 4, 11, 20]);

export const LIKED_URI = "ytm:collection:LM";

function playlistItem(p: PlaylistSeed): Item {
  return { uri: `ytm:playlist:${p.id}`, kind: "playlist", name: p.name, subtitle: p.own ? "Playlist · You" : "Playlist · Demo", image: coverOf(p.id) };
}

function albumItem(a: AlbumSeed): Item {
  return { uri: `ytm:album:${a.id}`, kind: "album", name: a.name, subtitle: `${a.year} · ${a.artist.name}`, image: coverOf(a.id) };
}

function artistItem(a: ArtistSeed): Item {
  return { uri: `ytm:artist:${a.id}`, kind: "artist", name: a.name, subtitle: "Artist", image: coverOf(a.id) };
}

/** Every item the demo knows, for search. */
let ITEMS: Item[] = [...PLAYLISTS.map(playlistItem), ...ALBUMS.map(albumItem), ...ARTISTS.map(artistItem)];

const WORDS = [
  "Amber", "Velvet", "Hollow", "Silver", "Northern", "Paper", "Glass", "Quiet", "Electric", "Distant",
  "Midnight", "Copper", "Winter", "Golden", "Faded", "Open", "Burning", "Cold", "Little", "Wild",
];
const NOUNS = [
  "Rooms", "Rivers", "Signals", "Gardens", "Engines", "Harbors", "Echoes", "Satellites", "Mornings", "Streets",
  "Letters", "Islands", "Machines", "Fires", "Windows", "Horses", "Lights", "Waves", "Towers", "Fields",
];
const name = (i: number) => `${WORDS[i % WORDS.length]} ${NOUNS[(i * 7 + 3) % NOUNS.length]}`;

/** Makes the demo as large as a real library, with covers everywhere: 12
 * artists, 27 albums of 12 songs, 12 playlists of 60, 120 liked songs and
 * a home page of 8 rows of 12. Names the plain demo has stay as they are,
 * so its selectors still find them. For performance runs (`demo: "rich"`).
 * Runs once, before the backend reads anything. */
export function enrich() {
  if (rich) return;
  rich = true;
  for (let i = 0; i < 9; i++) ARTISTS.push({ id: `artist${i}`, name: `The ${name(i * 3 + 1)}` });
  for (let i = 0; i < 24; i++) {
    const artist = ARTISTS[i % ARTISTS.length];
    ALBUMS.push({
      id: `album${i}`,
      name: name(i * 5 + 2),
      artist,
      year: 1990 + ((i * 7) % 35),
      titles: Array.from({ length: 12 }, (_, t) => name(i * 12 + t + 40)),
    });
  }
  ALL_TRACKS = ALBUMS.flatMap((album) => album.titles.map((_, i) => trackOf(album, i)));
  const many = (seed: number, n: number) => Array.from({ length: n }, (_, i) => (seed * 13 + i * 17) % ALL_TRACKS.length);
  const at = (t: Track) => ALL_TRACKS.findIndex((x) => x.uri === t.uri);
  for (const p of PLAYLISTS) p.tracks = pick([...p.tracks.map(at), ...many(p.id.length, 50)]);
  for (let i = 0; i < 9; i++) {
    PLAYLISTS.push({ id: `playlist${i}`, name: name(i * 11 + 7), description: "A long playlist, for scrolling.", tracks: pick(many(i + 5, 60)) });
  }
  LIKED = pick(many(99, 120));
  ITEMS = [...PLAYLISTS.map(playlistItem), ...ALBUMS.map(albumItem), ...ARTISTS.map(artistItem)];
}

/** Home's chips: the demo's moods. */
const CHIPS = [
  { title: "Relax", params: "relax" },
  { title: "Workout", params: "workout" },
  { title: "Focus", params: "focus" },
];

/** The home page of the account named `name`, filtered by the chip whose
 * `params` are given (its rows then lead with that mood). */
export function homeFor(name: string, params = ""): Home {
  const chip = CHIPS.find((c) => c.params === params);
  const chips: Chip[] = CHIPS.map((c) => ({ ...c, selected: c.params === params }));
  if (chip) {
    return {
      greeting: `Good evening, ${name}`,
      chips,
      sections: [
        { title: `${chip.title} mixes`, items: PLAYLISTS.filter((p) => !p.own).map(playlistItem) },
        { title: `${chip.title} albums`, items: ALBUMS.map(albumItem) },
      ],
    };
  }
  return {
    greeting: `Good evening, ${name}`,
    chips,
    sections: rich
      ? [
          { title: "Made for you", items: PLAYLISTS.map(playlistItem) },
          { title: "Albums you'll like", items: ALBUMS.slice(0, 12).map(albumItem) },
          { title: "Artists", items: ARTISTS.map(artistItem) },
          { title: "Recently played", items: [...ALBUMS.slice(12, 18).map(albumItem), ...PLAYLISTS.slice(3, 9).map(playlistItem)] },
          { title: "Jump back in", items: ALBUMS.slice(15, 27).map(albumItem) },
          { title: "Your top mixes", items: PLAYLISTS.slice(0, 12).map(playlistItem) },
          { title: "New releases", items: ALBUMS.slice(3, 15).map(albumItem) },
          { title: "More like Mira Vale", items: [...ARTISTS.slice(3).map(artistItem), ...ALBUMS.slice(20, 23).map(albumItem)] },
        ]
      : [
          { title: "Made for you", items: PLAYLISTS.map(playlistItem) },
          { title: "Albums you'll like", items: ALBUMS.map(albumItem) },
          { title: "Artists", items: ARTISTS.map(artistItem) },
        ],
  };
}

export function library(): Library {
  return {
    items: [
      { uri: LIKED_URI, kind: "collection", name: "Liked Songs", subtitle: `Playlist · ${LIKED.length} songs`, image: "" },
      ...PLAYLISTS.map(playlistItem),
      ...ALBUMS.slice(0, rich ? 20 : 2).map(albumItem),
      ...ALBUMS.slice(rich ? 20 : 2).filter((a) => saved.has(`ytm:album:${a.id}`)).map(albumItem),
      ...ARTISTS.filter((a) => subscribed.has(`ytm:artist:${a.id}`)).map(artistItem),
      ...(rich ? ARTISTS.slice(3).map(artistItem) : []),
    ],
  };
}

/** A collection by URI, or null when the demo has none. */
export function collection(uri: string): Collection | null {
  const [, kind, id] = uri.split(":");
  if (uri === LIKED_URI) {
    return {
      header: { uri, kind: "collection", name: "Liked Songs", subtitle: `${LIKED.length} songs`, image: "", description: "", saved: null, editable: false, subscribed: null },
      tracks: LIKED,
      releases: [],
      total: LIKED.length,
    };
  }
  if (kind === "playlist") {
    const p = PLAYLISTS.find((x) => x.id === id);
    if (!p) return null;
    return {
      header: {
        uri,
        kind,
        name: p.name,
        subtitle: `${p.own ? "You" : "Demo"} · ${p.tracks.length} songs`,
        image: coverOf(p.id),
        description: p.description,
        saved: p.own ? null : saved.has(uri),
        editable: !!p.own,
        subscribed: null,
      },
      tracks: p.tracks,
      releases: [],
      total: p.tracks.length,
    };
  }
  if (kind === "album") {
    const a = ALBUMS.find((x) => x.id === id);
    if (!a) return null;
    const tracks = a.titles.map((_, i) => trackOf(a, i));
    return {
      header: {
        uri,
        kind,
        name: a.name,
        subtitle: `${a.artist.name} · ${a.year} · ${tracks.length} songs`,
        image: coverOf(a.id),
        description: "",
        saved: saved.has(uri),
        editable: false,
        subscribed: null,
      },
      tracks,
      releases: [],
      total: tracks.length,
    };
  }
  if (kind === "artist") {
    const artist = ARTISTS.find((x) => x.id === id);
    if (!artist) return null;
    const albums = ALBUMS.filter((a) => a.artist.id === artist.id);
    const tracks = ALL_TRACKS.filter((t) => t.artists === artist.name).slice(0, rich ? 10 : 5);
    return {
      header: { uri, kind, name: artist.name, subtitle: "Demo artist", image: coverOf(artist.id), description: "", saved: null, editable: false, subscribed: subscribed.has(uri) },
      tracks,
      releases: albums.map(albumItem),
      total: tracks.length,
    };
  }
  return null;
}

/** The demo's moods and genres: pages to open, each with its colour. */
const MOODS: Item[] = [
  { uri: "ytm:page:FEmusic_moods_and_genres_category:chill", kind: "page", name: "Chill", subtitle: "", image: "", color: "#a4c5ff" },
  { uri: "ytm:page:FEmusic_moods_and_genres_category:focus", kind: "page", name: "Focus", subtitle: "", image: "", color: "#ffc857" },
  { uri: "ytm:page:FEmusic_moods_and_genres_category:sleep", kind: "page", name: "Sleep", subtitle: "", image: "", color: "#7a5cff" },
];

/** A browse page by URI, or null: Explore, its own pages (new releases,
 * charts, moods and genres) and each mood. */
export function page(uri: string): Page | null {
  const albums: Section = { title: "New albums & singles", kind: "cards", items: ALBUMS.map(albumItem) };
  const moods: Section = { title: "Moods & genres", kind: "buttons", items: MOODS };
  switch (uri) {
    case "ytm:page:FEmusic_explore":
      return {
        title: "Explore",
        sections: [
          {
            title: "",
            kind: "buttons",
            items: [
              { uri: "ytm:page:FEmusic_new_releases", kind: "page", name: "New releases", subtitle: "", image: "" },
              { uri: "ytm:page:FEmusic_charts", kind: "page", name: "Charts", subtitle: "", image: "" },
              { uri: "ytm:page:FEmusic_moods_and_genres", kind: "page", name: "Moods & genres", subtitle: "", image: "" },
            ],
          },
          albums,
          moods,
        ],
      };
    case "ytm:page:FEmusic_new_releases":
      return { title: "New releases", sections: [albums] };
    case "ytm:page:FEmusic_charts":
      return { title: "Charts", sections: [{ title: "Top artists", kind: "cards", items: ARTISTS.map(artistItem) }] };
    case "ytm:page:FEmusic_moods_and_genres":
      return { title: "Moods & genres", sections: [moods] };
  }
  const mood = MOODS.find((m) => m.uri === uri);
  if (!mood) return null;
  return { title: mood.name, sections: [{ title: `${mood.name} mixes`, kind: "cards", items: PLAYLISTS.filter((p) => !p.own).map(playlistItem) }] };
}

/** How many results a page of a narrowed search holds (small, so a second
 * page shows in the demo). */
const PAGE = 4;

/** One page of a search narrowed to `filter`; `continuation` is where the
 * page starts ("" for the first). */
export function searchFiltered(query: string, filter: SearchFilter, continuation: string | null): SearchPage {
  const found = search(query);
  const all: (Track | Item)[] =
    filter === "songs" ? found.tracks : filter === "videos" ? [] : filter === "albums" ? found.albums : filter === "artists" ? found.artists : found.playlists;
  const from = Number(continuation || 0);
  const slice = all.slice(from, from + PAGE);
  const more = from + PAGE < all.length ? String(from + PAGE) : "";
  return filter === "songs" || filter === "videos"
    ? { tracks: slice as Track[], items: [], continuation: more }
    : { tracks: [], items: slice as Item[], continuation: more };
}

/** Queries to suggest for `query`: the names that start with it. */
export function suggestions(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const names = [...ARTISTS.map((a) => a.name), ...ALBUMS.map((a) => a.name), ...ALL_TRACKS.map((t) => t.name)];
  return [...new Set(names.map((n) => n.toLowerCase()).filter((n) => n.startsWith(q) || n.includes(" " + q)))].slice(0, 6);
}

/** What was played: a few songs, newest first. */
export function history(): Collection {
  const tracks = pick([5, 12, 1, 18, 7]).map((t, i) => ({ ...t, uid: `${t.uid}-h${i}` }));
  return {
    header: { uri: "ytm:history:all", kind: "history", name: "History", subtitle: "", image: "", description: "", saved: null, editable: false, subscribed: null },
    tracks,
    releases: [],
    total: tracks.length,
  };
}

/** The account's playlists a song can be added to. */
export function playlistChoices(): PlaylistChoice[] {
  return PLAYLISTS.filter((p) => p.own).map((p) => ({ uri: `ytm:playlist:${p.id}`, name: p.name, subtitle: `${p.tracks.length} tracks` }));
}

/** A track by URI, wherever the demo has it. */
export function trackByUri(uri: string): Track | undefined {
  return ALL_TRACKS.find((t) => t.uri === uri);
}

/** Every track of an album, playlist or Liked Songs, or the one track. */
export function tracksOf(uri: string): Track[] {
  const track = trackByUri(uri);
  if (track) return [track];
  return collection(uri)?.tracks ?? [];
}

/** Saves an album or playlist, or takes it out. */
export function setSaved(uri: string, on: boolean): void {
  if (on) saved.add(uri);
  else saved.delete(uri);
}

/** Subscribes to an artist, or unsubscribes. */
export function setSubscribed(uri: string, on: boolean): void {
  if (on) subscribed.add(uri);
  else subscribed.delete(uri);
}

/** Likes a song (it joins Liked Songs, first), or takes it out. */
export function setLikedSong(uri: string, on: boolean): void {
  LIKED = LIKED.filter((t) => t.uri !== uri);
  const track = trackByUri(uri);
  if (on && track) LIKED = [track, ...LIKED];
}

let made = 0;

/** Makes a playlist of the account's own; answers its URI. */
export function createPlaylist(name: string, trackUri: string | null): string {
  made += 1;
  const id = `made${made}`;
  const track = trackUri ? trackByUri(trackUri) : undefined;
  PLAYLISTS.push({ id, name, description: "Made by you.", tracks: track ? [track] : [], own: true });
  ITEMS = [...PLAYLISTS.map(playlistItem), ...ALBUMS.map(albumItem), ...ARTISTS.map(artistItem)];
  return `ytm:playlist:${id}`;
}

/** Adds a song to one of the account's playlists (not twice). */
export function addToPlaylist(playlistUri: string, trackUri: string): boolean {
  const p = PLAYLISTS.find((x) => `ytm:playlist:${x.id}` === playlistUri && x.own);
  const track = trackByUri(trackUri);
  if (!p || !track) return false;
  if (!p.tracks.some((t) => t.uri === trackUri)) p.tracks = [...p.tracks, { ...track, uid: `${track.uid}-${p.id}${p.tracks.length}` }];
  return true;
}

/** Takes the row `uid` out of one of the account's playlists. */
export function removeFromPlaylist(playlistUri: string, uid: string): boolean {
  const p = PLAYLISTS.find((x) => `ytm:playlist:${x.id}` === playlistUri && x.own);
  if (!p) return false;
  const before = p.tracks.length;
  p.tracks = p.tracks.filter((t) => t.uid !== uid);
  return p.tracks.length < before;
}

/** What a search for `query` finds: names containing it, case-insensitively. */
export function search(query: string) {
  const q = query.trim().toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(q);
  return {
    tracks: ALL_TRACKS.filter((t) => has(t.name) || has(t.artists)).slice(0, 8),
    artists: ITEMS.filter((i) => i.kind === "artist" && has(i.name)),
    albums: ITEMS.filter((i) => i.kind === "album" && (has(i.name) || has(i.subtitle))),
    playlists: ITEMS.filter((i) => i.kind === "playlist" && has(i.name)),
  };
}

const VERSES = [
  "♪",
  "Streetlights hum a quiet tune",
  "Paper boats along the river",
  "We were waiting for the noon",
  "♪",
  "Every window holds a summer",
  "Every summer holds a name",
  "Carry me across the harbor",
  "I will never be the same",
  "♪",
  "Streetlights hum a quiet tune",
  "And the night lets us go home",
];

/** A track's lyrics: made-up lines every four seconds; Low Harbor's songs
 * have none (an instrumental band), so that state shows too. */
export function lyrics(trackUri: string): Lyrics {
  const track = ALL_TRACKS.find((t) => t.uri === trackUri);
  if (!track || track.artists === LOW_HARBOR.name) return { synced: false, lines: [], provider: "" };
  return { synced: true, provider: "Demo", lines: VERSES.map((words, i) => ({ startMs: i * 4000, words })) };
}

/** The demo's ad: a made-up sponsor. */
export const AD = { title: "Fieldnote Coffee", artwork: "", durationMs: 15000 };
