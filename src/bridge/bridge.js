// Spotish's bridge, installed in the top document of the Spotify web player
// (CDP `Page.addScriptToEvaluateOnNewDocument`) before the player's own
// scripts run.
//
// It learns what the player itself uses to talk to Spotify (the headers of its
// GraphQL requests, the persisted queries' hashes in its bundles), so the app
// can ask for the same data; it reports the player's state to the app and
// presses the player's own controls for it. Nothing here is a published API:
// every selector and field name the page offers is read in one place (`SEL`
// and the normalizers), so a change of the web player is mended here.
//
// Ads: the bridge never blocks, hides, skips or mutes an ad, and never changes
// the volume on its own. While an ad plays it refuses seek, next, previous,
// setLiked, playContext and playTrack (E_AD).
//
// SINGLE SOURCE OF TRUTH. This file is what the Rust engine `include_str!`s
// (src/spotify/session.rs). `src/bridge/source.ts` is GENERATED from it so the
// OTA-updatable TSX bundle can carry a newer bridge (`setBridge(BRIDGE_SOURCE)`):
//   node src/bridge/gen-source.mjs           # regenerate source.ts
//   node src/bridge/gen-source.mjs --check   # fail if source.ts is stale
//   node --test src/bridge/tests/            # unit tests (also check the sync)
// Bump REVISION when the behavior changes: a bridge only replaces an installed
// one of the same or an older revision. To hot-swap, the engine runs
// `window.__spotish.dispose(); delete window.__spotish;` and then the new
// source; dispose() stops timers and loops and restores the page's fetch and
// media `play` where nothing wrapped them since.
//
// Protocol v1, every message `{ v: 1, type, ... }` through
// `window.spotishEvent(JSON.stringify(message))`:
//   { v:1, type:"ready" }                  once the player bar and auth exist
//   { v:1, type:"state", state:{...} }     on change, plus a 1 s heartbeat
//   { v:1, type:"auth" }                   when the player's auth changes
// Calls: `window.__spotish.call(name, argsArray)` (Runtime.evaluate with
// awaitPromise + returnByValue) resolves the plain JSON value, or rejects with
// `Error("E_CODE: message")`. The same methods are on `window.__spotish`.
(function (root) {
  "use strict";

  const PROTOCOL = 1;
  const REVISION = 8;
  // Liked Songs' cover: the library reports it; the tracks query does not.
  const LIKED_IMAGE = "https://misc.scdn.co/liked-songs/liked-songs-640.png";
  let likedImage = "";

  // --- The page's names, in one place ----------------------------------------

  const SEL = {
    bar: '[data-testid="now-playing-bar"]',
    playPause: '[data-testid="control-button-playpause"]',
    next: '[data-testid="control-button-skip-forward"]',
    previous: '[data-testid="control-button-skip-back"]',
    shuffle: '[data-testid="control-button-shuffle"]',
    repeat: '[data-testid="control-button-repeat"]',
    progress: '[data-testid="playback-progressbar"] input[type="range"]',
    position: '[data-testid="playback-position"]',
    duration: '[data-testid="playback-duration"]',
    volume: '[data-testid="volume-bar"] input[type="range"]',
    mute: '[data-testid="volume-bar-toggle-mute-button"]',
    // The widget's test id has a version suffix (`now-playing-widget-v2`).
    like: '[data-testid^="now-playing-widget"] button[aria-checked]',
    // A liked track's button opens an "Add to playlist" picker; Liked Songs
    // is a checkbox item of it.
    likedChoice: '[role="menuitemcheckbox"] [aria-labelledby$="spotify:collection:tracks"]',
    title: '[data-testid="context-item-info-title"] a, [data-testid="context-item-link"]',
    context:
      '[data-testid^="now-playing-widget"] a[href*="/playlist/"], [data-testid^="now-playing-widget"] a[href*="/album/"], [data-testid^="now-playing-widget"] a[href*="/artist/"], [data-testid^="now-playing-widget"] a[href*="/collection/"]',
    adMarker: '[data-testid="context-item-info-ad-subtitle"], [data-testid="ad-link"], [data-testid="ad-type-indicator"]',
    login: '[data-testid="login-button"]',
    topBar: '[data-testid="top-bar"], [data-testid="topbar"], [data-testid="global-nav-bar"], #global-nav-bar',
    upgrade: '[data-testid="upgrade-button"], a[href*="/premium"], button[aria-label*="Premium" i]',
    userWidget: '[data-testid="user-widget-link"], [data-testid="user-widget-name"]',
    actionPlay: '[data-testid="action-bar-row"] [data-testid="play-button"]',
    // A podcast's page has no play button of its own: its newest episode's.
    showPlay: '[data-testid="show-all-episode-list"] [data-testid="episode-0"] [data-testid="play-button"]',
    row: '[data-testid="tracklist-row"]',
    rowPlay: 'button[data-testid="play-button"], button[aria-label^="Play"], button[aria-label^="Pause"]',
    scroller: [
      '[data-testid="playlist-tracklist"]', // its closest scroll viewport
      ".main-view-container [data-overlayscrollbars-viewport]",
      ".main-view-container__scroll-node",
    ],
  };
  const BUNDLE_HOST = /(^|\.)(spotify\.com|scdn\.co|spotifycdn\.com)$/i;
  const HASH_RE = /"([A-Za-z0-9_]+)","(?:query|mutation)","([0-9a-f]{64})"/g;

  // --- Pure helpers (exported to the node tests) -----------------------------

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
    // Seeds spread through the sample (deterministic).
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

  // The protocol's envelope.
  const envelope = (type, extra) => Object.assign({ v: PROTOCOL, type }, extra || {});
  // A call's answer, as the engine reads it (a JSON string).
  // A failure as the engine reads it: an Error whose message is "E_CODE: …".
  const toError = (error) => {
    if (error instanceof Error && /^E_[A-Z_]+:/.test(error.message)) return error;
    const normalized = new Error(messageOf(error));
    normalized.code = codeOf(normalized);
    return normalized;
  };

  const dig = (object, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), object);
  // The value at `path` of a query's `data`, or E_SHAPE when the page changed
  // its answer under us.
  const need = (op, data, path, warn) => {
    const value = dig(data, path);
    if (value === undefined || value === null) {
      if (warn) warn("[spotish] unexpected shape of " + op + ": missing " + path);
      throw fail("E_SHAPE", op + "." + path);
    }
    return value;
  };
  // A `__typename` saying the entity does not exist (or is unavailable).
  const missingEntity = (op, entity, uri) => {
    const name = (entity && entity.__typename) || "";
    if (/NotFound|Unavailable|GenericError|RestrictedContent/i.test(name)) throw fail("E_NOT_FOUND", op + " " + (uri || "") + " (" + name + ")");
  };

  const kindOf = (uri) => (uri || "").split(":")[1] || "";
  const idOf = (uri) => (uri || "").split(":")[2] || "";

  // A track's lyrics from Spotify's color-lyrics answer: whether its lines
  // are timed (`LINE_SYNCED`), each line's start in ms and its words (an
  // instrumental break, empty, as "♪"), and who provides them. No lyrics:
  // no lines.
  const lyricsOf = (json) => {
    const l = json && json.lyrics;
    if (!l || !Array.isArray(l.lines)) return { synced: false, lines: [], provider: "" };
    const synced = l.syncType === "LINE_SYNCED";
    const lines = l.lines
      .map((line) => ({ startMs: synced ? Number(line && line.startTimeMs) || 0 : 0, words: String((line && line.words) || "").trim() || "♪" }))
      .filter((line, i, all) => !(line.words === "♪" && i === all.length - 1));
    return { synced, lines, provider: l.providerDisplayName || l.provider || "" };
  };
  const trackIdFromHref = (href) => {
    const text = String(href || "");
    const m = /\/track\/([A-Za-z0-9]+)/.exec(text) || /spotify(?::|%3A)track(?::|%3A)([A-Za-z0-9]+)/i.exec(text);
    return m ? m[1] : "";
  };
  const pathOf = (uri) => {
    const parts = (uri || "").split(":");
    if (parts[0] !== "spotify") throw fail("E_BAD_ARGS", "not a Spotify URI: " + uri);
    if (parts[1] === "collection" || (parts[1] === "user" && parts[parts.length - 1] === "collection")) return "/collection/tracks";
    if (!/^(playlist|album|artist|track|show|episode)$/.test(parts[1]) || !/^[A-Za-z0-9]+$/.test(parts[2] || "")) {
      throw fail("E_BAD_ARGS", "cannot open " + uri);
    }
    return "/" + parts[1] + "/" + parts[2];
  };
  const isCollection = (uri) => pathOf(uri) === "/collection/tracks";

  const clockMs = (text) => {
    if (!text) return 0;
    const parts = String(text).trim().split(":").map(Number);
    if (!parts.length || parts.some(isNaN)) return 0;
    return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  };

  // A range input's value for `value`, clamped and on its step.
  const quantize = (value, min, max, step) => {
    let v = Math.min(max, Math.max(min, value));
    if (step > 0) v = min + Math.round((v - min) / step) * step;
    v = Math.min(max, Math.max(min, v));
    return Math.round(v * 1e9) / 1e9;
  };
  const rangeOf = (input) => {
    const min = Number(input.min) || 0;
    const max = input.max === "" || input.max == null || isNaN(Number(input.max)) ? 100 : Number(input.max);
    const step = input.step === "any" ? 0 : input.step === "" || input.step == null ? 1 : Number(input.step) || 0;
    return { min, max, step };
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

  // The progress bar's time, in milliseconds: its clocks give the length
  // (the right one may count down, "-1:23", what is left), its slider the
  // share played (its unit may be ms, seconds or a fraction, so it is read
  // as a share of its range). Null when the bar shows nothing.
  const barTime = (positionText, durationText, slider) => {
    const pos = clockMs(positionText);
    const raw = String(durationText || "").trim();
    const dur = raw.startsWith("-") ? pos + clockMs(raw.slice(1)) : clockMs(raw);
    if (dur > 0) {
      const share = slider && slider.max > 0 ? Math.min(1, Math.max(0, slider.value / slider.max)) : null;
      return { positionMs: share === null ? pos : Math.round(share * dur), durationMs: dur };
    }
    if (slider && slider.max > 0) return { positionMs: Math.round(slider.value), durationMs: Math.round(slider.max) };
    return null;
  };

  // The position and length of what plays, from the page's media elements
  // and its progress bar (`bar`: { positionMs, durationMs } or null). The
  // page can hold more than one element at once (the next track preloading,
  // an ad's, an old one not yet dropped), so an element counts only when its
  // length is the bar's; one that plays is preferred, and of those the one
  // nearest the bar's position. With no element matching, the bar's own
  // numbers; with no bar, a playing element, else any.
  const pickMedia = (elements, bar) => {
    const known = elements.filter((m) => m && isFinite(m.duration) && m.duration > 0);
    if (bar && bar.durationMs > 0) {
      const same = known.filter((m) => Math.abs(m.duration * 1000 - bar.durationMs) <= 2000);
      const pool = same.some((m) => !m.paused) ? same.filter((m) => !m.paused) : same;
      if (!pool.length) return null;
      return pool.reduce((a, b) => (Math.abs(b.currentTime * 1000 - bar.positionMs) < Math.abs(a.currentTime * 1000 - bar.positionMs) ? b : a));
    }
    return known.find((e) => !e.paused) || known[0] || null;
  };
  const timeOf = (elements, bar) => {
    const m = pickMedia(elements, bar);
    if (m) return { positionMs: Math.round(m.currentTime * 1000), durationMs: Math.round(m.duration * 1000) };
    return bar && bar.durationMs > 0 ? { positionMs: bar.positionMs, durationMs: bar.durationMs } : null;
  };

  // The ad check: the page's marker, or its own controls saying "not now".
  const adFrom = ({ marker, metaTitle, hasTrack, nextDisabled, progressDisabled }) =>
    !!marker || /\badvertisement\b/i.test(metaTitle || "") || !!(hasTrack && nextDisabled && progressDisabled);

  const isDisabled = (el) => !!el && (el.disabled === true || (el.getAttribute && el.getAttribute("aria-disabled") === "true"));
  // The control `name`, usable now, or the reason it is not.
  const usable = (name, el) => {
    if (!el) throw fail("E_NOT_FOUND", "control " + name);
    if (isDisabled(el)) throw fail("E_DISABLED", "control " + name);
    return el;
  };

  // Presses `press` until `read()` equals `target`, at most `tries` presses,
  // each awaiting a visible change (no change means the page ignored it, so it
  // stops instead of pressing blind and overshooting).
  const settle = async ({ name, read, target, press, tries = 3, timeout = 1500, every = 50, sleep, now }) => {
    let current = read();
    for (let i = 0; current !== target; i++) {
      if (i >= tries) throw fail("E_TIMEOUT", name + " is " + JSON.stringify(current) + ", not " + JSON.stringify(target));
      const before = current;
      press();
      const end = now() + timeout;
      while (current === before && now() < end) {
        await sleep(every);
        current = read();
      }
      if (current === before) throw fail("E_TIMEOUT", name + " did not change from " + JSON.stringify(before));
    }
    return current;
  };

  // The persisted-query hashes: learned from live requests, else scanned from
  // the player's bundles. A miss is remembered with exponential backoff, one
  // scan runs at a time, and a bundle is downloaded once.
  const createHashCache = ({ now, listUrls, fetchText, ops = {}, scanned = new Set(), misses = new Map(), baseMs = 5000, maxMs = 300000 }) => {
    let inflight = null;
    const scan = () => {
      if (inflight) return inflight;
      inflight = (async () => {
        let urls = [];
        try {
          urls = listUrls().filter((u) => !scanned.has(u));
        } catch (_) {}
        let fetched = 0;
        await Promise.all(
          urls.map(async (url) => {
            try {
              const text = await fetchText(url);
              scanned.add(url);
              fetched++;
              for (const m of String(text).matchAll(HASH_RE)) if (!ops[m[1]]) ops[m[1]] = m[2];
            } catch (_) {} // left unscanned: tried again on the next scan
          }),
        );
        return fetched;
      })().finally(() => {
        inflight = null;
      });
      return inflight;
    };
    const hash = async (op) => {
      if (ops[op]) return ops[op];
      const miss = misses.get(op);
      if (miss && now() < miss.until) throw fail("E_UNKNOWN_QUERY", op);
      await scan();
      if (ops[op]) {
        misses.delete(op);
        return ops[op];
      }
      const count = (miss ? miss.count : 0) + 1;
      misses.set(op, { count, until: now() + Math.min(maxMs, baseMs * 2 ** (count - 1)) });
      throw fail("E_UNKNOWN_QUERY", op);
    };
    return {
      hash,
      scan,
      learn(op, sha) {
        ops[op] = sha;
        misses.delete(op);
      },
      forget(op) {
        delete ops[op];
      },
      ops,
      scanned,
      misses,
    };
  };

  // --- Normalizing what the queries answer ----------------------------------
  // Into the few shapes the app shows (src/ui/types.ts, src/spotify/model.rs):
  // items (playlists, albums, artists, shows) and tracks.

  const pickImage = (sources, prefer = 300) => {
    if (!sources || !sources.length) return "";
    const sorted = sources.filter((s) => s && s.url).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
    return (sorted.find((s) => (s.width || 0) >= prefer) || sorted[sorted.length - 1] || {}).url || "";
  };
  const imageOf = (data) => {
    if (!data) return "";
    const c = data.coverArt || data.images || data.visuals || data.avatar || (data.albumOfTrack && data.albumOfTrack.coverArt);
    if (c && c.sources) return pickImage(c.sources);
    if (c && c.items && c.items[0] && c.items[0].sources) return pickImage(c.items[0].sources);
    if (c && c.avatarImage && c.avatarImage.sources) return pickImage(c.avatarImage.sources);
    if (data.visuals && data.visuals.avatarImage && data.visuals.avatarImage.sources) return pickImage(data.visuals.avatarImage.sources);
    if (data.image && data.image.sources) return pickImage(data.image.sources);
    return "";
  };
  const artistNames = (artists) =>
    ((artists && artists.items) || [])
      .map((a) => (a.profile && a.profile.name) || a.name)
      .filter(Boolean)
      .join(", ");

  const item = (data) => {
    if (!data || !data.uri) return null;
    const kind = kindOf(data.uri);
    const owner = data.ownerV2 && data.ownerV2.data && data.ownerV2.data.name;
    let subtitle = "";
    if (kind === "playlist") subtitle = owner ? "Playlist · " + owner : "Playlist";
    else if (kind === "album") subtitle = [data.type ? data.type[0] + data.type.slice(1).toLowerCase() : "Album", artistNames(data.artists)].filter(Boolean).join(" · ");
    else if (kind === "artist") subtitle = "Artist";
    else if (kind === "show") subtitle = "Podcast · " + ((data.publisher && data.publisher.name) || "");
    else if (kind === "collection") subtitle = "Playlist";
    else if (kind === "track") subtitle = artistNames(data.artists);
    return { uri: data.uri, kind, name: data.name || (data.profile && data.profile.name) || "", subtitle, image: imageOf(data) };
  };

  const track = (data, uid) => {
    if (!data || !data.uri || kindOf(data.uri) !== "track") return null;
    const album = data.albumOfTrack || {};
    return {
      uri: data.uri,
      uid: uid || "",
      name: data.name || "",
      artists: artistNames(data.artists || data.firstArtist),
      album: album.name || "",
      albumUri: album.uri || "",
      image: imageOf(data.albumOfTrack || data),
      durationMs: (data.duration && data.duration.totalMilliseconds) || (data.trackDuration && data.trackDuration.totalMilliseconds) || 0,
      explicit: !!data.contentRating && data.contentRating.label === "EXPLICIT",
      playable: data.playability ? data.playability.playable !== false : true,
    };
  };
  const unwrap = (w) => (w && (w.data || (w.item && w.item.data) || (w.itemV2 && w.itemV2.data))) || w;

  // A Liked Songs entry: its URI is on the wrapper (`_uri`), or in its data.
  const likedTrack = (entry) => {
    const wrapper = entry && entry.track;
    const data = unwrap(wrapper) || {};
    const uidUri = entry && typeof entry.uid === "string" && entry.uid.startsWith("spotify:track:") ? entry.uid : "";
    const uri = data.uri || (wrapper && wrapper._uri) || (wrapper && wrapper.data && wrapper.data.uri) || uidUri;
    if (!uri) return null;
    return track(Object.assign({}, data, { uri }), (wrapper && wrapper._uri) || (entry && entry.uid) || uri);
  };
  const likedTracks = (items) => {
    const tracks = (items || []).map(likedTrack).filter(Boolean);
    if ((items || []).length && !tracks.length) throw fail("E_SHAPE", "likedSongs.tracks");
    return tracks;
  };

  // --- The bridge in a page ---------------------------------------------------

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

    // What outlives a re-injection: the learned headers and hashes, the media
    // elements seen, the page's fetch.
    let shared = win.__spotishShared;
    if (!shared || shared.v !== 1) {
      shared = {
        v: 1,
        headers: shared && shared.headers ? shared.headers : null,
        ops: (shared && shared.ops) || {},
        vars: (shared && shared.vars) || {},
        scanned: new Set(),
        misses: new Map(),
        media: [],
        everAd: false,
        fetch: null,
        onFetch: null,
        onPlay: null,
      };
      try {
        Object.defineProperty(win, "__spotishShared", { value: shared, configurable: true, enumerable: false, writable: true });
      } catch (_) {
        win.__spotishShared = shared;
      }
    }

    const post = (message) => {
      if (!alive) return;
      try {
        if (typeof win.spotishEvent === "function") win.spotishEvent(JSON.stringify(message));
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

    // --- Learning the player's requests --------------------------------------

    const KEEP = ["authorization", "client-token", "spotify-app-version", "app-platform", "accept-language"];
    const headerObject = (headers) => {
      const out = {};
      if (!headers) return out;
      if (typeof headers.forEach === "function" && !Array.isArray(headers)) headers.forEach((v, k) => (out[String(k).toLowerCase()] = v));
      else if (Array.isArray(headers)) headers.forEach(([k, v]) => (out[String(k).toLowerCase()] = v));
      else Object.keys(headers).forEach((k) => (out[k.toLowerCase()] = headers[k]));
      return out;
    };
    const hashes = createHashCache({
      now,
      ops: shared.ops,
      scanned: shared.scanned,
      misses: shared.misses,
      listUrls: () => {
        const urls = new Set();
        try {
          win.performance.getEntriesByType("resource").forEach((e) => /\.js(\?|$)/.test(e.name) && urls.add(e.name));
        } catch (_) {}
        doc.querySelectorAll("script[src]").forEach((s) => urls.add(s.src));
        return [...urls].filter((u) => {
          try {
            return BUNDLE_HOST.test(new URL(u, win.location.href).hostname);
          } catch (_) {
            return false;
          }
        });
      },
      fetchText: async (url) => {
        const response = await pageFetch.call(win, url);
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      },
    });
    const learn = (input, init) => {
      const request = win.Request && input instanceof win.Request ? input : null;
      const url = request ? request.url : input;
      if (!String(url).includes("/pathfinder/")) return;
      const headers = Object.assign(headerObject(request && request.headers), headerObject(init && init.headers));
      if (!headers.authorization) return;
      const kept = {};
      KEEP.forEach((k) => headers[k] && (kept[k] = headers[k]));
      const changed = !shared.headers || shared.headers.authorization !== kept.authorization;
      shared.headers = kept;
      if (changed) post(envelope("auth"));
      const body = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
      const hash = body && body.extensions && body.extensions.persistedQuery && body.extensions.persistedQuery.sha256Hash;
      if (body && body.operationName && hash) {
        hashes.learn(body.operationName, hash);
        if (body.variables) shared.vars[body.operationName] = body.variables;
      }
    };
    // One wrapper of the page's fetch, shared by reinstalls (each swaps its
    // hook); dispose() restores the page's own when nothing wrapped it since.
    if (!shared.fetch && typeof win.fetch === "function") {
      const original = win.fetch;
      shared.fetch = original;
      shared.fetchWrapper = function (input, init) {
        try {
          if (shared.onFetch) shared.onFetch(input, init);
        } catch (_) {}
        return original.apply(this, arguments);
      };
      win.fetch = shared.fetchWrapper;
    }
    const pageFetch = shared.fetch;
    shared.onFetch = learn;

    // The player may keep its media element out of the document: remember the
    // ones that play (read only; it plays as it would).
    const Media = win.HTMLMediaElement;
    if (Media && Media.prototype && typeof Media.prototype.play === "function" && !Media.prototype.play.__spotish) {
      const play = Media.prototype.play;
      const wrapped = function () {
        try {
          if (shared.onPlay) shared.onPlay(this);
        } catch (_) {}
        return play.apply(this, arguments);
      };
      wrapped.__spotish = true;
      shared.play = play;
      shared.playWrapper = wrapped;
      Media.prototype.play = wrapped;
    }
    shared.onPlay = (element) => {
      shared.media = [element].concat(shared.media.filter((m) => m !== element)).slice(0, 4);
    };
    // The progress bar's time now (see `barTime`).
    const currentBar = () => {
      const range = inBar(SEL.progress);
      return barTime(
        inBar(SEL.position) && inBar(SEL.position).textContent,
        inBar(SEL.duration) && inBar(SEL.duration).textContent,
        range && Number(range.max) > 0 ? { value: Number(range.value), max: Number(range.max) } : null,
      );
    };
    const allMedia = () => shared.media.concat([...doc.querySelectorAll("video, audio")]);
    // The media element of what plays: the one whose length is the bar's
    // (others may be the next track warming up, or an old one).
    const media = () => pickMedia(allMedia(), currentBar());

    // A GraphQL query of the player's, with its headers.
    // Samples a cover (Spotify's image hosts allow it) at 24 × 24 into a
    // palette, within a few seconds.
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

    const gql = async (op, variables) => {
      if (!shared.headers) await waitFor(() => shared.headers, 20000);
      if (!shared.headers) throw fail("E_NO_AUTH", "the web player has not signed its requests yet");
      const hash = await hashes.hash(op);
      let response;
      try {
        response = await pageFetch.call(win, "https://api-partner.spotify.com/pathfinder/v2/query", {
          method: "POST",
          headers: Object.assign({ "content-type": "application/json;charset=UTF-8", accept: "application/json" }, shared.headers),
          body: JSON.stringify({
            // What the player sends, with what the app asks for over it.
            variables: Object.assign({}, shared.vars[op] || {}, variables),
            operationName: op,
            extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
          }),
        });
      } catch (error) {
        throw fail("E_NETWORK", op + ": " + ((error && error.message) || error));
      }
      if (response.status === 401) throw fail("E_NO_AUTH", op + ": HTTP 401");
      if (!response.ok) throw fail("E_HTTP", op + ": HTTP " + response.status);
      const json = await response.json();
      const errors = (json && json.errors) || [];
      if (errors.some((e) => /PersistedQueryNotFound/i.test((e && e.message) || ""))) {
        hashes.forget(op);
        throw fail("E_UNKNOWN_QUERY", op + " (stale hash)");
      }
      if (errors.length && !json.data) throw fail("E_GRAPHQL", op + ": " + errors.map((e) => e.message).join("; "));
      if (!json || !json.data) {
        warn("[spotish] unexpected shape of " + op + ": no data");
        throw fail("E_SHAPE", op + ".data");
      }
      return json.data;
    };

    const api = {
      async library() {
        const op = "libraryV3";
        const data = await gql(op, {
          filters: [],
          order: null,
          textFilter: "",
          features: ["LIKED_SONGS", "YOUR_EPISODES", "PRERELEASES"],
          limit: 200,
          offset: 0,
          flatten: false,
          expandedFolders: [],
          folderUri: null,
          includeFoldersWhenFlattening: true,
        });
        const items = need(op, data, "me.libraryV3.items", warn)
          .map((entry) => {
            const d = entry && entry.item && entry.item.data;
            if (!d) return null;
            if (d.__typename === "PseudoPlaylist") {
              likedImage = imageOf(d) || likedImage;
              return { uri: d.uri || "spotify:collection:tracks", kind: "collection", name: d.name || "Liked Songs", subtitle: (d.count || 0) + " songs", image: imageOf(d) || LIKED_IMAGE };
            }
            return item(d);
          })
          .filter(Boolean);
        return { items };
      },

      async me() {
        const op = "profileAttributes";
        const data = await gql(op, {});
        const p = need(op, data, "me.profile", warn);
        const id = p.username || (kindOf(p.uri) === "user" ? idOf(p.uri) : "") || "";
        if (!id) {
          warn("[spotish] unexpected shape of " + op + ": no user id");
          throw fail("E_SHAPE", op + ".me.profile.username");
        }
        return { id, name: p.name || p.username || "", username: p.username || id, image: pickImage(p.avatar && p.avatar.sources, 64) };
      },

      async home() {
        const op = "home";
        const cookie = (name) => (String(doc.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)")) || [])[1] || "";
        const data = await gql(op, {
          includeHomeChapterVideoCards: false,
          homeEndUserIntegration: "INTEGRATION_WEB_PLAYER",
          includeEpisodeContentRatingsV2: false,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          sp_t: cookie("sp_t"),
          facet: "",
          sectionItemsLimit: 12,
        });
        const sections = need(op, data, "home.sectionContainer.sections.items", warn)
          .map((s) => ({
            title: (s.data && s.data.title && (s.data.title.transformedLabel || s.data.title.text)) || "",
            items: ((s.sectionItems && s.sectionItems.items) || []).map((i) => item(unwrap(i.content))).filter(Boolean),
          }))
          .filter((s) => s.title && s.items.length);
        return { greeting: (data.home.greeting && data.home.greeting.transformedLabel) || "", sections };
      },

      async search(term) {
        const op = "searchDesktop";
        const data = await gql(op, {
          searchTerm: String(term || ""),
          offset: 0,
          limit: 10,
          numberOfTopResults: 5,
          includeAudiobooks: false,
          includeArtistHasConcertsField: false,
          includePreReleases: true,
          includeAlbumPreReleases: false,
          includeLocalConcertsField: false,
          includeAuthors: false,
          includeEpisodeContentRatingsV2: false,
        });
        const s = need(op, data, "searchV2", warn);
        const items = (list) => ((list && list.items) || []).map((i) => item(unwrap(i))).filter(Boolean);
        return {
          tracks: ((s.tracksV2 && s.tracksV2.items) || []).map((i) => track(unwrap(i.item || i))).filter(Boolean),
          artists: items(s.artists),
          albums: items(s.albumsV2),
          playlists: items(s.playlists),
        };
      },

      async playlist(uri, offset = 0) {
        const op = "fetchPlaylist";
        const data = await gql(op, { uri, offset, limit: 100, enableWatchFeedEntrypoint: false });
        missingEntity(op, data.playlistV2, uri);
        const p = need(op, data, "playlistV2", warn);
        const entries = need(op, data, "playlistV2.content.items", warn);
        const tracks = entries.map((i) => track(unwrap(i.itemV2), i.uid)).filter(Boolean);
        const owner = (p.ownerV2 && p.ownerV2.data && p.ownerV2.data.name) || "";
        return {
          header: { uri, kind: "playlist", name: p.name || "", subtitle: owner + (p.content.totalCount ? " · " + p.content.totalCount + " songs" : ""), image: imageOf(p), description: (p.description || "").replace(/<[^>]+>/g, "") },
          tracks,
          releases: [],
          total: p.content.totalCount || tracks.length,
        };
      },

      async album(uri) {
        const op = "getAlbum";
        const data = await gql(op, { uri, locale: "", offset: 0, limit: 50 });
        missingEntity(op, data.albumUnion, uri);
        const a = need(op, data, "albumUnion", warn);
        const list = (a.tracksV2 && a.tracksV2.items) || (a.tracks && a.tracks.items);
        if (!list) {
          warn("[spotish] unexpected shape of " + op + ": missing albumUnion.tracksV2.items");
          throw fail("E_SHAPE", op + ".albumUnion.tracksV2.items");
        }
        const image = imageOf(a);
        const tracks = list
          .map((i) => {
            const t = track(i.track, i.uid);
            if (t) {
              t.album = a.name || "";
              t.albumUri = uri;
              t.image = t.image || image;
            }
            return t;
          })
          .filter(Boolean);
        const year = a.date && a.date.isoString ? a.date.isoString.slice(0, 4) : (a.date && a.date.year) || "";
        return {
          header: { uri, kind: "album", name: a.name || "", subtitle: [artistNames(a.artists), year, tracks.length + " songs"].filter(Boolean).join(" · "), image, description: "" },
          tracks,
          releases: [],
          total: (a.tracksV2 && a.tracksV2.totalCount) || tracks.length,
        };
      },

      async artist(uri) {
        const op = "queryArtistOverview";
        const data = await gql(op, { uri, locale: "", includePrerelease: true });
        missingEntity(op, data.artistUnion, uri);
        const a = need(op, data, "artistUnion", warn);
        need(op, data, "artistUnion.profile", warn);
        const d = a.discography || {};
        const tracks = ((d.topTracks && d.topTracks.items) || []).map((i) => track(i.track, i.uid)).filter(Boolean);
        const releases = ((d.popularReleasesAlbums && d.popularReleasesAlbums.items) || (d.albums && d.albums.items) || [])
          .map((r) => item((r.releases && r.releases.items && r.releases.items[0]) || r))
          .filter(Boolean);
        const listeners = a.stats && a.stats.monthlyListeners ? a.stats.monthlyListeners.toLocaleString() + " monthly listeners" : "";
        return {
          header: { uri, kind: "artist", name: a.profile.name || "", subtitle: listeners, image: imageOf(a.visuals) || pickImage(a.visuals && a.visuals.avatarImage && a.visuals.avatarImage.sources), description: "" },
          tracks,
          releases,
          total: tracks.length,
        };
      },

      async likedSongs(offset = 0) {
        const op = "fetchLibraryTracks";
        const data = await gql(op, { offset, limit: 100 });
        const t = need(op, data, "me.library.tracks", warn);
        const tracks = likedTracks(need(op, data, "me.library.tracks.items", warn));
        return {
          header: { uri: "spotify:collection:tracks", kind: "collection", name: "Liked Songs", subtitle: (t.totalCount || tracks.length) + " songs", image: likedImage || LIKED_IMAGE, description: "" },
          tracks,
          releases: [],
          total: t.totalCount || tracks.length,
        };
      },

      // A cover's colours, for the shaders: Spotify's extracted colour
      // (`hex`, its dark tone) and the cover's own palette (`palette`, up to
      // five, most telling first) sampled from the image. Best effort: empty
      // when unknown.
      async colors(imageUrl) {
        if (!imageUrl) return { hex: "", palette: [] };
        const [hex, palette] = await Promise.all([
          gql("fetchExtractedColors", { imageUris: [imageUrl] })
            .then((data) => {
              const c = data.extractedColors && data.extractedColors[0];
              return (c && ((c.colorDark && c.colorDark.hex) || (c.colorRaw && c.colorRaw.hex))) || "";
            })
            .catch((error) => {
              warn("[spotish] colors:", messageOf(error));
              return "";
            }),
          samplePalette(imageUrl).catch((error) => {
            warn("[spotish] palette:", messageOf(error));
            return [];
          }),
        ]);
        return { hex, palette: palette.length ? palette : hex ? [hex] : [] };
      },

      // A track's lyrics (see `lyricsOf`), as the web player's lyrics view
      // loads them; none (no lines) when Spotify has none for it.
      async lyrics(trackUri) {
        const id = idOf(trackUri);
        if (kindOf(trackUri) !== "track" || !id) return lyricsOf(null);
        if (!shared.headers) await waitFor(() => shared.headers, 20000);
        if (!shared.headers) throw fail("E_NO_AUTH", "the web player has not signed its requests yet");
        let response;
        try {
          response = await pageFetch.call(win, "https://spclient.wg.spotify.com/color-lyrics/v2/track/" + id + "?format=json&vocalRemoval=false&market=from_token", {
            headers: Object.assign({ accept: "application/json" }, shared.headers, { "app-platform": shared.headers["app-platform"] || "WebPlayer" }),
          });
        } catch (error) {
          throw fail("E_NETWORK", "lyrics: " + ((error && error.message) || error));
        }
        if (response.status === 404 || response.status === 204) return lyricsOf(null);
        if (response.status === 401) throw fail("E_NO_AUTH", "lyrics: HTTP 401");
        if (!response.ok) throw fail("E_HTTP", "lyrics: HTTP " + response.status);
        return lyricsOf(await response.json());
      },
    };

    // --- The player: its state -----------------------------------------------

    const q = (selector, scope) => (scope || doc).querySelector(selector);
    const bar = () => q(SEL.bar);
    const inBar = (selector) => q(selector, bar() || doc);

    let premiumWidgetSince = 0;
    const premiumNow = (ad) => {
      if (ad) shared.everAd = true; // Premium hears no ads
      if (shared.everAd) return false;
      if (q(SEL.login)) return null;
      const top = q(SEL.topBar);
      if (!top) return null;
      if (q(SEL.upgrade, top)) return false;
      if (!q(SEL.userWidget, top)) {
        premiumWidgetSince = 0;
        return null;
      }
      // Signed in with no upgrade button: Premium, once that holds a while.
      if (!premiumWidgetSince) premiumWidgetSince = now();
      return now() - premiumWidgetSince >= 5000 ? true : null;
    };

    const adNow = (meta, title) => {
      const next = inBar(SEL.next);
      const progress = inBar(SEL.progress);
      return adFrom({
        marker: inBar(SEL.adMarker),
        metaTitle: meta && meta.title,
        hasTrack: !!title,
        nextDisabled: !!next && isDisabled(next),
        progressDisabled: !progress || isDisabled(progress),
      });
    };

    const readRepeat = (el) => {
      const label = (el && el.getAttribute("aria-label")) || "";
      const checked = el && el.getAttribute("aria-checked");
      return checked === "mixed" || /disable repeat/i.test(label) ? "track" : checked === "true" ? "context" : "off";
    };
    const readMuted = () => {
      const mute = inBar(SEL.mute);
      return !!mute && /unmute/i.test(mute.getAttribute("aria-label") || "");
    };
    const readVolume = () => {
      const input = inBar(SEL.volume);
      if (!input) return 1;
      const { min, max } = rangeOf(input);
      return max > min ? Math.round(((Number(input.value) - min) / (max - min)) * 100) / 100 : 1;
    };
    const readLiked = () => {
      const like = inBar(SEL.like);
      return !!like && like.getAttribute("aria-checked") === "true";
    };
    // The picker's Liked Songs item, while the picker is open.
    const likedChoice = () => {
      const label = q(SEL.likedChoice);
      return label ? label.closest('[role="menuitemcheckbox"]') : null;
    };
    // The picker's Done button: the nearest one around its Liked Songs item.
    const pickerDone = (choice) => {
      for (let el = choice.parentNode; el && el.querySelectorAll; el = el.parentNode) {
        for (const b of el.querySelectorAll("button")) if (/^\s*done\s*$/i.test(b.textContent || "")) return b;
      }
      return null;
    };
    const readShuffle = () => {
      const el = inBar(SEL.shuffle);
      return !!el && el.getAttribute("aria-checked") === "true";
    };
    const readPlaying = () => {
      const m = media();
      if (m) return !m.paused;
      const button = inBar(SEL.playPause);
      return /pause/i.test((button && button.getAttribute("aria-label")) || "");
    };

    const playerState = () => {
      const meta = win.navigator && win.navigator.mediaSession && win.navigator.mediaSession.metadata;
      const playPause = inBar(SEL.playPause);
      const shuffle = inBar(SEL.shuffle);
      const titleLink = inBar(SEL.title);
      const contextLink = inBar(SEL.context);
      const next = inBar(SEL.next);
      const previous = inBar(SEL.previous);
      const title = (meta && meta.title) || (titleLink && titleLink.textContent) || "";
      const trackId = trackIdFromHref(titleLink && titleLink.getAttribute("href"));
      const ad = adNow(meta, title);
      // The bar's numbers, checked against the media elements, which are
      // finer but not all the one playing.
      const time = timeOf(allMedia(), currentBar()) || { positionMs: 0, durationMs: 0 };
      const positionMs = time.positionMs;
      const durationMs = time.durationMs;
      return {
        title,
        artist: (meta && meta.artist) || "",
        album: (meta && meta.album) || "",
        artwork: meta && meta.artwork && meta.artwork.length ? meta.artwork[meta.artwork.length - 1].src : "",
        trackUri: trackId ? "spotify:track:" + trackId : "",
        contextHref: contextLink ? contextLink.getAttribute("href") || "" : "",
        playing: readPlaying(),
        canPlay: !!playPause && !isDisabled(playPause),
        positionMs,
        durationMs,
        at: now(),
        shuffle: readShuffle(),
        shuffleAvailable: !!shuffle && !isDisabled(shuffle),
        repeat: readRepeat(inBar(SEL.repeat)),
        volume: readVolume(),
        muted: readMuted(),
        liked: readLiked(),
        canNext: !!next && !isDisabled(next) && !ad,
        canPrevious: !!previous && !isDisabled(previous) && !ad,
        ad,
        premium: premiumNow(ad),
      };
    };

    let lastPosted = null;
    let readyPosted = false;
    const tick = () => {
      if (!alive) return;
      try {
        if (!readyPosted) {
          if (!bar() || !shared.headers) return;
          readyPosted = true;
          post(envelope("ready"));
        }
        const s = playerState();
        if (shouldPost(lastPosted, s, s.at)) {
          lastPosted = s;
          post(envelope("state", { state: s }));
        }
      } catch (error) {
        warn("[spotish] state:", messageOf(error));
      }
    };
    const soon = (ms) => {
      const id = win.setTimeout(tick, ms);
      timers.timeouts.push(id);
      if (timers.timeouts.length > 32) timers.timeouts.shift();
    };

    // --- The player: its controls --------------------------------------------

    const press = (name, selector) => {
      usable(name, inBar(selector)).click();
    };
    const refuseDuringAd = (what) => {
      const meta = win.navigator && win.navigator.mediaSession && win.navigator.mediaSession.metadata;
      const titleLink = inBar(SEL.title);
      if (adNow(meta, (meta && meta.title) || (titleLink && titleLink.textContent) || "")) throw fail("E_AD", what + " is not available while an ad plays");
    };
    const settleOpts = (name, read, target, selector, tries) => ({ name, read, target, tries, press: () => press(name, selector), sleep, now });

    // React keeps a range's value itself: set it through the native setter so
    // the input event carries the new value.
    const writeRange = (input, value) => {
      const proto = win.HTMLInputElement && win.HTMLInputElement.prototype;
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) descriptor.set.call(input, String(value));
      else input.value = String(value);
      const fire = (Type, type) => {
        try {
          input.dispatchEvent(new Type(type, { bubbles: true }));
        } catch (_) {
          input.dispatchEvent(new win.Event(type, { bubbles: true }));
        }
      };
      fire(win.Event, "input");
      fire(win.Event, "change");
      fire(win.PointerEvent || win.MouseEvent || win.Event, "pointerup");
      fire(win.MouseEvent || win.Event, "mouseup");
    };
    // Writes `value` to the range `name`, and answers once the page shows it.
    const setRange = async (name, selector, value, confirm) => {
      const input = usable(name, inBar(selector));
      const { min, max, step } = rangeOf(input);
      const target = quantize(value, min, max, step);
      const tolerance = Math.max(step / 2, 1e-6);
      const shows = confirm || (() => Math.abs(Number(inBar(selector) ? inBar(selector).value : NaN) - target) <= tolerance);
      for (let attempt = 0; attempt < 2; attempt++) {
        writeRange(inBar(selector) || input, target);
        if (await waitFor(shows, 1200, 50)) return target;
      }
      throw fail("E_TIMEOUT", "control " + name + " did not take " + target);
    };

    const sameContext = (path) => {
      const href = playerState().contextHref.split(/[?#]/)[0];
      return !!href && (href === path || (path === "/collection/tracks" && href.startsWith("/collection")));
    };

    // Opens `uri`'s page and waits for proof that it (not the previous page)
    // rendered: the page's own `data-test-uri`, or a new action bar.
    // The play button of the page at `path`.
    const pagePlay = (path) => q(path.startsWith("/show/") ? SEL.showPlay : SEL.actionPlay);
    const openPage = async (uri) => {
      const path = pathOf(uri);
      const loc = win.location;
      const stale = loc.pathname === path ? null : pagePlay(path);
      if (loc.pathname !== path) {
        win.history.pushState({}, "", path);
        win.dispatchEvent(new win.PopStateEvent("popstate", { state: {} }));
      }
      const proven = await waitFor(() => {
        if (win.location.pathname !== path) return false;
        if (/^[A-Za-z0-9:._-]+$/.test(uri) && q('[data-test-uri="' + uri + '"]')) return true;
        if (path === "/collection/tracks" && q('[data-test-uri$=":collection"], [data-test-uri="spotify:collection:tracks"]')) return true;
        const button = pagePlay(path);
        return !!button && button !== stale && button.isConnected !== false;
      }, 15000);
      if (!proven) throw fail("E_TIMEOUT", "the page of " + uri + " did not render");
      return path;
    };

    const scroller = () => {
      const list = q(SEL.scroller[0]);
      const viewport = list && list.closest && list.closest("[data-overlayscrollbars-viewport], .main-view-container__scroll-node");
      return viewport || q(SEL.scroller[1]) || q(SEL.scroller[2]);
    };
    const rowFor = (id) => {
      for (const link of doc.querySelectorAll(SEL.row + ' a[href*="/track/' + id + '"]')) {
        if (trackIdFromHref(link.getAttribute("href")) === id) return link.closest(SEL.row);
      }
      return null;
    };
    // Rows are virtualized: scroll from the top until the track's row exists.
    const findRow = async (trackUri) => {
      const id = idOf(trackUri);
      if (kindOf(trackUri) !== "track" || !/^[A-Za-z0-9]+$/.test(id)) throw fail("E_BAD_ARGS", "not a track: " + trackUri);
      await waitFor(() => q(SEL.row), 15000);
      let row = rowFor(id);
      const view = scroller();
      if (row || !view) return row;
      view.scrollTop = 0;
      for (let i = 0; !row && i < 400; i++) {
        await sleep(120);
        row = rowFor(id);
        if (row) break;
        const before = view.scrollTop;
        view.scrollTop = before + Math.max(200, (view.clientHeight || 600) * 0.8);
        if (view.scrollTop === before) {
          await sleep(200);
          row = rowFor(id);
          break; // the bottom
        }
      }
      return row;
    };
    const confirmTrack = async (trackUri) => !!(await waitFor(() => playerState().trackUri === trackUri || playerState().ad, 6000, 150));

    const controls = {
      toggle: async () => {
        press("playpause", SEL.playPause);
        return null;
      },
      play: () => settle(settleOpts("playing", readPlaying, true, SEL.playPause, 2)),
      pause: () => settle(settleOpts("playing", readPlaying, false, SEL.playPause, 2)),
      next: async () => {
        refuseDuringAd("next");
        press("next", SEL.next);
        return null;
      },
      previous: async () => {
        refuseDuringAd("previous");
        press("previous", SEL.previous);
        return null;
      },
      seek: async (ms) => {
        const target = Number(ms);
        if (!isFinite(target) || target < 0) throw fail("E_BAD_ARGS", "seek to " + ms);
        refuseDuringAd("seek");
        const input = usable("seek", inBar(SEL.progress));
        const state = playerState();
        // The input's unit: milliseconds, seconds, or a fraction of the track.
        const max = rangeOf(input).max;
        const scale = state.durationMs > 0 && Math.abs(max - state.durationMs) / state.durationMs > 0.02 ? max / state.durationMs : 1;
        const wanted = Math.min(target, state.durationMs || target);
        const confirm = () => Math.abs(playerState().positionMs - wanted) <= 2000;
        await setRange("seek", SEL.progress, wanted * scale, confirm);
        const after = playerState();
        return { positionMs: after.positionMs, at: after.at };
      },
      setVolume: async (v) => {
        const level = Number(v);
        if (!isFinite(level)) throw fail("E_BAD_ARGS", "volume " + v);
        const input = usable("volume", inBar(SEL.volume));
        const { min, max } = rangeOf(input);
        await setRange("volume", SEL.volume, min + Math.min(1, Math.max(0, level)) * (max - min));
        return { volume: readVolume() };
      },
      setShuffle: (on) => settle(settleOpts("shuffle", readShuffle, !!on, SEL.shuffle, 2)),
      setRepeat: async (mode) => {
        if (!/^(off|context|track)$/.test(mode)) throw fail("E_BAD_ARGS", "repeat " + mode);
        return settle(settleOpts("repeat", () => readRepeat(inBar(SEL.repeat)), mode, SEL.repeat, 3));
      },
      // The like button adds a track to Liked Songs. On a liked track it
      // opens the "Add to playlist" picker instead: Liked Songs is unchecked
      // there and the picker closed with Done.
      setLiked: async (on) => {
        refuseDuringAd("setLiked");
        const target = !!on;
        if (readLiked() === target) return target;
        press("like", SEL.like);
        const choice = await waitFor(() => (readLiked() === target ? "settled" : likedChoice()), 2000, 50);
        if (choice && choice !== "settled") {
          if ((choice.getAttribute("aria-checked") === "true") !== target) choice.click();
          const done = await waitFor(() => pickerDone(choice), 2000, 50);
          usable("like picker's Done", done).click();
        }
        if (!(await waitFor(() => readLiked() === target, 3000, 50))) throw fail("E_TIMEOUT", "liked did not change to " + target);
        return target;
      },
      setMuted: (on) => settle(settleOpts("muted", readMuted, !!on, SEL.mute, 2)),

      // Plays a playlist, album, artist or Liked Songs from its start, or from
      // the track `trackUri` of it.
      async playContext(uri, trackUri) {
        if (typeof uri !== "string") throw fail("E_BAD_ARGS", "playContext needs a URI");
        if (trackUri != null && typeof trackUri !== "string") throw fail("E_BAD_ARGS", "playContext takes a track URI or null, not " + JSON.stringify(trackUri));
        refuseDuringAd("playContext");
        const path = await openPage(uri);
        if (!trackUri) {
          const button = usable("play-button", await waitFor(() => pagePlay(path), 10000));
          if (/pause/i.test(button.getAttribute("aria-label") || "")) return { confirmed: true }; // already playing it
          button.click();
          const ok = await waitFor(() => /pause/i.test((pagePlay(path) && pagePlay(path).getAttribute("aria-label")) || "") || playerState().ad, 6000, 150);
          return { confirmed: !!ok };
        }
        const current = playerState();
        if (current.trackUri === trackUri && current.playing && sameContext(path)) return { confirmed: true };
        const row = await findRow(trackUri);
        if (!row) throw fail("E_NOT_FOUND", "track " + trackUri + " on " + uri);
        if (row.scrollIntoView) row.scrollIntoView({ block: "center" });
        await sleep(50);
        const button = q(SEL.rowPlay, row);
        if (button && /^pause/i.test(button.getAttribute("aria-label") || "")) return { confirmed: true };
        if (button) usable("row play", button).click();
        else row.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true }));
        return { confirmed: await confirmTrack(trackUri) };
      },

      // Plays one track on its own page (its radio follows it). A track that
      // already plays goes on; a paused one resumes.
      async playTrack(uri) {
        if (kindOf(uri) !== "track") throw fail("E_BAD_ARGS", "not a track: " + uri);
        refuseDuringAd("playTrack");
        const current = playerState();
        if (current.trackUri === uri) {
          if (!current.playing) await controls.play();
          return { confirmed: true };
        }
        await openPage(uri);
        const button = usable("play-button", await waitFor(() => q(SEL.actionPlay), 10000));
        if (!/pause/i.test(button.getAttribute("aria-label") || "")) button.click();
        return { confirmed: await confirmTrack(uri) };
      },
    };

    const methods = Object.assign({}, api, controls, { state: async () => playerState() });

    const surface = {
      protocol: PROTOCOL,
      revision: REVISION,
      // The engine calls these with Runtime.evaluate: the plain JSON value, or
      // a rejection with Error("E_CODE: message").
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
        if (shared.onFetch === learn) shared.onFetch = null;
        // Give the page back its own fetch and media play, unless something
        // wrapped ours since (then ours stays, hookless).
        if (shared.fetchWrapper && win.fetch === shared.fetchWrapper) {
          win.fetch = shared.fetch;
          shared.fetch = null;
          shared.fetchWrapper = null;
        }
        const proto = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
        if (proto && shared.playWrapper && proto.play === shared.playWrapper) {
          proto.play = shared.play;
          shared.play = null;
          shared.playWrapper = null;
        }
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
    const existing = win.__spotish;
    if (existing) {
      if (typeof existing.revision === "number" && existing.revision > REVISION) return existing;
      try {
        if (typeof existing.dispose === "function") existing.dispose();
      } catch (_) {}
    }
    const bridge = createBridge(win, options);
    try {
      Object.defineProperty(win, "__spotish", { value: bridge, configurable: true, enumerable: false, writable: true });
    } catch (_) {
      win.__spotish = bridge;
    }
    return bridge;
  };

  const exported = {
    PROTOCOL,
    REVISION,
    SEL,
    fail,
    codeOf,
    messageOf,
    envelope,
    toError,
    need,
    trackIdFromHref,
    pathOf,
    isCollection,
    quantize,
    rangeOf,
    stateKey,
    shouldPost,
    timeOf,
    pickMedia,
    barTime,
    adFrom,
    isDisabled,
    usable,
    settle,
    createHashCache,
    paletteOf,
    lyricsOf,
    item,
    track,
    likedTrack,
    likedTracks,
    createBridge,
    install,
  };

  if (typeof root.window === "undefined" && typeof module === "object" && module && module.exports) {
    module.exports = exported; // node tests
  } else {
    install(root);
  }
})(typeof window !== "undefined" ? window : globalThis);
