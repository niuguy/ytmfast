// YTMFast's bridge, installed in the top document of YouTube Music's web
// player (CDP `Page.addScriptToEvaluateOnNewDocument`) before the page's own
// scripts run.
//
// It asks YouTube Music's own API (InnerTube, `/youtubei/v1/...`) for data
// the way the page does, signed with the page's cookies; it reports the
// player's state to the app from the page's player (`#movie_player`, the
// player bar and `navigator.mediaSession`); and it presses the page's own
// controls for the app. Nothing here is a published API: every selector is in
// `SEL` and every answer is read by the pure parsers below (`itemOf`,
// `trackOf`, `homeOf`, ...), so a change of the web player is mended here.
//
// Ads: the bridge never blocks, hides, skips or mutes an ad, and never changes
// the volume on its own. While an ad plays it refuses seek, next, previous,
// setLiked, playContext and playTrack (E_AD).
//
// SINGLE SOURCE OF TRUTH. This file is what the Rust engine `include_str!`s
// (src/ytmusic/bridge.rs). `src/bridge/source.ts` is GENERATED from it so the
// OTA-updatable TSX bundle can carry a newer bridge (`setBridge(BRIDGE_SOURCE)`):
//   node src/bridge/gen-source.mjs           # regenerate source.ts
//   node src/bridge/gen-source.mjs --check   # fail if source.ts is stale
//   node --test src/bridge/tests/            # unit tests (also check the sync)
// Bump REVISION when the behavior changes: a bridge only replaces an installed
// one of the same or an older revision. To hot-swap, the engine runs
// `window.__ytmfast.dispose(); delete window.__ytmfast;` and then the new
// source; dispose() stops its timers.
//
// Protocol v1, every message `{ v: 1, type, ... }` through
// `window.ytmfastEvent(JSON.stringify(message))`:
//   { v:1, type:"ready" }                  once the player bar and the API config exist
//   { v:1, type:"state", state:{...} }     on change, plus a 1 s heartbeat
//   { v:1, type:"auth" }                   when the signed-in account changes
// Calls: `window.__ytmfast.call(name, argsArray)` (Runtime.evaluate with
// awaitPromise + returnByValue) resolves the plain JSON value, or rejects with
// `Error("E_CODE: message")`. The same methods are on `window.__ytmfast`.
//
// URIs are `ytm:<kind>:<id>`: `ytm:track:<videoId>`, `ytm:album:<MPREb_…>`,
// `ytm:artist:<UC…>`, `ytm:playlist:<playlistId>` (no `VL`), `ytm:mix:<id>`
// (a radio or mix: it plays, it has no page) and `ytm:collection:LM` (Liked
// Music).
(function (root) {
  "use strict";

  const PROTOCOL = 1;
  const REVISION = 3;
  const ORIGIN = "https://music.youtube.com";
  const LIKED_ID = "LM";
  const LIKED_URI = "ytm:collection:" + LIKED_ID;

  // --- The page's names, in one place ----------------------------------------

  const SEL = {
    app: "ytmusic-app",
    bar: "ytmusic-player-bar",
    player: "#movie_player",
    video: "video",
    playPause: "#play-pause-button",
    next: ".next-button",
    previous: ".previous-button",
    shuffle: ".shuffle",
    repeat: ".repeat",
    like: "ytmusic-like-button-renderer",
    likeButton: ["#button-shape-like button", ".like", "#button-shape-like"],
    barImage: "img.image, .thumbnail img",
    barTitle: ".title",
    barByline: ".byline",
    // "Video paused. Continue watching?" after a long while with no input.
    youThere: "ytmusic-you-there-renderer",
    youThereButton: "button, tp-yt-paper-button, yt-button-renderer",
    // Google's cookie consent wall (consent.youtube.com), shown to a new
    // profile in some regions: the "Reject all" form, whichever the language.
    consentReject: 'form[action*="consent."] input[name="set_eom"][value="true"]',
  };

  const PAGE_TYPE = {
    ALBUM: "MUSIC_PAGE_TYPE_ALBUM",
    PLAYLIST: "MUSIC_PAGE_TYPE_PLAYLIST",
    ARTIST: "MUSIC_PAGE_TYPE_ARTIST",
    USER_CHANNEL: "MUSIC_PAGE_TYPE_USER_CHANNEL",
    LIBRARY_ARTIST: "MUSIC_PAGE_TYPE_LIBRARY_ARTIST",
  };

  // --- Errors ----------------------------------------------------------------

  const fail = (code, message) => {
    const error = new Error(code + ": " + message);
    error.code = code;
    return error;
  };
  const codeOf = (error) => {
    const m = /^(E_[A-Z_]+):/.exec(String((error && error.message) || error));
    return m ? m[1] : "E_INTERNAL";
  };
  const messageOf = (error) => {
    const text = String((error && error.message) || error || "error");
    return /^E_[A-Z_]+:/.test(text) ? text : "E_INTERNAL: " + text;
  };
  const envelope = (type, extra) => Object.assign({ v: PROTOCOL, type }, extra || {});
  const toError = (error) => {
    if (error instanceof Error && /^E_[A-Z_]+:/.test(error.message)) return error;
    const normalized = new Error(messageOf(error));
    normalized.code = codeOf(normalized);
    return normalized;
  };

  // --- Pure helpers (exported to the node tests) -----------------------------

  const dig = (object, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), object);

  // The first value under `key` anywhere in `object`, depth first.
  const find = (object, key, depth) => {
    const d = depth || 0;
    if (!object || typeof object !== "object" || d > 40) return undefined;
    if (!Array.isArray(object) && Object.prototype.hasOwnProperty.call(object, key)) return object[key];
    for (const k in object) {
      const found = find(object[k], key, d + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  // Every value under `key` anywhere in `object`, in document order (not
  // looking inside a match).
  const findAll = (object, key, out, depth) => {
    const list = out || [];
    const d = depth || 0;
    if (!object || typeof object !== "object" || d > 40) return list;
    if (!Array.isArray(object) && Object.prototype.hasOwnProperty.call(object, key)) {
      list.push(object[key]);
      return list;
    }
    for (const k in object) findAll(object[k], key, list, d + 1);
    return list;
  };

  // The text of a `{ runs: [...] }` or `{ simpleText }`.
  const text = (t) => {
    if (!t) return "";
    if (typeof t === "string") return t;
    if (t.simpleText != null) return String(t.simpleText);
    if (Array.isArray(t.runs)) return t.runs.map((r) => (r && r.text) || "").join("");
    return "";
  };
  const runsOf = (t) => (t && Array.isArray(t.runs) ? t.runs : []);
  // YouTube's separator, as the app writes it.
  const tidy = (s) => String(s || "").replace(/\s+[•·]\s+/g, " · ").trim();

  const clockMs = (value) => {
    if (!value) return 0;
    const raw = String(value).trim();
    if (!/^\d+(:\d{1,2}){1,2}$/.test(raw)) return 0;
    return raw.split(":").map(Number).reduce((acc, p) => acc * 60 + p, 0) * 1000;
  };
  const isClock = (value) => /^\d+(:\d{1,2}){1,2}$/.test(String(value || "").trim());

  // The best thumbnail URL under `holder`: the largest; Google's image hosts
  // resized to `size` (their URLs carry `=w<n>-h<n>`).
  const thumbOf = (holder, size) => {
    const list = find(holder, "thumbnails");
    if (!Array.isArray(list) || !list.length) return "";
    const best = list.reduce((a, b) => ((b && b.width) || 0) >= ((a && a.width) || 0) ? b : a, list[0]);
    let url = (best && best.url) || "";
    if (url.startsWith("//")) url = "https:" + url;
    const want = size || 544;
    if (/googleusercontent\.com|ggpht\.com/.test(url)) url = url.replace(/=w\d+-h\d+/, "=w" + want + "-h" + want);
    return url;
  };

  const pageTypeOf = (endpoint) =>
    dig(endpoint, "browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType") || "";

  // What a navigation endpoint opens or plays, as `{ uri, kind }`; null when
  // the app has no use for it.
  const targetOf = (endpoint) => {
    if (!endpoint) return null;
    const watch = endpoint.watchEndpoint;
    if (watch && watch.videoId) return { uri: "ytm:track:" + watch.videoId, kind: "track" };
    if (watch && watch.playlistId) return { uri: "ytm:mix:" + watch.playlistId, kind: "mix" };
    const list = endpoint.watchPlaylistEndpoint;
    if (list && list.playlistId) return { uri: "ytm:mix:" + list.playlistId, kind: "mix" };
    const browse = endpoint.browseEndpoint;
    const id = browse && browse.browseId;
    if (!id) return null;
    const type = pageTypeOf(endpoint);
    if (type === PAGE_TYPE.ALBUM) return { uri: "ytm:album:" + id, kind: "album" };
    if (type === PAGE_TYPE.PLAYLIST || /^VL/.test(id)) {
      const playlistId = id.replace(/^VL/, "");
      return playlistId === LIKED_ID ? { uri: LIKED_URI, kind: "collection" } : { uri: "ytm:playlist:" + playlistId, kind: "playlist" };
    }
    if (type === PAGE_TYPE.LIBRARY_ARTIST) return { uri: "ytm:artist:" + id.replace(/^MPLA/, ""), kind: "artist" };
    if (type === PAGE_TYPE.ARTIST || type === PAGE_TYPE.USER_CHANNEL || /^UC/.test(id)) return { uri: "ytm:artist:" + id, kind: "artist" };
    return null;
  };

  const flexColumns = (r) => ((r && r.flexColumns) || []).map((c) => (c && c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text) || null);
  const fixedColumns = (r) => ((r && r.fixedColumns) || []).map((c) => (c && c.musicResponsiveListItemFixedColumnRenderer && c.musicResponsiveListItemFixedColumnRenderer.text) || null);

  // The video a list row plays, if it is a song or video.
  const videoIdOf = (r) =>
    dig(r, "playlistItemData.videoId") ||
    dig(r, "overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId") ||
    dig(runsOf(flexColumns(r)[0])[0], "navigationEndpoint.watchEndpoint.videoId") ||
    "";

  // A row of a list (`musicResponsiveListItemRenderer`) as a track; null
  // when it is not one. `fallback` fills what album rows leave out (their
  // artist, album and cover).
  const trackOf = (r, index, fallback) => {
    if (!r) return null;
    const f = fallback || {};
    if (r.navigationEndpoint && r.navigationEndpoint.browseEndpoint) return null; // an album, artist or playlist row
    const videoId = videoIdOf(r);
    const columns = flexColumns(r);
    const name = text(columns[0]);
    if (!videoId || !name) return null;
    const rest = columns.slice(1).flatMap(runsOf);
    const artists = rest.filter((run) => {
      const t = pageTypeOf(run.navigationEndpoint);
      return t === PAGE_TYPE.ARTIST || t === PAGE_TYPE.USER_CHANNEL;
    });
    const album = rest.find((run) => pageTypeOf(run.navigationEndpoint) === PAGE_TYPE.ALBUM);
    let artistText = artists.map((run) => run.text).join(", ");
    if (!artistText && columns[1]) {
      // Unlinked artists. A column in parts ("Song • 4:25") starts with the
      // entry's kind, so the artist is the next part, if any; a column of one
      // part is the artist.
      const raw = text(columns[1]).split(/\s+[•·]\s+/);
      const parts = raw.filter((p) => p && !isClock(p));
      artistText = (raw.length > 1 ? parts[1] : parts[0]) || "";
    }
    const fixed = fixedColumns(r).map(text).find(isClock);
    const clock = fixed || rest.map((run) => run.text).find(isClock) || "";
    const badges = JSON.stringify(r.badges || []);
    const setVideoId = dig(r, "playlistItemData.playlistSetVideoId") || "";
    return {
      uri: "ytm:track:" + videoId,
      uid: setVideoId || videoId + ":" + (index || 0),
      name,
      artists: artistText || f.artists || "",
      album: (album && album.text) || f.album || "",
      albumUri: album ? "ytm:album:" + album.navigationEndpoint.browseEndpoint.browseId : f.albumUri || "",
      image: thumbOf(r.thumbnail, 120) || f.image || "",
      durationMs: clockMs(clock),
      explicit: badges.includes("MUSIC_EXPLICIT_BADGE"),
      playable: r.musicItemRendererDisplayPolicy !== "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT",
    };
  };

  // A card or a row as an item (`{ uri, kind, name, subtitle, image }`), or
  // null. Takes `musicTwoRowItemRenderer` and `musicResponsiveListItemRenderer`.
  const itemOf = (r) => {
    if (!r) return null;
    if (r.flexColumns) {
      const columns = flexColumns(r);
      const name = text(columns[0]);
      let target = targetOf(r.navigationEndpoint);
      if (!target) {
        const videoId = videoIdOf(r);
        if (videoId) target = { uri: "ytm:track:" + videoId, kind: "track" };
      }
      if (!target || !name) return null;
      return { uri: target.uri, kind: target.kind, name, subtitle: tidy(columns.slice(1).map(text).filter(Boolean).join(" · ")), image: thumbOf(r.thumbnail, 226) };
    }
    const name = text(r.title);
    const target = targetOf(r.navigationEndpoint) || targetOf(dig(runsOf(r.title)[0], "navigationEndpoint"));
    if (!target || !name) return null;
    return { uri: target.uri, kind: target.kind, name, subtitle: tidy(text(r.subtitle)), image: thumbOf(r.thumbnailRenderer || r.thumbnail, 226) };
  };

  // Every item (card or row) of a shelf's `contents`.
  const itemsOf = (contents) =>
    (contents || [])
      .map((c) => itemOf((c && (c.musicTwoRowItemRenderer || c.musicResponsiveListItemRenderer || c.musicMultiRowListItemRenderer)) || null))
      .filter(Boolean);

  const dedupe = (items) => {
    const seen = new Set();
    return items.filter((i) => (seen.has(i.uri) ? false : (seen.add(i.uri), true)));
  };

  const greetingAt = (hour) => (hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

  // Home's sections (`browse` FEmusic_home, and its continuations).
  const sectionsOf = (json) =>
    findAll(json, "musicCarouselShelfRenderer")
      .concat(findAll(json, "musicImmersiveCarouselShelfRenderer"))
      .map((shelf) => ({ title: text(find(shelf.header, "title")), items: itemsOf(shelf.contents) }))
      .filter((s) => s.title && s.items.length);
  const homeOf = (json, hour) => ({ greeting: greetingAt(hour == null ? 12 : hour), sections: sectionsOf(json) });

  // The continuation token of a list or a page, if it has more.
  const continuationOf = (json) =>
    find(json, "nextContinuationData") ? find(json, "nextContinuationData").continuation : dig(find(json, "continuationItemRenderer"), "continuationEndpoint.continuationCommand.token") || "";

  // Whether a search row is music: not a user's profile, a podcast or one of
  // its episodes.
  const isMusic = (r) => {
    const type = pageTypeOf(r.navigationEndpoint);
    if (type === PAGE_TYPE.USER_CHANNEL || /PODCAST/.test(type)) return false;
    const first = runsOf(flexColumns(r)[0])[0];
    return !/NON_MUSIC|PODCAST/.test(pageTypeOf(first && first.navigationEndpoint));
  };

  // A search's answer: the top result first, then each list in the order
  // found. Classified by what each entry opens, not by the shelves' titles
  // (they are in the account's language).
  const searchOf = (json) => {
    const out = { tracks: [], artists: [], albums: [], playlists: [] };
    const add = (item) => {
      if (!item) return;
      if (item.kind === "artist") out.artists.push(item);
      else if (item.kind === "album") out.albums.push(item);
      else if (item.kind === "playlist" || item.kind === "mix" || item.kind === "collection") out.playlists.push(item);
    };
    const card = find(json, "musicCardShelfRenderer");
    let cardArtist = "";
    if (card) {
      const top = itemOf({ title: card.title, subtitle: card.subtitle, thumbnail: card.thumbnail, navigationEndpoint: dig(runsOf(card.title)[0], "navigationEndpoint") });
      if (top && top.kind === "track") {
        const t = { uri: top.uri, uid: "", name: top.name, artists: "", album: "", albumUri: "", image: top.image, durationMs: 0, explicit: false, playable: true };
        const subtitle = runsOf(card.subtitle);
        t.artists = subtitle.filter((r) => pageTypeOf(r.navigationEndpoint) === PAGE_TYPE.ARTIST).map((r) => r.text).join(", ");
        const album = subtitle.find((r) => pageTypeOf(r.navigationEndpoint) === PAGE_TYPE.ALBUM);
        if (album) Object.assign(t, { album: album.text, albumUri: "ytm:album:" + album.navigationEndpoint.browseEndpoint.browseId });
        t.durationMs = clockMs(subtitle.map((r) => r.text).find(isClock));
        out.tracks.push(t);
      } else add(top);
      if (top && top.kind === "artist") cardArtist = top.name;
      // The card's own rows: an artist's songs, which leave the artist out.
      findAll(card.contents, "musicResponsiveListItemRenderer").forEach((r, i) => {
        const t = trackOf(r, i, { artists: cardArtist });
        if (t) out.tracks.push(Object.assign(t, { uid: "" }));
      });
    }
    findAll(json, "musicResponsiveListItemRenderer").forEach((r, i) => {
      if (!isMusic(r)) return;
      const t = trackOf(r, i);
      if (t) {
        t.uid = "";
        out.tracks.push(t);
      } else add(itemOf(r));
    });
    const byUri = (list) => dedupe(list);
    return { tracks: byUri(out.tracks).slice(0, 20), artists: byUri(out.artists), albums: byUri(out.albums), playlists: byUri(out.playlists) };
  };

  // A collection page's header renderer, whichever kind the page uses.
  const headerOf = (json) =>
    find(json, "musicResponsiveHeaderRenderer") ||
    find(json, "musicDetailHeaderRenderer") ||
    find(json, "musicImmersiveHeaderRenderer") ||
    find(json, "musicVisualHeaderRenderer") ||
    find(json, "musicEditablePlaylistDetailHeaderRenderer") ||
    {};

  // How many songs a header says ("365K views • 28 tracks • 2 hours"): the
  // part that counts songs or tracks.
  const countOf = (value) => {
    const part = String(value || "")
      .split(/\s+[•·]\s+/)
      .find((p) => /\b(songs?|tracks?|episodes?|videos?)\b/i.test(p));
    const m = part && /(\d[\d,. ]*)/.exec(part);
    return m ? Number(m[1].replace(/[,. ]/g, "")) || 0 : 0;
  };

  // The playlist an album plays (`OLAK5uy_…`): its canonical URL's `list`,
  // else a play button's.
  const albumPlaylistOf = (json) => {
    const canonical = dig(find(json, "microformatDataRenderer"), "urlCanonical") || "";
    const m = /[?&]list=([A-Za-z0-9_-]+)/.exec(canonical);
    if (m) return m[1];
    const watch = findAll(json, "watchPlaylistEndpoint").concat(findAll(json, "watchEndpoint")).find((w) => w && w.playlistId);
    return (watch && watch.playlistId) || "";
  };

  // An album or a playlist page (`browse` MPREb_… or VL…).
  const collectionOf = (json, uri, kind) => {
    const h = headerOf(json);
    const header = h.header ? headerOf(h.header) : h;
    const name = text(header.title);
    const owner = text(header.straplineTextOne) || dig(header, "facepile.avatarStackViewModel.text.content") || "";
    const subtitle = tidy([owner, text(header.subtitle)].filter(Boolean).join(" · "));
    const description = text(find(header.description, "description")) || text(header.description);
    const image = thumbOf(header.thumbnail, 544);
    const shelf = find(json, "musicPlaylistShelfRenderer") || find(json, "musicShelfRenderer") || {};
    const fallback = kind === "album" ? { artists: owner || text(header.subtitle).split(/\s+[•·]\s+/).pop(), album: name, albumUri: uri, image } : {};
    const tracks = (shelf.contents || []).map((c, i) => trackOf(c && c.musicResponsiveListItemRenderer, i, fallback)).filter(Boolean);
    const total = countOf(text(header.secondSubtitle)) || countOf(text(header.subtitle)) || tracks.length;
    return {
      collection: {
        header: { uri, kind, name: name || (kind === "collection" ? "Liked Music" : ""), subtitle, image, description: description.trim() },
        tracks,
        releases: [],
        total: Math.max(total, tracks.length),
      },
      continuation: continuationOf(shelf),
      playlistId: kind === "album" ? albumPlaylistOf(json) : "",
    };
  };

  // The rows a continuation of a list adds.
  const continuedTracks = (json, offset, fallback) => {
    const rows = findAll(json, "musicResponsiveListItemRenderer");
    return { tracks: rows.map((r, i) => trackOf(r, offset + i, fallback)).filter(Boolean), continuation: continuationOf(json.continuationContents || json.onResponseReceivedActions || json) };
  };

  // An artist's page: top songs, their releases (albums and singles), and
  // what plays when the page's play button is pressed.
  const artistOf = (json, uri) => {
    const h = headerOf(json);
    const name = text(h.title);
    const subtitle = tidy(text(find(h, "subscriberCountText")) || text(h.monthlyListenerCount) || "Artist");
    const description = text(h.description) || text(find(h.description, "description"));
    const songsShelf = find(json, "musicShelfRenderer") || {};
    const tracks = (songsShelf.contents || []).map((c, i) => trackOf(c && c.musicResponsiveListItemRenderer, i)).filter(Boolean);
    const releases = dedupe(findAll(json, "musicCarouselShelfRenderer").flatMap((shelf) => itemsOf(shelf.contents)).filter((i) => i.kind === "album"));
    const songsBrowse = dig(runsOf(songsShelf.title)[0], "navigationEndpoint.browseEndpoint.browseId") || "";
    const play = findAll(h, "watchEndpoint").concat(findAll(h, "watchPlaylistEndpoint")).find((w) => w && w.playlistId) || null;
    return {
      collection: { header: { uri, kind: "artist", name, subtitle, image: thumbOf(h.thumbnail, 544), description: description.trim() }, tracks, releases, total: tracks.length },
      songsPlaylistId: songsBrowse.replace(/^VL/, ""),
      play: play ? { playlistId: play.playlistId, params: play.params || "" } : null,
    };
  };

  // The library's playlists, albums and artists, Liked Music first.
  const libraryOf = (answers) => {
    const items = dedupe(
      answers.flatMap((json) =>
        findAll(json, "musicTwoRowItemRenderer")
          .concat(findAll(json, "musicResponsiveListItemRenderer"))
          .map(itemOf)
          .filter((i) => i && i.kind !== "track" && i.kind !== "mix"),
      ),
    );
    const liked = items.find((i) => i.uri === LIKED_URI);
    const rest = items.filter((i) => i.uri !== LIKED_URI);
    return { items: [liked || { uri: LIKED_URI, kind: "collection", name: "Liked Music", subtitle: "Auto playlist", image: "" }].concat(rest) };
  };

  // The signed-in account, from `account/account_menu`.
  const meOf = (json, datasyncId) => {
    const h = find(json, "activeAccountHeaderRenderer");
    if (!h) throw fail("E_SIGNED_OUT", "no account");
    const name = text(h.accountName);
    const handle = text(h.channelHandle);
    const id = String(datasyncId || "").split("||")[0] || handle || name;
    return { id, name, username: handle || name, image: thumbOf(h.accountPhoto, 88) };
  };

  // The lyrics tab of a song (`next`): the browse id of its lyrics, or "".
  const lyricsBrowseIdOf = (json) => {
    const tab = findAll(json, "tabRenderer").find((t) => /^MPLYt/.test(dig(t, "endpoint.browseEndpoint.browseId") || ""));
    return tab ? tab.endpoint.browseEndpoint.browseId : "";
  };
  // Lyrics from their `browse` answer (plain words; YouTube Music's timed
  // lyrics are for its apps).
  const lyricsOf = (json) => {
    const shelf = json && find(json, "musicDescriptionShelfRenderer");
    if (!shelf) return { synced: false, lines: [], provider: "" };
    const lines = text(shelf.description)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((words) => ({ startMs: 0, words }));
    return { synced: false, lines, provider: text(shelf.footer).replace(/^Source:\s*/i, "") };
  };

  // A cover's palette: the colours that carry it, most telling first, from
  // its pixels (`[r, g, b, a, ...]`, a small sample). k-means over the
  // opaque pixels; each cluster is scored by its share and how colourful it
  // is, and a colour too close to a better one is dropped. At most `max`.
  const paletteOf = (pixels, max) => {
    const limit = max || 5;
    const points = [];
    for (let i = 0; i + 3 < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      points.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    }
    if (points.length === 0) return [];
    const k = Math.min(8, points.length);
    let centers = Array.from({ length: k }, (_, j) => points[Math.floor(((j + 0.5) * points.length) / k)].slice());
    let counts = new Array(k).fill(0);
    for (let round = 0; round < 10; round++) {
      const sums = Array.from({ length: k }, () => [0, 0, 0]);
      counts = new Array(k).fill(0);
      for (const p of points) {
        let best = 0;
        let bestD = Infinity;
        for (let j = 0; j < k; j++) {
          const c = centers[j];
          const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
        sums[best][0] += p[0];
        sums[best][1] += p[1];
        sums[best][2] += p[2];
        counts[best]++;
      }
      centers = centers.map((c, j) => (counts[j] ? sums[j].map((v) => v / counts[j]) : c));
    }
    const sat = ([r, g, b]) => {
      const hi = Math.max(r, g, b);
      const lo = Math.min(r, g, b);
      return hi === 0 ? 0 : (hi - lo) / hi;
    };
    const scored = centers
      .map((c, j) => ({ c, score: (counts[j] / points.length) * (0.25 + sat(c)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const picked = [];
    for (const { c } of scored) {
      if (picked.some((p) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < 40 * 40)) continue;
      picked.push(c);
      if (picked.length >= limit) break;
    }
    const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
    return picked.map((c) => "#" + hex(c[0]) + hex(c[1]) + hex(c[2]));
  };

  // A player's state equal for reporting, but for the moving clock.
  const stateKey = (s) => {
    const rest = Object.assign({}, s);
    delete rest.positionMs;
    delete rest.at;
    return JSON.stringify(rest);
  };
  // Whether to post `next` after `last` (the last posted state) at `now`.
  const shouldPost = (last, next, now, heartbeatMs = 1000, driftMs = 1500) => {
    if (!last) return true;
    if (stateKey(last) !== stateKey(next)) return true;
    const expected = last.positionMs + (last.playing ? next.at - last.at : 0);
    if (Math.abs(next.positionMs - expected) > driftMs) return true; // a seek
    return next.playing && now - last.at >= heartbeatMs;
  };

  const REPEAT = { NONE: "off", ALL: "context", ONE: "track" };
  const repeatOf = (attribute) => REPEAT[String(attribute || "").toUpperCase()] || "off";

  const hasClass = (el, name) => !!el && ` ${(el.getAttribute && el.getAttribute("class")) || ""} `.includes(` ${name} `);
  const isDisabled = (el) => !!el && (el.disabled === true || (el.getAttribute && (el.getAttribute("aria-disabled") === "true" || el.getAttribute("disabled") != null)));
  const usable = (name, el) => {
    if (!el) throw fail("E_NOT_FOUND", "control " + name);
    if (isDisabled(el)) throw fail("E_DISABLED", "control " + name);
    return el;
  };

  // `ytm:<kind>:<id>` → { kind, id }, or E_BAD_ARGS.
  const parseUri = (uri) => {
    const parts = String(uri || "").split(":");
    if (parts[0] !== "ytm" || !parts[1] || !/^[A-Za-z0-9_-]+$/.test(parts[2] || "")) throw fail("E_BAD_ARGS", "not a YouTube Music URI: " + uri);
    return { kind: parts[1], id: parts[2] };
  };

  // The watch page URL (and its in-app endpoint) for `{ videoId, playlistId, params }`.
  const watchOf = (target) => {
    const query = [];
    if (target.videoId) query.push("v=" + encodeURIComponent(target.videoId));
    if (target.playlistId) query.push("list=" + encodeURIComponent(target.playlistId));
    const url = "/watch?" + query.join("&");
    const inner = {};
    if (target.videoId) inner.videoId = target.videoId;
    if (target.playlistId) inner.playlistId = target.playlistId;
    if (target.params) inner.params = target.params;
    const endpoint = target.videoId ? { watchEndpoint: inner } : { watchPlaylistEndpoint: inner };
    endpoint.commandMetadata = { webCommandMetadata: { url, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } };
    return { url, endpoint };
  };

  // The URI of what plays, from the queue's playlist and what the app last
  // asked to play.
  const contextOf = (list, asked) => {
    if (!list) return "";
    if (asked && asked.list === list) return asked.uri;
    if (list === LIKED_ID) return LIKED_URI;
    if (/^RD/.test(list)) return "ytm:mix:" + list;
    return "ytm:playlist:" + list;
  };

  // The SAPISIDHASH authorization of a request from `origin` at `seconds`,
  // from the account's cookies (`sha1` hashes a string to hex).
  const authorizationOf = async (cookies, seconds, origin, sha1) => {
    const parts = [];
    const sign = async (label, value) => value && parts.push(label + " " + seconds + "_" + (await sha1(seconds + " " + value + " " + origin)));
    await sign("SAPISIDHASH", cookies.SAPISID || cookies["__Secure-3PAPISID"]);
    await sign("SAPISID1PHASH", cookies["__Secure-1PAPISID"]);
    await sign("SAPISID3PHASH", cookies["__Secure-3PAPISID"]);
    return parts.join(" ");
  };
  const cookiesOf = (text) => {
    const out = {};
    String(text || "")
      .split(/;\s*/)
      .forEach((pair) => {
        const at = pair.indexOf("=");
        if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
      });
    return out;
  };

  // --- The bridge --------------------------------------------------------------

  const createBridge = (win, options) => {
    const opts = options || {};
    const doc = win.document;
    const now = opts.now || (() => Date.now());
    const timers = { intervals: [], timeouts: [] };
    let alive = true;
    const sleep = opts.sleep || ((ms) => new Promise((r) => win.setTimeout(r, ms)));
    const warn = (...args) => {
      try {
        (win.console || console).warn(...args);
      } catch (_) {}
    };

    // What outlives a re-injection.
    let shared = win.__ytmfastShared;
    if (!shared || shared.v !== 1) {
      shared = { v: 1, albumLists: {}, artists: {}, asked: null, everAd: false, premium: null, account: null };
      try {
        Object.defineProperty(win, "__ytmfastShared", { value: shared, configurable: true, enumerable: false, writable: true });
      } catch (_) {
        win.__ytmfastShared = shared;
      }
    }

    const post = (message) => {
      if (!alive) return;
      try {
        if (typeof win.ytmfastEvent === "function") win.ytmfastEvent(JSON.stringify(message));
      } catch (_) {}
    };

    const waitFor = async (test, timeout = 15000, every = 100) => {
      const end = now() + timeout;
      for (;;) {
        if (!alive) throw fail("E_DISPOSED", "the bridge was replaced");
        const value = test();
        if (value) return value;
        if (now() > end) return null;
        await sleep(every);
      }
    };

    // --- InnerTube -------------------------------------------------------------

    const cfg = (key) => {
      try {
        const y = win.ytcfg;
        if (y && typeof y.get === "function") return y.get(key);
        return y && y.data_ ? y.data_[key] : undefined;
      } catch (_) {
        return undefined;
      }
    };
    const cookies = () => cookiesOf(doc.cookie);
    const signedIn = () => {
      const c = cookies();
      return !!(c.SAPISID || c["__Secure-3PAPISID"]);
    };
    const sha1 =
      opts.sha1 ||
      (async (value) => {
        const bytes = new win.TextEncoder().encode(value);
        const digest = await win.crypto.subtle.digest("SHA-1", bytes);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      });

    const innertube = async (endpoint, body) => {
      const context = cfg("INNERTUBE_CONTEXT");
      if (!context) throw fail("E_NOT_READY", "the page has no API config yet");
      const headers = {
        "content-type": "application/json",
        "x-origin": ORIGIN,
        "x-goog-authuser": String(cfg("SESSION_INDEX") || 0),
        "x-youtube-client-name": String(cfg("INNERTUBE_CONTEXT_CLIENT_NAME") || 67),
        "x-youtube-client-version": String(cfg("INNERTUBE_CONTEXT_CLIENT_VERSION") || (context.client && context.client.clientVersion) || ""),
      };
      const visitor = cfg("VISITOR_DATA");
      if (visitor) headers["x-goog-visitor-id"] = visitor;
      const authorization = await authorizationOf(cookies(), Math.floor(now() / 1000), ORIGIN, sha1);
      if (authorization) headers.authorization = authorization;
      const key = cfg("INNERTUBE_API_KEY");
      const url = "/youtubei/v1/" + endpoint + "?prettyPrint=false" + (key ? "&key=" + encodeURIComponent(key) : "");
      let response;
      try {
        response = await win.fetch(url, { method: "POST", headers, credentials: "include", body: JSON.stringify(Object.assign({ context }, body)) });
      } catch (error) {
        throw fail("E_NETWORK", endpoint + ": " + ((error && error.message) || error));
      }
      if (response.status === 401 || response.status === 403) throw fail(signedIn() ? "E_NO_AUTH" : "E_SIGNED_OUT", endpoint + ": HTTP " + response.status);
      if (response.status === 404) throw fail("E_NOT_FOUND", endpoint + ": HTTP 404");
      if (!response.ok) throw fail("E_HTTP", endpoint + ": HTTP " + response.status);
      const json = await response.json();
      if (json && json.error) throw fail("E_HTTP", endpoint + ": " + (json.error.message || json.error.code));
      return json;
    };
    const browse = (body) => innertube("browse", body);
    const needSignIn = (what) => {
      if (!signedIn()) throw fail("E_SIGNED_OUT", what + " needs a signed-in account");
    };

    // Up to `max` tracks of a list, following its continuations.
    const allTracks = async (first, max, fallback) => {
      const tracks = first.collection.tracks.slice();
      let token = first.continuation;
      for (let page = 0; token && tracks.length < max && page < 20; page++) {
        const json = await browse({ continuation: token });
        const more = continuedTracks(json, tracks.length, fallback);
        if (!more.tracks.length) break;
        tracks.push(...more.tracks);
        token = more.continuation;
      }
      return tracks;
    };

    // Samples a cover at 24 × 24 into a palette, within a few seconds.
    const samplePalette = (url) =>
      new Promise((resolve, reject) => {
        const img = new win.Image();
        img.crossOrigin = "anonymous";
        const timer = win.setTimeout(() => reject(new Error("timed out")), 4000);
        img.onload = () => {
          win.clearTimeout(timer);
          try {
            const canvas = doc.createElement("canvas");
            canvas.width = 24;
            canvas.height = 24;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0, 24, 24);
            resolve(paletteOf(ctx.getImageData(0, 0, 24, 24).data, 5));
          } catch (error) {
            reject(error);
          }
        };
        img.onerror = () => {
          win.clearTimeout(timer);
          reject(new Error("not loaded"));
        };
        img.src = url;
      });

    const api = {
      async home() {
        const first = await browse({ browseId: "FEmusic_home" });
        const home = homeOf(first, new Date(now()).getHours());
        // One more page of sections, when there is one.
        const token = continuationOf(dig(first, "contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer") || {});
        if (token) {
          try {
            home.sections = home.sections.concat(sectionsOf(await browse({ continuation: token })));
          } catch (error) {
            warn("[ytmfast] home continuation:", messageOf(error));
          }
        }
        return home;
      },

      async search(term) {
        const query = String(term || "").trim();
        if (!query) return { tracks: [], artists: [], albums: [], playlists: [] };
        return searchOf(await innertube("search", { query }));
      },

      async playlist(uri) {
        const { id } = parseUri(uri);
        const first = collectionOf(await browse({ browseId: "VL" + id }), uri, "playlist");
        first.collection.tracks = await allTracks(first, 1000);
        return first.collection;
      },

      async likedSongs() {
        needSignIn("Liked Music");
        const first = collectionOf(await browse({ browseId: "VL" + LIKED_ID }), LIKED_URI, "collection");
        first.collection.header.name = first.collection.header.name || "Liked Music";
        first.collection.tracks = await allTracks(first, 2000);
        first.collection.total = Math.max(first.collection.total, first.collection.tracks.length);
        return first.collection;
      },

      async album(uri) {
        const { id } = parseUri(uri);
        const first = collectionOf(await browse({ browseId: id }), uri, "album");
        if (first.playlistId) shared.albumLists[id] = first.playlistId;
        return first.collection;
      },

      async artist(uri) {
        const { id } = parseUri(uri);
        const page = artistOf(await browse({ browseId: id }), uri);
        shared.artists[id] = { songs: page.songsPlaylistId, play: page.play };
        return page.collection;
      },

      async library() {
        needSignIn("the library");
        const answers = await Promise.all(
          ["FEmusic_liked_playlists", "FEmusic_liked_albums", "FEmusic_library_corpus_artists"].map((browseId) =>
            browse({ browseId }).catch((error) => {
              warn("[ytmfast] library " + browseId + ":", messageOf(error));
              return null;
            }),
          ),
        );
        return libraryOf(answers.filter(Boolean));
      },

      async me() {
        needSignIn("the account");
        const json = await innertube("account/account_menu", {});
        // A free account's menu offers Premium; a Premium one does not.
        const offersPremium = /music_premium|musicpremium/i.test(JSON.stringify(json));
        if (!shared.everAd) shared.premium = offersPremium ? false : null;
        return meOf(json, cfg("DATASYNC_ID"));
      },

      async colors(imageUrl) {
        const palette = await samplePalette(String(imageUrl || "")).catch((error) => {
          warn("[ytmfast] palette:", messageOf(error));
          return [];
        });
        return { hex: palette[0] || "", palette };
      },

      async lyrics(trackUri) {
        const { kind, id } = parseUri(trackUri);
        if (kind !== "track") return lyricsOf(null);
        const browseId = lyricsBrowseIdOf(await innertube("next", { videoId: id, isAudioOnly: true }));
        if (!browseId) return lyricsOf(null);
        return lyricsOf(await browse({ browseId }));
      },
    };

    // --- The player: its state ---------------------------------------------------

    const q = (selector, scope) => (scope || doc).querySelector(selector);
    const bar = () => q(SEL.bar);
    const inBar = (selector) => q(selector, bar() || doc);
    const player = () => q(SEL.player);
    const call = (name, ...args) => {
      const p = player();
      try {
        return p && typeof p[name] === "function" ? p[name](...args) : undefined;
      } catch (error) {
        warn("[ytmfast] player." + name + ":", messageOf(error));
        return undefined;
      }
    };
    const video = () => q(SEL.video, player() || doc);
    const adNow = () => {
      const p = player();
      const ad = hasClass(p, "ad-showing") || hasClass(p, "ad-interrupting");
      if (ad) shared.everAd = true;
      return ad;
    };
    const listNow = () => {
      try {
        const list = new URL(win.location.href).searchParams.get("list");
        if (list) return list;
      } catch (_) {}
      return call("getPlaylistId") || "";
    };
    const videoIdNow = () => {
      const data = call("getVideoData");
      return (data && data.video_id) || "";
    };
    const readPlaying = () => {
      const v = video();
      if (v && typeof v.paused === "boolean") return !v.paused;
      const state = call("getPlayerState");
      return state === 1 || state === 3;
    };
    const readRepeat = () => repeatOf(bar() && bar().getAttribute("repeat-mode"));
    const readLiked = () => {
      const like = inBar(SEL.like);
      return !!like && like.getAttribute("like-status") === "LIKE";
    };
    const readVolume = () => {
      const v = Number(call("getVolume"));
      return isFinite(v) ? Math.round(v) / 100 : 1;
    };

    const playerState = () => {
      const meta = win.navigator && win.navigator.mediaSession && win.navigator.mediaSession.metadata;
      const data = call("getVideoData") || {};
      const ad = adNow();
      const v = video();
      const title = (meta && meta.title) || data.title || text(inBar(SEL.barTitle) && inBar(SEL.barTitle).textContent) || "";
      const artwork = meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : (inBar(SEL.barImage) && inBar(SEL.barImage).src) || "";
      const position = v && isFinite(v.currentTime) ? v.currentTime : Number(call("getCurrentTime")) || 0;
      const duration = v && isFinite(v.duration) && v.duration > 0 ? v.duration : Number(call("getDuration")) || 0;
      const shuffle = inBar(SEL.shuffle);
      const next = inBar(SEL.next);
      const previous = inBar(SEL.previous);
      return {
        title,
        artist: (meta && meta.artist) || data.author || "",
        album: (meta && meta.album) || "",
        artwork: String(artwork || "").replace(/=w\d+-h\d+/, "=w544-h544"),
        trackUri: data.video_id && title ? "ytm:track:" + data.video_id : "",
        contextHref: contextOf(listNow(), shared.asked),
        playing: readPlaying(),
        canPlay: !!player(),
        positionMs: Math.round(position * 1000),
        durationMs: Math.round(duration * 1000),
        at: now(),
        shuffle: false, // YouTube Music's shuffle reorders the queue once; it is no mode
        shuffleAvailable: !!shuffle && !isDisabled(shuffle) && !ad,
        repeat: readRepeat(),
        volume: readVolume(),
        muted: !!call("isMuted"),
        liked: readLiked(),
        canNext: !ad && (!next || !isDisabled(next)),
        canPrevious: !ad && (!previous || !isDisabled(previous)),
        ad,
        premium: shared.everAd ? false : shared.premium,
      };
    };

    // Google's consent wall stands before the player in some regions. The
    // bridge answers it once with "Reject all", the most private choice: only
    // the cookies YouTube needs to work are kept. The page then goes on to
    // YouTube Music, and the bridge installs there again.
    let consentAnswered = false;
    const onConsentWall = () => /(^|\.)consent\.(youtube|google)\.com$/.test((win.location && win.location.hostname) || "");
    const answerConsent = () => {
      if (consentAnswered) return;
      const input = q(SEL.consentReject);
      const form = input && input.closest && input.closest("form");
      if (!form) return;
      consentAnswered = true;
      const button = q("button", form);
      if (typeof form.submit === "function") form.submit();
      else if (button) button.click();
    };

    // Answers "Continue watching?": the listener is using the app.
    const stillHere = () => {
      const prompt = q(SEL.youThere);
      if (!prompt || prompt.getAttribute("hidden") != null) return;
      const button = q(SEL.youThereButton, prompt);
      if (button) button.click();
    };

    let lastPosted = null;
    let readyPosted = false;
    let lastAccount = null;
    const tick = () => {
      if (!alive) return;
      try {
        if (onConsentWall()) {
          answerConsent();
          return;
        }
        if (!readyPosted) {
          if (!bar() || !cfg("INNERTUBE_CONTEXT")) return;
          readyPosted = true;
          post(envelope("ready"));
        }
        const c = cookies();
        const account = c.SAPISID || c["__Secure-3PAPISID"] || "";
        if (lastAccount !== null && account !== lastAccount) post(envelope("auth"));
        lastAccount = account;
        stillHere();
        const s = playerState();
        if (shouldPost(lastPosted, s, s.at)) {
          lastPosted = s;
          post(envelope("state", { state: s }));
        }
      } catch (error) {
        warn("[ytmfast] state:", messageOf(error));
      }
    };
    const soon = (ms) => {
      const id = win.setTimeout(tick, ms);
      timers.timeouts.push(id);
      if (timers.timeouts.length > 32) timers.timeouts.shift();
    };

    // --- The player: its controls ------------------------------------------------

    const refuseDuringAd = (what) => {
      if (adNow()) throw fail("E_AD", what + " waits for the ad to end");
    };
    const press = (name, selector) => usable(name, inBar(selector)).click();

    // Plays `target` ({ videoId, playlistId, params }) through the page's own
    // navigation, as a click on a song would; a full load of the watch page
    // when the page does not take it.
    const watch = async (target) => {
      const before = { video: videoIdNow(), list: listNow() };
      const { url, endpoint } = watchOf(target);
      const app = q(SEL.app);
      let moved = false;
      if (app && typeof app.dispatchEvent === "function") {
        const Custom = win.CustomEvent || win.Event;
        app.dispatchEvent(new Custom("yt-navigate", { bubbles: true, composed: true, detail: { endpoint } }));
        moved = !!(await waitFor(() => {
          const video = videoIdNow();
          if (target.videoId) return video === target.videoId;
          return (video && video !== before.video) || (listNow() === target.playlistId && before.list !== target.playlistId);
        }, 6000, 100));
      }
      if (!moved) {
        // The page reloads, and the bridge with it; answer first.
        const id = win.setTimeout(() => win.location.assign(url), 0);
        timers.timeouts.push(id);
        return { confirmed: false };
      }
      if (!readPlaying()) call("playVideo");
      return { confirmed: !!(await waitFor(() => readPlaying() || adNow(), 4000, 100)) };
    };

    // What `uri` plays: its queue's playlist, and how to start it.
    const playTarget = async (uri) => {
      const { kind, id } = parseUri(uri);
      if (kind === "playlist" || kind === "mix") return { playlistId: id };
      if (kind === "collection") return { playlistId: LIKED_ID };
      if (kind === "album") {
        if (!shared.albumLists[id]) await api.album(uri);
        const playlistId = shared.albumLists[id];
        if (!playlistId) throw fail("E_NOT_FOUND", "no playlist for " + uri);
        return { playlistId };
      }
      if (kind === "artist") {
        if (!shared.artists[id]) await api.artist(uri);
        const artist = shared.artists[id] || {};
        if (artist.songs) return { playlistId: artist.songs };
        if (artist.play) return { playlistId: artist.play.playlistId, params: artist.play.params };
        throw fail("E_NOT_FOUND", "nothing to play for " + uri);
      }
      throw fail("E_BAD_ARGS", "cannot play " + uri);
    };

    const controls = {
      toggle: async () => {
        if (readPlaying()) call("pauseVideo");
        else call("playVideo");
        return null;
      },
      play: async () => {
        call("playVideo");
        if (!(await waitFor(() => readPlaying(), 3000, 50))) throw fail("E_TIMEOUT", "did not start playing");
        return true;
      },
      pause: async () => {
        call("pauseVideo");
        if (!(await waitFor(() => !readPlaying(), 3000, 50))) throw fail("E_TIMEOUT", "did not pause");
        return false;
      },
      next: async () => {
        refuseDuringAd("next");
        if (inBar(SEL.next)) press("next", SEL.next);
        else call("nextVideo");
        return null;
      },
      previous: async () => {
        refuseDuringAd("previous");
        if (inBar(SEL.previous)) press("previous", SEL.previous);
        else call("previousVideo");
        return null;
      },
      seek: async (ms) => {
        const target = Number(ms);
        if (!isFinite(target) || target < 0) throw fail("E_BAD_ARGS", "seek to " + ms);
        refuseDuringAd("seek");
        if (!player()) throw fail("E_NOT_FOUND", "control seek");
        call("seekTo", target / 1000, true);
        await waitFor(() => Math.abs(playerState().positionMs - target) <= 2000, 2000, 50);
        const after = playerState();
        return { positionMs: after.positionMs, at: after.at };
      },
      setVolume: async (v) => {
        const level = Number(v);
        if (!isFinite(level)) throw fail("E_BAD_ARGS", "volume " + v);
        if (!player()) throw fail("E_NOT_FOUND", "control volume");
        call("setVolume", Math.round(Math.min(1, Math.max(0, level)) * 100));
        return { volume: readVolume() };
      },
      setMuted: async (on) => {
        call(on ? "mute" : "unMute");
        return !!on;
      },
      // Shuffle reorders the queue once; turning it "off" changes nothing.
      setShuffle: async (on) => {
        if (on) press("shuffle", SEL.shuffle);
        return false;
      },
      setRepeat: async (mode) => {
        if (!/^(off|context|track)$/.test(mode)) throw fail("E_BAD_ARGS", "repeat " + mode);
        for (let i = 0; readRepeat() !== mode; i++) {
          if (i >= 3) throw fail("E_TIMEOUT", "repeat is " + readRepeat() + ", not " + mode);
          const before = readRepeat();
          press("repeat", SEL.repeat);
          if (!(await waitFor(() => readRepeat() !== before, 1500, 50))) throw fail("E_TIMEOUT", "repeat did not change");
        }
        return mode;
      },
      setLiked: async (on) => {
        refuseDuringAd("setLiked");
        const target = !!on;
        if (readLiked() === target) return target;
        const scope = inBar(SEL.like) || doc;
        // The first alternative that exists, in the order given (a comma list
        // would match the wrapper before the button inside it).
        const button = SEL.likeButton.map((selector) => q(selector, scope)).find(Boolean);
        if (button) {
          button.click();
          if (await waitFor(() => readLiked() === target, 2500, 50)) return target;
        }
        // The bar's button did not take: ask the API.
        const videoId = videoIdNow();
        if (!videoId) throw fail("E_NOTHING_LOADED", "nothing to like");
        await innertube(target ? "like/like" : "like/removelike", { target: { videoId } });
        return target;
      },

      // Plays a playlist, album, artist, mix or Liked Music from its start, or
      // from the track `trackUri` of it.
      async playContext(uri, trackUri) {
        if (typeof uri !== "string") throw fail("E_BAD_ARGS", "playContext needs a URI");
        if (trackUri != null && typeof trackUri !== "string") throw fail("E_BAD_ARGS", "playContext takes a track URI or null, not " + JSON.stringify(trackUri));
        refuseDuringAd("playContext");
        const target = await playTarget(uri);
        if (trackUri) {
          const track = parseUri(trackUri);
          if (track.kind !== "track") throw fail("E_BAD_ARGS", "not a track: " + trackUri);
          target.videoId = track.id;
        }
        shared.asked = { uri, list: target.playlistId };
        return watch(target);
      },

      // Plays one song; its radio follows it.
      async playTrack(uri) {
        const { kind, id } = parseUri(uri);
        if (kind !== "track") throw fail("E_BAD_ARGS", "not a track: " + uri);
        refuseDuringAd("playTrack");
        if (videoIdNow() === id) {
          if (!readPlaying()) await controls.play();
          return { confirmed: true };
        }
        shared.asked = null;
        return watch({ videoId: id });
      },
    };

    const methods = Object.assign({}, api, controls, { state: async () => playerState() });

    const surface = {
      protocol: PROTOCOL,
      revision: REVISION,
      async call(name, args) {
        try {
          if (!alive) throw fail("E_DISPOSED", "the bridge was replaced");
          if (!Object.prototype.hasOwnProperty.call(methods, name)) throw fail("E_UNKNOWN_CALL", String(name));
          const value = await methods[name](...(Array.isArray(args) ? args : args == null ? [] : [args]));
          return value === undefined ? null : value;
        } catch (error) {
          throw toError(error);
        } finally {
          if (controls[name]) soon(150);
        }
      },
      dispose() {
        alive = false;
        timers.intervals.forEach((id) => win.clearInterval(id));
        timers.timeouts.forEach((id) => win.clearTimeout(id));
        timers.intervals = [];
        timers.timeouts = [];
      },
      tick, // for tests
    };
    Object.keys(methods).forEach((name) => {
      surface[name] = (...args) => methods[name](...args);
    });

    if (opts.autostart !== false) timers.intervals.push(win.setInterval(tick, opts.tickMs || 250));
    return surface;
  };

  // Installs the bridge in `win` once, replacing an installed one of the same
  // or an older revision (safe to inject again).
  const install = (win, options) => {
    try {
      if (win !== win.top) return null; // only the top document: no iframes
    } catch (_) {
      return null;
    }
    const existing = win.__ytmfast;
    if (existing) {
      if (typeof existing.revision === "number" && existing.revision > REVISION) return existing;
      try {
        if (typeof existing.dispose === "function") existing.dispose();
      } catch (_) {}
    }
    const bridge = createBridge(win, options);
    try {
      Object.defineProperty(win, "__ytmfast", { value: bridge, configurable: true, enumerable: false, writable: true });
    } catch (_) {
      win.__ytmfast = bridge;
    }
    return bridge;
  };

  const exported = {
    PROTOCOL,
    REVISION,
    SEL,
    LIKED_URI,
    fail,
    codeOf,
    messageOf,
    envelope,
    toError,
    find,
    findAll,
    text,
    clockMs,
    thumbOf,
    targetOf,
    trackOf,
    itemOf,
    homeOf,
    searchOf,
    collectionOf,
    continuedTracks,
    artistOf,
    libraryOf,
    meOf,
    lyricsBrowseIdOf,
    lyricsOf,
    paletteOf,
    stateKey,
    shouldPost,
    repeatOf,
    parseUri,
    watchOf,
    contextOf,
    authorizationOf,
    cookiesOf,
    createBridge,
    install,
  };

  if (typeof root.window === "undefined" && typeof module === "object" && module && module.exports) {
    module.exports = exported; // node tests
  } else {
    install(root);
  }
})(typeof window !== "undefined" ? window : globalThis);
