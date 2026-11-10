// Node tests of the bridge (no npm): `node --test src/bridge/tests/`.
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

// --- A fake player bar ------------------------------------------------------

function toggleButton(testid, attrs) {
  const b = h("button", Object.assign({ "data-testid": testid, "aria-checked": "false" }, attrs));
  b.onclick = () => b.setAttribute("aria-checked", b.getAttribute("aria-checked") === "true" ? "false" : "true");
  return b;
}
function repeatButton() {
  const b = h("button", { "data-testid": "control-button-repeat", "aria-checked": "false", "aria-label": "Enable repeat" });
  const cycle = [
    ["false", "Enable repeat"],
    ["true", "Enable repeat one"],
    ["mixed", "Disable repeat"],
  ];
  let i = 0;
  b.onclick = () => {
    i = (i + 1) % 3;
    b.setAttribute("aria-checked", cycle[i][0]);
    b.setAttribute("aria-label", cycle[i][1]);
  };
  return b;
}
// The widget's like button: on a track not liked it adds it; on a liked one
// it opens an "Add to playlist" picker (appended to `body`), where Liked
// Songs is unchecked and Done applies it.
function likeButton(body) {
  const b = h("button", { "aria-checked": "false", "aria-label": "Add to Liked Songs" });
  const set = (on) => {
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.setAttribute("aria-label", on ? "Add to playlist" : "Add to Liked Songs");
  };
  b.onclick = () => {
    if (b.getAttribute("aria-checked") !== "true") return set(true);
    const choice = h(
      "button",
      { role: "menuitemcheckbox", "aria-checked": "true" },
      h("div", { role: "group", "aria-labelledby": "listrow-title-spotify:collection:tracks" }),
    );
    choice.onclick = () => choice.setAttribute("aria-checked", choice.getAttribute("aria-checked") === "true" ? "false" : "true");
    const cancel = h("button", {});
    cancel.textContent = "Cancel";
    const done = h("button", {});
    done.textContent = "Done";
    const picker = h("div", { role: "dialog" }, h("div", {}, choice), h("div", {}, cancel, done));
    const close = () => picker.remove();
    cancel.onclick = close;
    done.onclick = () => {
      set(choice.getAttribute("aria-checked") === "true");
      close();
    };
    body().append(picker);
  };
  return b;
}
function range(testid, attrs, value) {
  const input = h("input", Object.assign({ type: "range" }, attrs));
  input.value = String(value);
  return h("div", { "data-testid": testid }, input);
}
function playerPage({ ad = false } = {}) {
  const next = h("button", { "data-testid": "control-button-skip-forward" });
  const prev = h("button", { "data-testid": "control-button-skip-back" });
  const play = h("button", { "data-testid": "control-button-playpause", "aria-label": "Play" });
  play.onclick = () => play.setAttribute("aria-label", /pause/i.test(play.getAttribute("aria-label")) ? "Play" : "Pause");
  const mute = h("button", { "data-testid": "volume-bar-toggle-mute-button", "aria-label": "Mute" });
  mute.onclick = () => mute.setAttribute("aria-label", mute.getAttribute("aria-label") === "Mute" ? "Unmute" : "Mute");
  const widget = h(
    "div",
    { "data-testid": "now-playing-widget-v2" },
    h("div", { "data-testid": "context-item-info-title" }, h("a", { href: "/track/abc123" })),
    h("a", { href: "/playlist/pl1" }),
    likeButton(() => body),
    ad ? h("div", { "data-testid": "context-item-info-ad-subtitle" }) : [],
  );
  widget.querySelector('[data-testid="context-item-info-title"] a').textContent = "Song";
  const progress = range("playback-progressbar", { min: "0", max: "200000", step: "1000" }, 1000);
  const volume = range("volume-bar", { min: "0", max: "1", step: "0.1" }, 0.5);
  const barEl = h(
    "footer",
    { "data-testid": "now-playing-bar" },
    widget,
    play,
    next,
    prev,
    toggleButton("control-button-shuffle"),
    repeatButton(),
    progress,
    volume,
    mute,
  );
  const body = h("body", {}, barEl);
  return { body, bar: barEl, next, prev, play, mute, progress: progress.children[0], volume: volume.children[0], like: widget.querySelector("button[aria-checked]") };
}
function bridgeFor(page) {
  const win = fakeWindow(page.body);
  const bridge = B.install(win, options(win));
  return { win, bridge };
}

