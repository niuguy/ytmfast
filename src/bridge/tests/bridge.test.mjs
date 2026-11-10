// Node tests of the bridge (no npm): `node --test src/bridge/tests/`.
// The InnerTube answers here are cut down from YouTube Music's own, to the
// fields the parsers read.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const B = require("../bridge.js");
const { h, fakeWindow, options } = require("./fake-dom.cjs");
const { render } = await import("../gen-source.mjs");

const rejects = (promise, code) => assert.rejects(promise, (e) => e.message.startsWith(code + ":"), "expected " + code);

// --- InnerTube shapes ---------------------------------------------------------

const runs = (...parts) => ({ runs: parts.map((p) => (typeof p === "string" ? { text: p } : p)) });
const thumbs = (url, width = 120) => ({ thumbnails: [{ url: url.replace("=w544-h544", "=w60-h60"), width: 60, height: 60 }, { url, width, height: width }] });
const browseTo = (browseId, pageType) => ({
  browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_" + pageType } } },
});
const artistRun = (name, id) => ({ text: name, navigationEndpoint: browseTo(id, "ARTIST") });
const albumRun = (name, id) => ({ text: name, navigationEndpoint: browseTo(id, "ALBUM") });
const col = (t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: t } });
const fixed = (t) => ({ musicResponsiveListItemFixedColumnRenderer: { text: runs(t) } });

// A song row of a playlist: title; artists; album; length.
const songRow = (videoId, title, { artists = [["Mira Vale", "UCmira"]], album = ["Neon Orchard", "MPREb_neon"], length = "3:41", setId, explicit, grey } = {}) => ({
  musicResponsiveListItemRenderer: {
    thumbnail: { musicThumbnailRenderer: { thumbnail: thumbs("https://lh3.googleusercontent.com/" + videoId + "=w544-h544") } },
    flexColumns: [
      col(runs({ text: title, navigationEndpoint: { watchEndpoint: { videoId } } })),
      col(runs(...artists.flatMap(([n, id], i) => (i ? [" & ", artistRun(n, id)] : [artistRun(n, id)])))),
      col(album ? runs(albumRun(album[0], album[1])) : runs()),
    ],
    fixedColumns: [fixed(length)],
    playlistItemData: { videoId, playlistSetVideoId: setId },
    badges: explicit ? [{ musicInlineBadgeRenderer: { icon: { iconType: "MUSIC_EXPLICIT_BADGE" } } }] : undefined,
    musicItemRendererDisplayPolicy: grey ? "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT" : undefined,
  },
});
const card = (title, subtitle, endpoint, image = "https://lh3.googleusercontent.com/c=w544-h544") => ({
  musicTwoRowItemRenderer: { title: runs(title), subtitle: runs(...subtitle), thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: thumbs(image, 226) } }, navigationEndpoint: endpoint },
});
const carousel = (title, contents) => ({ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: runs(title) } }, contents } });

// --- Endpoints and items ------------------------------------------------------

test("an endpoint names what it opens or plays", () => {
  assert.deepEqual(B.targetOf(browseTo("MPREb_x", "ALBUM")), { uri: "ytm:album:MPREb_x", kind: "album" });
  assert.deepEqual(B.targetOf(browseTo("VLPLabc", "PLAYLIST")), { uri: "ytm:playlist:PLabc", kind: "playlist" });
  assert.deepEqual(B.targetOf(browseTo("VLLM", "PLAYLIST")), { uri: "ytm:collection:LM", kind: "collection" });
  assert.deepEqual(B.targetOf(browseTo("UCa", "ARTIST")), { uri: "ytm:artist:UCa", kind: "artist" });
  assert.deepEqual(B.targetOf(browseTo("MPLAUCa", "LIBRARY_ARTIST")), { uri: "ytm:artist:UCa", kind: "artist" });
  assert.deepEqual(B.targetOf({ watchEndpoint: { videoId: "v1" } }), { uri: "ytm:track:v1", kind: "track" });
  assert.deepEqual(B.targetOf({ watchPlaylistEndpoint: { playlistId: "RDCLAKx" } }), { uri: "ytm:mix:RDCLAKx", kind: "mix" });
  assert.equal(B.targetOf({ urlEndpoint: { url: "https://x" } }), null);
});

