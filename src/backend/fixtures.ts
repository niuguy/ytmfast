// Fictional music for `DemoBackend`: every name here is made up. The covers
// are left empty, so the UI draws its own placeholders; `enrich` (the
// `demo: "rich"` host parameter, for performance runs) gives everything a
// cover and makes the library as large as a real one.

import type { Collection, Home, Item, Library, Lyrics, Track } from "./types";
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
    uri: `spotify:track:${album.id}${index + 1}`,
    uid: `${album.id}-${index + 1}`,
    name: title,
    artists: album.artist.name,
    album: album.name,
    albumUri: `spotify:album:${album.id}`,
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
}

const PLAYLISTS: PlaylistSeed[] = [
  { id: "morningstatic", name: "Morning Static", description: "Soft starts for slow mornings.", tracks: pick([0, 8, 14, 2, 10, 16, 4, 12, 18, 6]) },
  { id: "latetrains", name: "Late Trains", description: "For the last ride home.", tracks: pick([13, 9, 3, 15, 11, 5, 19, 7]) },
  { id: "harborwalk", name: "Harbor Walk", description: "Salt air and long coats.", tracks: pick([14, 15, 16, 17, 18, 19, 20]) },
];

let LIKED: Track[] = pick([1, 9, 15, 4, 11, 20]);

export const LIKED_URI = "spotify:collection:tracks";

function playlistItem(p: PlaylistSeed): Item {
  return { uri: `spotify:playlist:${p.id}`, kind: "playlist", name: p.name, subtitle: "Playlist · Demo", image: coverOf(p.id) };
}

function albumItem(a: AlbumSeed): Item {
  return { uri: `spotify:album:${a.id}`, kind: "album", name: a.name, subtitle: `${a.year} · ${a.artist.name}`, image: coverOf(a.id) };
}

function artistItem(a: ArtistSeed): Item {
  return { uri: `spotify:artist:${a.id}`, kind: "artist", name: a.name, subtitle: "Artist", image: coverOf(a.id) };
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

/** The home page of the account named `name`. */
export function homeFor(name: string): Home {
  return {
    greeting: `Good evening, ${name}`,
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
      artistItem(LOW_HARBOR),
      ...(rich ? ARTISTS.slice(3).map(artistItem) : []),
    ],
  };
}

/** A collection by URI, or null when the demo has none. */
export function collection(uri: string): Collection | null {
  const [, kind, id] = uri.split(":");
  if (uri === LIKED_URI) {
    return {
      header: { uri, kind: "collection", name: "Liked Songs", subtitle: `${LIKED.length} songs`, image: "", description: "" },
      tracks: LIKED,
      releases: [],
      total: LIKED.length,
    };
  }
  if (kind === "playlist") {
    const p = PLAYLISTS.find((x) => x.id === id);
    if (!p) return null;
    return {
      header: { uri, kind, name: p.name, subtitle: `Demo · ${p.tracks.length} songs`, image: coverOf(p.id), description: p.description },
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
      header: { uri, kind, name: a.name, subtitle: `${a.artist.name} · ${a.year} · ${tracks.length} songs`, image: coverOf(a.id), description: "" },
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
      header: { uri, kind, name: artist.name, subtitle: "Demo artist", image: coverOf(artist.id), description: "" },
      tracks,
      releases: albums.map(albumItem),
      total: tracks.length,
    };
  }
  return null;
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