// --- Envelope and errors ----------------------------------------------------

// The code a call rejects with, or "OK".
const codeOfCall = async (bridge, name, args) => {
  try {
    await bridge.call(name, args);
    return "OK";
  } catch (e) {
    assert.ok(e instanceof Error);
    assert.match(e.message, /^E_[A-Z_]+: /);
    return B.codeOf(e);
  }
};

test("messages carry v:1 and calls resolve plain values or throw E_ codes", async () => {
  assert.deepEqual(B.envelope("ready"), { v: 1, type: "ready" });
  assert.deepEqual(B.envelope("state", { state: { a: 1 } }), { v: 1, type: "state", state: { a: 1 } });
  assert.equal(B.toError(B.fail("E_AD", "seek")).message, "E_AD: seek");
  assert.equal(B.toError(new Error("boom")).message, "E_INTERNAL: boom");
  assert.equal(B.toError("text").message, "E_INTERNAL: text");
  const { bridge } = bridgeFor(playerPage());
  assert.equal(await bridge.call("toggle", []), null, "plain value, not an envelope");
  assert.equal(await bridge.call("setShuffle", [true]), true);
  assert.equal(await codeOfCall(bridge, "nope", []), "E_UNKNOWN_CALL");
});

test("need throws E_SHAPE with the op and path, and warns", () => {
  const warnings = [];
  assert.equal(B.need("home", { home: { a: [1] } }, "home.a", (w) => warnings.push(w))[0], 1);
  assert.throws(() => B.need("home", { home: {} }, "home.sectionContainer.sections.items", (w) => warnings.push(w)), /^Error: E_SHAPE: home\.home\.sectionContainer\.sections\.items$/);
  assert.match(warnings[0], /home/);
});

// --- Pure helpers -----------------------------------------------------------

test("ad and disabled guards", () => {
  assert.equal(B.adFrom({ marker: {} }), true);
  assert.equal(B.adFrom({ metaTitle: "Advertisement" }), true);
  assert.equal(B.adFrom({ hasTrack: true, nextDisabled: true, progressDisabled: true }), true);
  assert.equal(B.adFrom({ hasTrack: true, nextDisabled: true, progressDisabled: false }), false); // end of a context
  assert.equal(B.adFrom({ hasTrack: false, nextDisabled: true, progressDisabled: true }), false); // nothing loaded
  assert.throws(() => B.usable("next", null), /^Error: E_NOT_FOUND: control next$/);
  const off = h("button", {});
  off.disabled = true;
  assert.throws(() => B.usable("next", off), /^Error: E_DISABLED: control next$/);
  assert.throws(() => B.usable("next", h("button", { "aria-disabled": "true" })), /^Error: E_DISABLED/);
});

test("quantize respects min, max and step", () => {
  assert.equal(B.quantize(0.437, 0, 1, 0.1), 0.4);
  assert.equal(B.quantize(1.7, 0, 1, 0.1), 1);
  assert.equal(B.quantize(12345, 0, 200000, 1000), 12000);
  assert.equal(B.quantize(0.437, 0, 1, 0), 0.437);
});

test("trackIdFromHref and pathOf", () => {
  assert.equal(B.trackIdFromHref("/track/abc123?si=x"), "abc123");
  assert.equal(B.trackIdFromHref("/album/x?highlight=spotify:track:def456"), "def456");
  assert.equal(B.trackIdFromHref("/album/x"), "");
  assert.equal(B.pathOf("spotify:user:bob:collection"), "/collection/tracks");
  assert.equal(B.pathOf("spotify:album:A1"), "/album/A1");
  assert.throws(() => B.pathOf("spotify:album:../x"), /E_BAD_ARGS/);
});