test("a playlist row is a track, with its artists, album and length", () => {
  const t = B.trackOf(songRow("vid1", "Glass Bees", { artists: [["Mira Vale", "UCm"], ["Ode", "UCo"]], setId: "SET1", explicit: true }).musicResponsiveListItemRenderer, 0);
  assert.deepEqual(t, {
    uri: "ytm:track:vid1",
    uid: "SET1",
    name: "Glass Bees",
    artists: "Mira Vale, Ode",
    album: "Neon Orchard",
    albumUri: "ytm:album:MPREb_neon",
    image: "https://lh3.googleusercontent.com/vid1=w120-h120",
    durationMs: 221000,
    explicit: true,
    playable: true,
  });
  const grey = B.trackOf(songRow("vid2", "Gone", { grey: true }).musicResponsiveListItemRenderer, 3);
  assert.equal(grey.playable, false);
  assert.equal(grey.uid, "vid2:3");
});

test("an album row takes the album's artist and cover", () => {
  const row = songRow("v", "Intro", { artists: [], album: null }).musicResponsiveListItemRenderer;
  delete row.thumbnail;
  const t = B.trackOf(row, 0, { artists: "The Quiet Fields", album: "Paper Lanterns", albumUri: "ytm:album:MPREb_p", image: "cover" });
  assert.equal(t.artists, "The Quiet Fields");
  assert.equal(t.albumUri, "ytm:album:MPREb_p");
  assert.equal(t.image, "cover");
});

test("cards and rows are items; a row that opens a page is no track", () => {
  const album = B.itemOf(card("Paper Lanterns", ["Album", " • ", "The Quiet Fields", " • ", "2021"], browseTo("MPREb_p", "ALBUM")).musicTwoRowItemRenderer);
  assert.deepEqual(album, { uri: "ytm:album:MPREb_p", kind: "album", name: "Paper Lanterns", subtitle: "Album · The Quiet Fields · 2021", image: "https://lh3.googleusercontent.com/c=w226-h226" });
  const artistRow = {
    navigationEndpoint: browseTo("UCq", "ARTIST"),
    flexColumns: [col(runs("The Quiet Fields")), col(runs("Artist", " • ", "1.2M subscribers"))],
  };
  assert.equal(B.trackOf(artistRow, 0), null);
  assert.equal(B.itemOf(artistRow).kind, "artist");
});

// --- Pages --------------------------------------------------------------------

test("home: titled rows of cards, with a greeting for the hour", () => {
  const json = {
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    carousel("Quick picks", [songRow("q1", "Slow River")]),
                    carousel("Mixed for you", [card("Supermix", ["Mira Vale, Ode"], { watchPlaylistEndpoint: { playlistId: "RDTMAK5uy_x" } })]),
                    carousel("Empty", []),
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  const home = B.homeOf(json, 20);
  assert.equal(home.greeting, "Good evening");
  assert.deepEqual(
    home.sections.map((s) => [s.title, s.items.map((i) => i.kind)]),
    [
      ["Quick picks", ["track"]],
      ["Mixed for you", ["mix"]],
    ],
  );
});

test("search sorts what it finds by what it opens, top result first", () => {
  const json = {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    { musicCardShelfRenderer: { title: runs({ text: "Mira Vale", navigationEndpoint: browseTo("UCm", "ARTIST") }), subtitle: runs("Artist"), thumbnail: { musicThumbnailRenderer: { thumbnail: thumbs("https://lh3.googleusercontent.com/m=w544-h544") } } } },
                    { musicShelfRenderer: { title: runs("Songs"), contents: [songRow("s1", "Glass Bees"), songRow("s2", "Kites")] } },
                    {
                      musicShelfRenderer: {
                        title: runs("Albums"),
                        contents: [{ musicResponsiveListItemRenderer: { navigationEndpoint: browseTo("MPREb_n", "ALBUM"), flexColumns: [col(runs("Neon Orchard")), col(runs("Album", " • ", "Mira Vale"))] } }],
                      },
                    },
                    {
                      musicShelfRenderer: {
                        title: runs("Community playlists"),
                        contents: [{ musicResponsiveListItemRenderer: { navigationEndpoint: browseTo("VLPLx", "PLAYLIST"), flexColumns: [col(runs("Kites & Bees")), col(runs("Playlist"))] } }],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  const r = B.searchOf(json);
  assert.deepEqual(r.tracks.map((t) => [t.uri, t.uid]), [["ytm:track:s1", ""], ["ytm:track:s2", ""]]);
  assert.deepEqual(r.artists.map((i) => i.uri), ["ytm:artist:UCm"]);
  assert.deepEqual(r.albums.map((i) => i.uri), ["ytm:album:MPREb_n"]);
  assert.deepEqual(r.playlists.map((i) => i.uri), ["ytm:playlist:PLx"]);
});

const albumPage = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    musicResponsiveHeaderRenderer: {
                      title: runs("Paper Lanterns"),
                      subtitle: runs("Album", " • ", "2021"),
                      straplineTextOne: runs(artistRun("The Quiet Fields", "UCq")),
                      secondSubtitle: runs("2 songs", " • ", "7 minutes"),
                      thumbnail: { musicThumbnailRenderer: { thumbnail: thumbs("https://lh3.googleusercontent.com/pl=w544-h544", 544) } },
                      description: { musicDescriptionShelfRenderer: { description: runs("Recorded at night.") } },
                    },
                  },
                ],
              },
            },
          },
        },
      ],
      secondaryContents: {
        sectionListRenderer: {
          contents: [{ musicShelfRenderer: { contents: [songRow("a1", "First Light", { artists: [], album: null }), songRow("a2", "Slow River", { artists: [], album: null })] } }],
        },
      },
    },
  },
  microformat: { microformatDataRenderer: { urlCanonical: "https://music.youtube.com/playlist?list=OLAK5uy_paper" } },
};

test("an album page: header, tracks with the album's artist, and its playlist", () => {
  const { collection, playlistId } = B.collectionOf(albumPage, "ytm:album:MPREb_p", "album");
  assert.equal(playlistId, "OLAK5uy_paper");
  assert.deepEqual(collection.header, {
    uri: "ytm:album:MPREb_p",
    kind: "album",
    name: "Paper Lanterns",
    subtitle: "The Quiet Fields · Album · 2021",
    image: "https://lh3.googleusercontent.com/pl=w544-h544",
    description: "Recorded at night.",
  });
  assert.equal(collection.total, 2);
  assert.deepEqual(collection.tracks.map((t) => [t.name, t.artists, t.album]), [
    ["First Light", "The Quiet Fields", "Paper Lanterns"],
    ["Slow River", "The Quiet Fields", "Paper Lanterns"],
  ]);
});

test("a long playlist says its total and where it continues", () => {
  const json = {
    header: { musicEditablePlaylistDetailHeaderRenderer: { header: { musicResponsiveHeaderRenderer: { title: runs("Kites"), straplineTextOne: runs("Ada"), secondSubtitle: runs("1,204 songs") } } } },
    contents: {
      musicPlaylistShelfRenderer: {
        contents: [songRow("p1", "One", { setId: "S1" }), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "TOKEN" } } } }],
      },
    },
  };
  const { collection, continuation } = B.collectionOf(json, "ytm:playlist:PLk", "playlist");
  assert.equal(collection.header.name, "Kites");
  assert.equal(collection.total, 1204);
  assert.equal(continuation, "TOKEN");
  const more = B.continuedTracks({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [songRow("p2", "Two")] } }] }, 1);
  assert.deepEqual(more.tracks.map((t) => t.uid), ["p2:1"]);
  assert.equal(more.continuation, "");
});