test("state posts on change, on a seek, and a heartbeat at most once a second", () => {
  const s = (positionMs, at, extra) => Object.assign({ title: "a", playing: true, positionMs, at }, extra);
  const last = s(1000, 0);
  assert.equal(B.shouldPost(null, last, 0), true);
  assert.equal(B.shouldPost(last, s(1250, 250), 250), false);
  assert.equal(B.shouldPost(last, s(2000, 1000), 1000), true); // heartbeat
  assert.equal(B.shouldPost(last, s(60000, 250), 250), true); // seek
  assert.equal(B.shouldPost(last, s(1250, 250, { title: "b" }), 250), true);
  const paused = s(1000, 0, { playing: false });
  assert.equal(B.shouldPost(paused, s(1000, 5000, { playing: false }), 5000), false);
});

// --- Idempotent setters -----------------------------------------------------

test("settle presses until the state matches, bounded", async () => {
  let t = 0;
  const env = { sleep: async (ms) => void (t += ms), now: () => t };
  let on = false;
  let presses = 0;
  const flip = () => {
    presses++;
    on = !on;
  };
  assert.equal(await B.settle({ name: "shuffle", read: () => on, target: true, press: flip, ...env }), true);
  assert.equal(presses, 1);
  assert.equal(await B.settle({ name: "shuffle", read: () => on, target: true, press: flip, ...env }), true);
  assert.equal(presses, 1, "no press when already there");

  const modes = ["off", "context", "track"];
  let i = 0;
  const cycle = () => (i = (i + 1) % 3);
  assert.equal(await B.settle({ name: "repeat", read: () => modes[i], target: "track", press: cycle, ...env }), "track");
  assert.equal(await B.settle({ name: "repeat", read: () => modes[i], target: "context", press: cycle, ...env }), "context");

  // A page that ignores the press: one press, then E_TIMEOUT (no blind re-press).
  let ignored = 0;
  await rejects(B.settle({ name: "liked", read: () => false, target: true, press: () => ignored++, ...env }), "E_TIMEOUT");
  assert.equal(ignored, 1);
  // A control that throws (missing, disabled) passes its error through.
  await rejects(B.settle({ name: "liked", read: () => false, target: true, press: () => B.usable("like", null), ...env }), "E_NOT_FOUND");
});

// --- Hash cache -------------------------------------------------------------

test("hash cache: one scan in flight, new bundles only, misses back off", async () => {
  let t = 0;
  let urls = ["a.js", "b.js"];
  const fetched = [];
  const bodies = { "a.js": '"home","query","' + "a".repeat(64) + '"', "b.js": "", "c.js": '"later","query","' + "c".repeat(64) + '"' };
  const cache = B.createHashCache({
    now: () => t,
    listUrls: () => urls,
    fetchText: async (u) => {
      fetched.push(u);
      return bodies[u];
    },
  });
  const [x, y] = await Promise.all([cache.hash("home"), cache.hash("home")]);
  assert.equal(x, "a".repeat(64));
  assert.equal(y, x);
  assert.deepEqual(fetched, ["a.js", "b.js"], "one scan for both");

  await rejects(cache.hash("later"), "E_UNKNOWN_QUERY");
  assert.deepEqual(fetched, ["a.js", "b.js"], "no re-download of scanned bundles");
  urls = ["a.js", "b.js", "c.js"];
  await rejects(cache.hash("later"), "E_UNKNOWN_QUERY"); // still backing off
  assert.equal(fetched.length, 2);
  t += 5000;
  assert.equal(await cache.hash("later"), "c".repeat(64));
  assert.deepEqual(fetched, ["a.js", "b.js", "c.js"]);

  await rejects(cache.hash("nope"), "E_UNKNOWN_QUERY");
  t += 5000;
  await rejects(cache.hash("nope"), "E_UNKNOWN_QUERY");
  assert.equal(cache.misses.get("nope").count, 2);
  assert.equal(cache.misses.get("nope").until, t + 10000, "doubles");
  cache.learn("nope", "d".repeat(64));
  assert.equal(await cache.hash("nope"), "d".repeat(64));
  assert.equal(cache.misses.has("nope"), false);
});

// --- Liked Songs ------------------------------------------------------------