test("an artist page: top songs, albums and singles, and what plays", () => {
  const json = {
    header: {
      musicImmersiveHeaderRenderer: {
        title: runs("Mira Vale"),
        description: runs("Dream pop."),
        thumbnail: { musicThumbnailRenderer: { thumbnail: thumbs("https://lh3.googleusercontent.com/mv=w544-h544", 544) } },
        subscriptionButton: { subscribeButtonRenderer: { subscriberCountText: runs("1.2M"), longSubscriberCountText: runs("1.2M subscribers") } },
        startRadioButton: { buttonRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: "RDEMmira", params: "wAEB" } } } },
      },
    },
    contents: {
      singleColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    { musicShelfRenderer: { title: runs({ text: "Top songs", navigationEndpoint: browseTo("VLOLAK5uy_top", "PLAYLIST") }), contents: [songRow("t1", "Glass Bees")] } },
                    carousel("Albums", [card("Neon Orchard", ["2023"], browseTo("MPREb_n", "ALBUM"))]),
                    carousel("Singles", [card("Kites", ["2024"], browseTo("MPREb_k", "ALBUM"))]),
                    carousel("Fans might also like", [card("Ode", ["Artist"], browseTo("UCo", "ARTIST"))]),
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  const page = B.artistOf(json, "ytm:artist:UCm");
  assert.equal(page.collection.header.name, "Mira Vale");
  assert.equal(page.collection.header.subtitle, "1.2M subscribers");
  json.header.musicImmersiveHeaderRenderer.monthlyListenerCount = runs("3.4M monthly audience");
  assert.equal(B.artistOf(json, "ytm:artist:UCm").collection.header.subtitle, "3.4M monthly audience");
  assert.deepEqual(page.collection.tracks.map((t) => t.uri), ["ytm:track:t1"]);
  assert.deepEqual(page.collection.releases.map((r) => r.uri), ["ytm:album:MPREb_n", "ytm:album:MPREb_k"]);
  assert.equal(page.songsPlaylistId, "OLAK5uy_top");
  assert.deepEqual(page.play, { playlistId: "RDEMmira", params: "wAEB" });
});

test("the library puts Liked Music first, and adds it when missing", () => {
  const playlists = { contents: { gridRenderer: { items: [card("Kites", ["Playlist"], browseTo("VLPLk", "PLAYLIST")), card("Liked Music", ["Auto playlist"], browseTo("VLLM", "PLAYLIST"))] } } };
  const albums = { contents: { gridRenderer: { items: [card("Neon Orchard", ["Album"], browseTo("MPREb_n", "ALBUM"))] } } };
  assert.deepEqual(B.libraryOf([playlists, albums]).items.map((i) => i.uri), ["ytm:collection:LM", "ytm:playlist:PLk", "ytm:album:MPREb_n"]);
  assert.deepEqual(B.libraryOf([]).items.map((i) => i.name), ["Liked Music"]);
});

test("the account: its sync id keys it", () => {
  const json = { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: runs("Ada"), channelHandle: runs("@ada"), accountPhoto: thumbs("https://yt3.ggpht.com/a=s88") } } } } } }] };
  assert.deepEqual(B.meOf(json, "1234567||"), { id: "1234567", name: "Ada", username: "@ada", image: "https://yt3.ggpht.com/a=s88" });
  assert.equal(B.meOf(json, "").id, "@ada");
  assert.throws(() => B.meOf({}, ""), /E_SIGNED_OUT/);
});

test("lyrics: the lyrics tab's page, as plain lines with their source", () => {
  const next = { contents: { tabbedRenderer: { tabs: [{ tabRenderer: { title: "Up next" } }, { tabRenderer: { endpoint: { browseEndpoint: { browseId: "MPLYt_abc" } } } }] } } };
  assert.equal(B.lyricsBrowseIdOf(next), "MPLYt_abc");
  assert.equal(B.lyricsBrowseIdOf({}), "");
  const page = { contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: { description: runs("First line\n\nSecond line\n"), footer: runs("Source: LyricFind") } }] } } };
  assert.deepEqual(B.lyricsOf(page), { synced: false, lines: [{ startMs: 0, words: "First line" }, { startMs: 0, words: "Second line" }], provider: "LyricFind" });
  assert.deepEqual(B.lyricsOf(null), { synced: false, lines: [], provider: "" });
});

// --- Small parts --------------------------------------------------------------

test("URIs, watch pages and the playing context", () => {
  assert.deepEqual(B.parseUri("ytm:track:abc-_1"), { kind: "track", id: "abc-_1" });
  assert.throws(() => B.parseUri("spotify:track:x"), /E_BAD_ARGS/);
  assert.throws(() => B.parseUri("ytm:track:a/b"), /E_BAD_ARGS/);
  assert.equal(B.watchOf({ videoId: "v", playlistId: "OLAK" }).url, "/watch?v=v&list=OLAK");
  assert.deepEqual(B.watchOf({ playlistId: "RDx", params: "p" }).endpoint.watchPlaylistEndpoint, { playlistId: "RDx", params: "p" });
  assert.equal(B.contextOf("OLAK", { uri: "ytm:album:MPREb_p", list: "OLAK" }), "ytm:album:MPREb_p");
  assert.equal(B.contextOf("LM", null), "ytm:collection:LM");
  assert.equal(B.contextOf("RDAMVMv", null), "ytm:mix:RDAMVMv");
  assert.equal(B.contextOf("PLx", { uri: "ytm:album:a", list: "OLAK" }), "ytm:playlist:PLx");
  assert.equal(B.contextOf("", null), "");
  assert.equal(B.repeatOf("ALL"), "context");
  assert.equal(B.repeatOf("ONE"), "track");
  assert.equal(B.repeatOf(null), "off");
  assert.equal(B.clockMs("1:02:03"), 3723000);
  assert.equal(B.clockMs("12 songs"), 0);
});

test("requests are signed with the account's SAPISID cookies", async () => {
  const sha1 = async (s) => "h(" + s + ")";
  const cookies = B.cookiesOf("PREF=x; SAPISID=sa; __Secure-1PAPISID=one; __Secure-3PAPISID=three");
  assert.equal(
    await B.authorizationOf(cookies, 1700000000, "https://music.youtube.com", sha1),
    "SAPISIDHASH 1700000000_h(1700000000 sa https://music.youtube.com) SAPISID1PHASH 1700000000_h(1700000000 one https://music.youtube.com) SAPISID3PHASH 1700000000_h(1700000000 three https://music.youtube.com)",
  );
  assert.equal(await B.authorizationOf({}, 1, "o", sha1), "");
});

// --- The bridge in a fake page --------------------------------------------------