test("liked songs map from _uri, data.uri or uid; empty mapping is E_SHAPE", () => {
  const data = { name: "S", artists: { items: [{ profile: { name: "A" } }] } };
  assert.equal(B.likedTrack({ track: { _uri: "spotify:track:1", data } }).uri, "spotify:track:1");
  assert.equal(B.likedTrack({ track: { data: Object.assign({ uri: "spotify:track:2" }, data) } }).uri, "spotify:track:2");
  assert.equal(B.likedTrack({ uid: "spotify:track:3", track: { data } }).uri, "spotify:track:3");
  assert.equal(B.likedTrack({ uid: "zz", track: { data } }), null);
  assert.equal(B.likedTracks([]).length, 0);
  assert.throws(() => B.likedTracks([{ track: { data } }]), /^Error: E_SHAPE: likedSongs\.tracks$/);
  assert.equal(data.uri, undefined, "the page's data is not mutated");
});

// --- The bridge in a fake page ---------------------------------------------

test("install: top frame only, idempotent, replaces and disposes", () => {
  const page = playerPage();
  const win = fakeWindow(page.body);
  const frame = fakeWindow(h("body", {}));
  frame.top = {};
  assert.equal(B.install(frame, options(frame)), null);
  assert.equal(frame.__ytmfast, undefined);

  const pageFetch = win.fetch;
  const first = B.install(win, { now: () => win.clock.t });
  try {
    assert.equal(win.intervals.size, 1);
    assert.notEqual(win.fetch, pageFetch, "fetch is wrapped");
    const second = B.install(win, { now: () => win.clock.t });
    assert.notEqual(first, second);
    assert.equal(win.__ytmfast, second);
    assert.equal(win.intervals.size, 1, "the first bridge's timer is cleared");
    assert.notEqual(win.fetch, pageFetch);
    // One layer: the replaced wrapper wraps the page's own fetch, not the old wrapper.
    second.dispose();
    assert.equal(win.intervals.size, 0);
    assert.equal(win.fetch, pageFetch, "dispose gives the page its fetch back");
    assert.equal(typeof second.query, "undefined", "no GraphQL pass-through");
  } finally {
    win.intervals.forEach((id) => win.clearInterval(id));
  }
});

test("ready waits for the bar and auth; state carries at and premium null", async () => {
  const page = playerPage();
  const { win, bridge } = bridgeFor(page);
  bridge.tick();
  assert.equal(win.posted.length, 0, "no auth yet");
  await win.fetch("https://api-partner.spotify.com/pathfinder/v2/query", { headers: { Authorization: "Bearer x" }, body: "{}" });
  bridge.tick();
  assert.deepEqual(win.posted[0], { v: 1, type: "auth" });
  assert.deepEqual(win.posted[1], { v: 1, type: "ready" });
  const state = win.posted[2];
  assert.equal(state.v, 1);
  assert.equal(state.type, "state");
  assert.equal(state.state.trackUri, "spotify:track:abc123");
  assert.equal(state.state.premium, null);
  assert.equal(state.state.at, win.clock.t);
  assert.equal("signedIn" in state.state, false);
  bridge.tick();
  assert.equal(win.posted.length, 3, "nothing changed, nothing posted");
  await win.fetch("https://api-partner.spotify.com/pathfinder/v2/query", { headers: { Authorization: "Bearer x" }, body: "{}" });
  assert.equal(win.posted.length, 3, "same token: no auth");
  await win.fetch("https://api-partner.spotify.com/pathfinder/v2/query", { headers: { Authorization: "Bearer y" }, body: "{}" });
  assert.deepEqual(win.posted[3], { v: 1, type: "auth" });
});