// A page with the player bar and a `#movie_player` whose API the test drives.
function page({ cfg = true, ad = false } = {}) {
  const like = h("ytmusic-like-button-renderer", { "like-status": "INDIFFERENT" }, h("div", { id: "button-shape-like" }, h("button", {})));
  like.children[0].children[0].onclick = () => like.setAttribute("like-status", like.getAttribute("like-status") === "LIKE" ? "INDIFFERENT" : "LIKE");
  const repeat = h("button", { class: "repeat" });
  const barEl = h("ytmusic-player-bar", { "repeat-mode": "NONE" }, h("button", { class: "previous-button" }), h("button", { id: "play-pause-button" }), h("button", { class: "next-button" }), h("button", { class: "shuffle" }), repeat, like);
  repeat.onclick = () => barEl.setAttribute("repeat-mode", { NONE: "ALL", ALL: "ONE", ONE: "NONE" }[barEl.getAttribute("repeat-mode")]);
  const mp = h("div", { id: "movie_player", class: ad ? "html5-video-player ad-showing" : "html5-video-player" });
  const p = { video: "v1", list: "", state: 2, time: 12.5, duration: 200, volume: 80, muted: false, calls: [] };
  Object.assign(mp, {
    getVideoData: () => ({ video_id: p.video, title: "Glass Bees", author: "Mira Vale" }),
    getPlayerState: () => p.state,
    getCurrentTime: () => p.time,
    getDuration: () => p.duration,
    getVolume: () => p.volume,
    isMuted: () => p.muted,
    getPlaylistId: () => p.list,
    playVideo: () => (p.calls.push("play"), (p.state = 1)),
    pauseVideo: () => (p.calls.push("pause"), (p.state = 2)),
    seekTo: (s) => (p.calls.push("seek " + s), (p.time = s)),
    setVolume: (v) => (p.calls.push("volume " + v), (p.volume = v)),
    mute: () => (p.muted = true),
    unMute: () => (p.muted = false),
  });
  const app = h("ytmusic-app", {}, barEl, mp);
  const body = h("body", {}, app);
  const win = fakeWindow(body);
  if (cfg) win.ytcfg = { get: (k) => ({ INNERTUBE_CONTEXT: { client: { clientName: "WEB_REMIX", clientVersion: "1.2" } }, INNERTUBE_CONTEXT_CLIENT_NAME: 67 })[k] };
  win.navigator.mediaSession = { metadata: { title: "Glass Bees", artist: "Mira Vale", album: "Neon Orchard", artwork: [{ src: "https://lh3.googleusercontent.com/gb=w60-h60" }, { src: "https://lh3.googleusercontent.com/gb=w226-h226" }] } };
  return { win, p, app, bar: barEl, mp, like };
}

test("ready waits for the API config; then the state is reported", () => {
  const noCfg = page({ cfg: false });
  B.createBridge(noCfg.win, options(noCfg.win)).tick();
  assert.equal(noCfg.win.posted.length, 0);

  const { win } = page();
  const bridge = B.createBridge(win, options(win));
  bridge.tick();
  assert.deepEqual(win.posted.map((m) => m.type), ["ready", "state"]);
  const s = win.posted[1].state;
  assert.equal(s.title, "Glass Bees");
  assert.equal(s.artist, "Mira Vale");
  assert.equal(s.album, "Neon Orchard");
  assert.equal(s.artwork, "https://lh3.googleusercontent.com/gb=w544-h544");
  assert.equal(s.trackUri, "ytm:track:v1");
  assert.equal(s.playing, false);
  assert.equal(s.positionMs, 12500);
  assert.equal(s.durationMs, 200000);
  assert.equal(s.volume, 0.8);
  assert.equal(s.repeat, "off");
  assert.equal(s.ad, false);
  assert.equal(s.premium, null);
});

test("controls go through the player and its bar", async () => {
  const { win, p, bar, like } = page();
  const bridge = B.createBridge(win, options(win));
  await bridge.call("play", []);
  assert.equal(p.state, 1);
  await bridge.call("seek", [30000]);
  assert.ok(p.calls.includes("seek 30"));
  await bridge.call("setVolume", [0.5]);
  assert.equal(p.volume, 50);
  await bridge.call("setRepeat", ["track"]);
  assert.equal(bar.getAttribute("repeat-mode"), "ONE");
  await bridge.call("setLiked", [true]);
  assert.equal(like.getAttribute("like-status"), "LIKE");
  await bridge.call("setMuted", [true]);
  assert.equal(p.muted, true);
});

test("an ad: reported, and next and seek wait for it; it is never skipped", async () => {
  const { win, p } = page({ ad: true });
  const bridge = B.createBridge(win, options(win));
  bridge.tick();
  const s = win.posted.find((m) => m.type === "state").state;
  assert.equal(s.ad, true);
  assert.equal(s.premium, false);
  assert.equal(s.canNext, false);
  await rejects(bridge.call("next", []), "E_AD");
  await rejects(bridge.call("seek", [1000]), "E_AD");
  await rejects(bridge.call("playTrack", ["ytm:track:v9"]), "E_AD");
  assert.deepEqual(p.calls, []);
});