test("controls refuse during ads and when missing or disabled", async () => {
  const adPage = playerPage({ ad: true });
  const { bridge } = bridgeFor(adPage);
  const before = adPage.progress.value;
  for (const [name, args] of [["seek", [5000]], ["next", []], ["previous", []], ["setLiked", [true]], ["playTrack", ["spotify:track:zz"]], ["playContext", ["spotify:album:x", null]]]) {
    assert.equal(await codeOfCall(bridge, name, args), "E_AD", name);
  }
  assert.equal(adPage.progress.value, before, "the ad's position is untouched");
  assert.equal(adPage.next.clicks, 0);
  assert.equal(adPage.like.clicks, 0);
  assert.equal(adPage.mute.clicks, 0, "never mutes");
  // Pausing an ad is the page's own control: allowed.
  assert.equal(await codeOfCall(bridge, "toggle", []), "OK");

  const page = playerPage();
  const second = bridgeFor(page).bridge;
  page.next.disabled = true;
  assert.equal(await codeOfCall(second, "next", []), "E_DISABLED");
  page.prev.remove();
  assert.equal(await codeOfCall(second, "previous", []), "E_NOT_FOUND");
  assert.equal(await codeOfCall(second, "query", ["home", {}]), "E_UNKNOWN_CALL");
  assert.equal(await codeOfCall(second, "playContext", ["spotify:album:x", 3]), "E_BAD_ARGS");
});

test("setters settle against the page and ranges read back on their step", async () => {
  const page = playerPage();
  const { bridge } = bridgeFor(page);
  assert.equal(await bridge.setShuffle(true), true);
  assert.equal(await bridge.setShuffle(true), true);
  assert.equal(page.bar.querySelector('[data-testid="control-button-shuffle"]').clicks, 1);
  assert.equal(await bridge.setRepeat("track"), "track");
  assert.equal(await bridge.setRepeat("off"), "off");
  await rejects(bridge.setRepeat("all"), "E_BAD_ARGS");
  assert.equal(await bridge.setMuted(true), true);
  assert.equal(await bridge.setMuted(true), true);
  assert.equal(page.mute.clicks, 1);
  assert.equal(await bridge.setLiked(true), true);
  assert.equal(await bridge.setLiked(true), true);
  assert.equal(page.like.clicks, 1);
  assert.equal(await bridge.setLiked(false), false, "unliked through the picker");
  assert.equal(page.like.getAttribute("aria-checked"), "false");
  assert.equal(page.body.querySelector('[role="dialog"]'), null, "the picker closed");
  assert.equal(await bridge.setLiked(true), true);
  assert.equal(await bridge.play(), true);
  assert.equal(await bridge.play(), true);
  assert.equal(page.play.clicks, 1);

  assert.deepEqual(await bridge.setVolume(0.437), { volume: 0.4 });
  assert.equal(page.volume.value, "0.4");
  const seek = await bridge.seek(12345);
  assert.equal(page.progress.value, "12000");
  assert.equal(seek.positionMs, 12000);

  // A range the page will not take is reported, not claimed.
  Object.defineProperty(page.volume, "value", { get: () => "0.5", set: () => {} });
  await rejects(bridge.setVolume(0.9), "E_TIMEOUT");
});

test("an unknown persisted query is E_UNKNOWN_QUERY; shape misses are E_SHAPE", async () => {
  const page = playerPage();
  const { win, bridge } = bridgeFor(page);
  await win.fetch("https://api-partner.spotify.com/pathfinder/v2/query", {
    headers: { authorization: "Bearer x" },
    body: JSON.stringify({ operationName: "home", extensions: { persistedQuery: { sha256Hash: "f".repeat(64) } } }),
  });
  await rejects(bridge.likedSongs(), "E_UNKNOWN_QUERY");
  await rejects(bridge.home(), "E_SHAPE"); // the fake fetch answers { data: {} }
  assert.ok(win.warnings.some((w) => /home/.test(w)));
});

test("hot swap: dispose, delete, install again posts ready again", async () => {
  const page = playerPage();
  const { win, bridge } = bridgeFor(page);
  await win.fetch("https://api-partner.spotify.com/pathfinder/v2/query", { headers: { Authorization: "Bearer x" }, body: "{}" });
  bridge.tick();
  assert.equal(win.posted.filter((m) => m.type === "ready").length, 1);
  // What the engine evaluates before the new source.
  try {
    win.__ytmfast && win.__ytmfast.dispose && win.__ytmfast.dispose();
  } catch (e) {}
  delete win.__ytmfast;
  assert.equal(win.__ytmfast, undefined);
  assert.equal(await codeOfCall(bridge, "toggle", []), "E_DISPOSED");
  bridge.tick();
  const next = B.install(win, options(win));
  assert.equal(win.__ytmfast, next);
  next.tick();
  assert.equal(win.posted.filter((m) => m.type === "ready").length, 2, "ready again (auth carried over)");
  // The new bridge learns through a fresh wrapper.
  await win.fetch("https://api-partner.spotify.com/pathfinder/v2/query", { headers: { Authorization: "Bearer z" }, body: "{}" });
  assert.deepEqual(win.posted[win.posted.length - 1], { v: 1, type: "auth" });
});

// --- Playing by identity ------------------------------------------------------

function trackRow(id, onPlay) {
  const button = h("button", { "data-testid": "play-button", "aria-label": "Play " + id });
  button.onclick = onPlay;
  return { row: h("div", { "data-testid": "tracklist-row" }, h("a", { href: "/track/" + id }), button), button };
}
function mainView(uri, rows) {
  return h(
    "main",
    { "data-test-uri": uri },
    h("div", { "data-testid": "action-bar-row" }, h("button", { "data-testid": "play-button", "aria-label": "Play" })),
    rows.map((r) => r.row),
  );
}

test("playContext waits for the new page and plays the row linking the track", async () => {
  const page = playerPage();
  const titleLink = page.bar.querySelector('[data-testid="context-item-info-title"] a');
  const stale = trackRow("T1", () => assert.fail("pressed the previous page's row"));
  page.body.append(mainView("spotify:playlist:old", [stale]));
  const win = fakeWindow(page.body);
  win.location.pathname = "/playlist/old";
  let fresh;
  win.onDispatch = (event) => {
    assert.equal(event.type, "popstate");
    // The new page renders a little later, like React's route change.
    setTimeout(() => {
      page.body.querySelector("main").remove();
      fresh = trackRow("T1", () => titleLink.setAttribute("href", "/track/T1"));
      page.body.append(mainView("spotify:playlist:new", [trackRow("T0", () => {}), fresh]));
    }, 5);
  };
  const opts = options(win);
  opts.sleep = (ms) => {
    win.clock.t += ms;
    return new Promise((r) => setTimeout(r, 1));
  };
  const bridge = B.install(win, opts);
  const answer = await bridge.playContext("spotify:playlist:new", "spotify:track:T1");
  assert.deepEqual(answer, { confirmed: true });
  assert.equal(fresh.button.clicks, 1);
  assert.equal(stale.button.clicks, 0);
  assert.equal(win.location.pathname, "/playlist/new");
});

test("playContext plays a podcast from its newest episode", async () => {
  const page = playerPage();
  const win = fakeWindow(page.body);
  let newest;
  let older;
  win.onDispatch = () => {
    // A show's page: an action bar with no play button, then its episodes.
    setTimeout(() => {
      const episode = (i) => {
        const button = h("button", { "data-testid": "play-button", "aria-label": "Play EP" + i });
        button.onclick = () => button.setAttribute("aria-label", "Pause EP" + i);
        return { row: h("div", { "data-testid": "episode-" + i }, button), button };
      };
      newest = episode(0);
      older = episode(1);
      page.body.append(
        h(
          "main",
          {},
          h("div", { "data-testid": "action-bar-row" }, h("button", { "data-testid": "more-button" })),
          h("div", { "data-testid": "show-all-episode-list" }, newest.row, older.row),
        ),
      );
    }, 5);
  };
  const opts = options(win);
  opts.sleep = (ms) => {
    win.clock.t += ms;
    return new Promise((r) => setTimeout(r, 1));
  };
  const bridge = B.install(win, opts);
  assert.deepEqual(await bridge.playContext("spotify:show:pod", null), { confirmed: true });
  assert.equal(win.location.pathname, "/show/pod");
  assert.equal(newest.button.clicks, 1);
  assert.equal(older.button.clicks, 0);
});