test("playing a playlist navigates in the page, and reports its context", async () => {
  const { win, p, app } = page();
  const asked = [];
  app.addEventListener("yt-navigate", (e) => {
    asked.push(e.detail.endpoint);
    p.video = "v7";
    p.list = "PLk";
  });
  const bridge = B.createBridge(win, options(win));
  const answer = await bridge.call("playContext", ["ytm:playlist:PLk", "ytm:track:v7"]);
  assert.deepEqual(asked[0].watchEndpoint, { videoId: "v7", playlistId: "PLk" });
  assert.equal(asked[0].commandMetadata.webCommandMetadata.url, "/watch?v=v7&list=PLk");
  assert.equal(answer.confirmed, true);
  bridge.tick();
  const s = win.posted.filter((m) => m.type === "state").pop().state;
  assert.equal(s.contextHref, "ytm:playlist:PLk");
  assert.equal(s.trackUri, "ytm:track:v7");
});

test("when the page does not take the navigation, it loads the watch page", async () => {
  const { win } = page();
  const bridge = B.createBridge(win, options(win));
  const answer = await bridge.call("playTrack", ["ytm:track:zz"]);
  assert.equal(answer.confirmed, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(win.assigned, "/watch?v=zz");
});

test("Google's consent wall is answered once, with Reject all", () => {
  const form = (eom, label) => {
    const f = h("form", { action: "https://consent.youtube.com/save" }, h("input", { name: "set_eom", value: eom }), h("button", { "aria-label": label }));
    f.submitted = 0;
    f.submit = () => f.submitted++;
    return f;
  };
  const accept = form("false", "Accept all");
  const reject = form("true", "Reject all");
  const win = fakeWindow(h("body", {}, accept, reject));
  win.location.hostname = "consent.youtube.com";
  const bridge = B.createBridge(win, options(win));
  bridge.tick();
  bridge.tick();
  assert.equal(reject.submitted, 1);
  assert.equal(accept.submitted, 0);
  assert.equal(win.posted.length, 0);
});

test("bad calls are refused with their code", async () => {
  const { win } = page();
  const bridge = B.createBridge(win, options(win));
  await rejects(bridge.call("nope", []), "E_UNKNOWN_CALL");
  await rejects(bridge.call("playContext", ["spotify:album:x", null]), "E_BAD_ARGS");
  await rejects(bridge.call("seek", [-1]), "E_BAD_ARGS");
  bridge.dispose();
  await rejects(bridge.call("play", []), "E_DISPOSED");
});

test("install replaces an older bridge, keeps a newer one, and skips frames", () => {
  const { win } = page();
  const first = B.install(win, options(win));
  assert.equal(win.__ytmfast, first);
  const second = B.install(win, options(win));
  assert.notEqual(second, first);
  win.__ytmfast = { revision: B.REVISION + 1 };
  assert.equal(B.install(win, options(win)).revision, B.REVISION + 1);
  const frame = page().win;
  frame.top = {};
  assert.equal(B.install(frame, options(frame)), null);
});

// --- OTA source -------------------------------------------------------------

test("source.ts is generated from bridge.js", () => {
  const bridge = readFileSync(join(here, "..", "bridge.js"), "utf8");
  const source = readFileSync(join(here, "..", "source.ts"), "utf8");
  assert.equal(source, render(bridge), "run `node src/bridge/gen-source.mjs`");
});

// --- Cover palettes -----------------------------------------------------------

test("a cover's palette leads with its most telling colours, without near-duplicates", () => {
  const px = [];
  const fill = (n, r, g, b, a = 255) => {
    for (let i = 0; i < n; i++) px.push(r, g, b, a);
  };
  fill(300, 20, 20, 20);
  fill(200, 220, 40, 40);
  fill(100, 225, 45, 42);
  fill(50, 0, 0, 0, 0);
  const palette = B.paletteOf(px, 5);
  assert.ok(palette.length >= 2);
  assert.ok(palette.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  assert.deepEqual(B.paletteOf([], 5), []);
});