test("playTrack on the playing track does not pause it", async () => {
  const page = playerPage(); // its bar plays spotify:track:abc123
  const { win, bridge } = bridgeFor(page);
  page.play.setAttribute("aria-label", "Pause");
  assert.deepEqual(await bridge.playTrack("spotify:track:abc123"), { confirmed: true });
  assert.equal(page.play.clicks, 0);
  assert.equal(win.location.pathname, "/", "no navigation");
  page.play.setAttribute("aria-label", "Play"); // paused: resumes
  await bridge.playTrack("spotify:track:abc123");
  assert.equal(page.play.clicks, 1);
  assert.equal(page.play.getAttribute("aria-label"), "Pause");
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
  fill(300, 220, 40, 40); // a red field
  fill(200, 20, 20, 24); // dark ground
  fill(60, 40, 90, 220); // a blue accent
  fill(10, 222, 42, 41); // almost the red again
  fill(30, 0, 0, 0, 0); // transparent: ignored
  const palette = B.paletteOf(px, 5);
  assert.equal(palette[0], "#dc2828");
  assert.ok(palette.includes("#285adc"));
  assert.ok(palette.length <= 5);
  // No two picked colours are near each other.
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (let i = 0; i < palette.length; i++)
    for (let j = i + 1; j < palette.length; j++) {
      const [a, b] = [rgb(palette[i]), rgb(palette[j])];
      assert.ok((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 >= 40 * 40);
    }
  assert.deepEqual(B.paletteOf([0, 0, 0, 0], 5), []);
});

// --- Which time is the playing track's ------------------------------------

test("the bar's time reads its clocks, a countdown and its slider as a share", () => {
  assert.deepEqual(B.barTime("1:00", "3:20", null), { positionMs: 60000, durationMs: 200000 });
  assert.deepEqual(B.barTime("1:00", "-2:20", null), { positionMs: 60000, durationMs: 200000 });
  // A slider in seconds is read as a share of its range, not as ms.
  assert.deepEqual(B.barTime("1:00", "3:20", { value: 100, max: 200 }), { positionMs: 100000, durationMs: 200000 });
  assert.deepEqual(B.barTime("", "", { value: 5000, max: 200000 }), { positionMs: 5000, durationMs: 200000 });
  assert.equal(B.barTime("", "", null), null);
});

test("the time comes from the element that is the bar's track, not another one", () => {
  const playing = { duration: 200, currentTime: 61, paused: false };
  const preloading = { duration: 95, currentTime: 2, paused: false }; // the next track, warming up
  const old = { duration: 180, currentTime: 179, paused: true };
  const bar = { positionMs: 60000, durationMs: 200000 };
  // Whatever order the page lists them in.
  assert.deepEqual(B.timeOf([preloading, old, playing], bar), { positionMs: 61000, durationMs: 200000 });
  assert.deepEqual(B.timeOf([old, playing, preloading], bar), { positionMs: 61000, durationMs: 200000 });
  // None is the bar's track: the bar's own numbers.
  assert.deepEqual(B.timeOf([preloading, old], bar), bar);
  // No bar: a playing element.
  assert.deepEqual(B.timeOf([old, playing], null), { positionMs: 61000, durationMs: 200000 });
});

test("lyricsOf reads timed and plain lines, and none", () => {
  const timed = B.lyricsOf({
    lyrics: {
      syncType: "LINE_SYNCED",
      providerDisplayName: "Musixmatch",
      lines: [
        { startTimeMs: "1200", words: "First line" },
        { startTimeMs: "4800", words: "♪" },
        { startTimeMs: "9100", words: " Second line " },
        { startTimeMs: "12000", words: "" },
      ],
    },
  });
  assert.deepEqual(timed, {
    synced: true,
    provider: "Musixmatch",
    lines: [
      { startMs: 1200, words: "First line" },
      { startMs: 4800, words: "♪" },
      { startMs: 9100, words: "Second line" },
    ],
  });
  const plain = B.lyricsOf({ lyrics: { syncType: "UNSYNCED", provider: "lyricfind", lines: [{ startTimeMs: "0", words: "Only words" }] } });
  assert.deepEqual(plain, { synced: false, provider: "lyricfind", lines: [{ startMs: 0, words: "Only words" }] });
  assert.deepEqual(B.lyricsOf(null), { synced: false, lines: [], provider: "" });
});
