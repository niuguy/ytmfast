// The app's flows on the demo backend (`host.params.backend: "demo"`), with
// the steps a user takes: navigation, playback, the free tier, signing out,
// the phone's drawer and the keyboard.
import { expect, open, test } from "nsh/test";

/** What a launch after the first one has in its storage. */
const LAUNCHED = { "firstRun:done": "1" };

function desktop(params: Record<string, string | number | boolean> = {}, storage: Record<string, string> = LAUNCHED) {
  return open("../App.tsx", {
    platform: "linux",
    width: 1280,
    height: 800,
    storage,
    host: { params: { backend: "demo", ...params } },
  });
}

function phone(params: Record<string, string | number | boolean> = {}) {
  return open("../App.tsx", {
    platform: "web",
    width: 390,
    height: 844,
    storage: LAUNCHED,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    host: { params: { backend: "demo", ...params } },
  });
}

test("Back, Forward and the library move through the stack", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  expect(app.enabled("role:button[Go back]")).toBe(false);
  expect(app.enabled("role:button[Go forward]")).toBe(false);

  await app.press("role:button[Morning Static]");
  await app.waitFor("Soft starts for slow mornings.");
  // Opening the same page again does not push it twice.
  await app.press("role:button[Morning Static]");
  await app.press("role:button[Late Trains]");
  await app.waitFor("For the last ride home.");

  await app.press("role:button[Go back]");
  await app.waitFor("Soft starts for slow mornings.");
  await app.press("role:button[Go back]");
  await app.waitFor("Good evening, Ada");
  expect(app.enabled("role:button[Go back]")).toBe(false);

  await app.press("role:button[Go forward]");
  await app.waitFor("Soft starts for slow mornings.");
  await app.press("role:button[Go forward]");
  await app.waitFor("For the last ride home.");
  expect(app.enabled("role:button[Go forward]")).toBe(false);

  // A root (Search) replaces the stack, and clears Forward. On a desktop
  // the header's Search opens a field; the return key opens the page.
  await app.press("role:button[Search]");
  await app.type("label:Search YouTube Music", "kites");
  await app.submit("label:Search YouTube Music");
  await app.waitFor("role:button[Kites, The Quiet Fields]");
  expect(app.enabled("role:button[Go back]")).toBe(false);
  expect(app.enabled("role:button[Go forward]")).toBe(false);
});

test("the stack keeps the last few pages, so visiting many doesn't hold them all", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  for (const page of ["Morning Static", "Late Trains", "Harbor Walk", "Liked Songs", "Paper Lanterns", "Neon Orchard"]) {
    await app.press(`role:button[${page}]`);
    await app.wait(100);
  }
  await app.waitFor("Neon Orchard");
  // Past the push's slide, the oldest are let go: four pages over Home.
  await app.wait(800);
  for (const page of ["Paper Lanterns", "Liked Songs", "Harbor Walk"]) {
    await app.press("role:button[Go back]");
    await app.waitFor(`id:page-${page === "Liked Songs" ? "ytm:collection:LM" : page === "Paper Lanterns" ? "ytm:album:paperlanterns" : "ytm:playlist:harborwalk"}`);
  }
  await app.press("role:button[Go back]");
  await app.waitFor("Good evening, Ada");
  expect(app.enabled("role:button[Go back]")).toBe(false);
});

test("a collection's track plays, and the player bar shows it", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.waitFor("role:button[Slow River, The Quiet Fields]");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  expect(app.texts()).toContain("Slow River");

  // The position moves on between the player's messages.
  await app.wait(1500);
  expect(app.texts().some((t) => t === "0:01" || t === "0:02")).toBe(true);

  await app.press("id:player >> role:button[Pause]");
  await app.waitFor("id:player >> role:button[Play]");
});

test("a free account plays the song it picks", async () => {
  const app = await desktop({ premium: false });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Morning Static]");
  await app.waitFor("role:button[Slow River, The Quiet Fields]");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  expect(app.texts()).toContain("Slow River");
  // Premium is a crown in the header, named by its label.
  await app.waitFor("role:button[Premium]");
});

test("signing out forgets the account's cache and goes back to Home", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Harbor Walk]");
  await app.waitFor("Salt air and long coats.");
  await app.waitUntil(() => Object.keys(app.storage()).some((k) => k.startsWith("cache:v1:demo-ada:")));

  // Log out asks first; cancelling keeps the account.
  const asked: (string | null | undefined)[] = [];
  app.onDialog((dialog) => {
    asked.push(dialog.title);
    return "Cancel";
  });
  await app.press("role:button[User menu: Ada]");
  await app.press("role:menuitem[Log out]");
  await app.waitUntil(() => asked.length === 1);
  expect(asked).toEqual(["Sign out of YouTube Music?"]);
  await app.wait(300);
  expect(app.shows("role:button[User menu: Ada]")).toBe(true);

  app.onDialog(() => "Log out");
  await app.press("role:button[User menu: Ada]");
  await app.press("role:menuitem[Log out]");
  await app.waitFor("role:button[Log in] >> nth=0");
  await app.waitFor("Good evening, there");
  expect(app.enabled("role:button[Go back]")).toBe(false);
  expect(app.enabled("role:button[Go forward]")).toBe(false);
  await app.waitUntil(() => !Object.keys(app.storage()).some((k) => k.startsWith("cache:v1:demo-ada:")));

  // Another account signs in: it sees its own home, not the last one's.
  await app.press("role:button[Log in] >> nth=0");
  await app.waitFor("Good evening, Sam");
  expect(app.texts()).not.toContain("Good evening, Ada");
});

test("signed out, playing asks to log in", async () => {
  const app = await desktop({ signedIn: false });
  await app.waitFor("role:button[Log in] >> nth=0");
  await app.press("role:button[Neon Orchard, 2023 · Mira Vale]");
  await app.waitFor("role:button[Orchard, Mira Vale]");
  await app.press("role:button[Orchard, Mira Vale]");
  await app.waitFor("Sign in to YouTube Music to play music.");
});

test("space plays and pauses, but types in the search field", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.waitFor("role:button[Kites, The Quiet Fields]");
  await app.press("role:button[Kites, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");

  await app.press("role:button[Search]");
  await app.type("label:Search YouTube Music", "glass bees");
  expect(app.value("label:Search YouTube Music")).toBe("glass bees");
  expect(app.shows("id:player >> role:button[Pause]")).toBe(true);
  await app.submit("label:Search YouTube Music");
  await app.waitFor("role:button[Glass Bees, Mira Vale]");
});

test("an ad shows its own title and a link to Premium; seeking is off", async () => {
  const app = await desktop({ ad: true });
  await app.waitFor("Fieldnote Coffee");
  expect(app.texts()).toContain("Advertisement");
  expect(app.shows("role:link[Get Premium]")).toBe(true);
  expect(app.enabled("role:button[Next]")).toBe(false);
});

test("the first launch shows the disclaimer once", async () => {
  const app = await desktop({}, {});
  await app.waitFor("YTMFast is an unofficial client and is not affiliated with YouTube or Google.");
  expect(app.shows("role:button[Get YouTube Music Premium]")).toBe(true);
  await app.press("role:button[Start listening]");
  await app.waitFor("YTMFast is an unofficial client and is not affiliated with YouTube or Google.", { state: "gone" });
  expect(app.storage()["firstRun:done"]).toBe("1");
});

test("on a phone, the library drawer has the whole sidebar", async () => {
  const app = await phone();
  await app.waitFor("Good evening, Ada");
  await app.press("role:tab[Library]");
  await app.waitFor("role:button[User menu: Ada]");
  expect(app.shows("Late Trains")).toBe(true);

  await app.press("role:button[Late Trains]");
  await app.waitFor("For the last ride home.");
  // The drawer closed, and the page has Back.
  expect(app.shows("role:button[User menu: Ada]")).toBe(false);
  await app.press("role:button[Go back]");
  await app.waitFor("Good evening, Ada");
});

test("the sidebar folds away and comes back", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  expect(app.texts()).toContain("Liked Songs");
  await app.press("role:button[Collapse sidebar]");
  await app.waitFor("role:button[Expand sidebar]");
  expect(app.texts()).not.toContain("Liked Songs");
  // The account comes up to the header, with its menu.
  await app.press("role:button[User menu: Ada]");
  await app.waitFor("role:menuitem[Log out]");
  await app.press("role:button[Expand sidebar]");
  await app.waitFor("Liked Songs");
});

test("the lyrics follow the song, play from a line, and say when there are none", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.waitFor("role:button[Slow River, The Quiet Fields]");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");

  // The bar's Lyrics opens Now Playing on them.
  await app.press("id:player >> role:button[Lyrics]");
  await app.waitFor("id:lyrics >> role:button[Paper boats along the river]");
  expect(app.texts()).toContain("Lyrics provided by Demo");

  // A line pressed plays from it (the demo's lines are 4 s apart), and is
  // the line sung now.
  await app.press("id:lyrics >> role:button[Carry me across the harbor]");
  await app.waitFor("0:28");
  expect(app.shows("id:lyric-now >> text:Carry me across the harbor")).toBe(true);
  // The next starts on time.
  await app.wait(4200);
  expect(app.shows("id:lyric-now >> text:I will never be the same")).toBe(true);

  // Hidden, they stay hidden until shown again.
  await app.press("role:button[Hide lyrics]");
  await app.waitFor("role:button[Show lyrics]");
  expect(app.shows("id:lyrics")).toBe(false);
  await app.press("role:button[Show lyrics]");

  // Low Harbor's songs have none.
  await app.press("role:button[Close Now Playing]");
  await app.press("role:button[Go back]");
  await app.press("role:button[Salt Lines, 2019 · Low Harbor]");
  await app.waitFor("role:button[Breakwater, Low Harbor]");
  await app.press("role:button[Breakwater, Low Harbor]");
  await app.waitFor("id:player >> role:button[Pause]");
  await app.press("id:player >> role:button[Lyrics]");
  await app.waitFor("No lyrics for this song.");
});

test("narrow, a song with no lyrics keeps its cover in their place", async () => {
  // Covers come with the rich demo; the plain one has none to show.
  const app = await desktop({ premium: true, demo: "rich" });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Salt Lines, 2019 · Low Harbor]");
  await app.waitFor("role:button[Breakwater, Low Harbor]");
  await app.press("role:button[Breakwater, Low Harbor]");
  await app.waitFor("id:player >> role:button[Pause]");
  await app.press("id:player >> role:button[Lyrics]");
  await app.waitFor("No lyrics for this song.");
  // Wide, the cover is beside the lyrics already: not twice.
  expect(app.shows("id:lyrics-cover")).toBe(false);
  await app.setViewport(600, 900);
  await app.waitFor("id:lyrics-cover");
  expect(app.texts()).toContain("No lyrics for this song.");
});

test("? shows the keyboard shortcuts", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.keyboard.press("shift+/");
  await app.waitFor("id:shortcuts");
  expect(app.texts()).toContain("Keyboard Shortcuts");
  expect(app.texts()).toContain("Go to the sidebar");
});

test("Ctrl and the arrows move between regions; the arrows and Return work inside them", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  // The sidebar: Home, Explore and History, then on down into the library,
  // whose first entry is Liked Songs.
  await app.keyboard.press("ctrl+left");
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  await app.waitFor("role:header[Liked Songs]");
  // The page: its play button first, then down into its tracks; Return
  // plays the first.
  await app.keyboard.press("ctrl+right");
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  await app.waitFor("id:player >> role:button[Pause]");
});

test("the music light switches to Current, and Random picks another for each track", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");

  // Current is last on the menu: scrolled to first.
  await app.press("id:player >> role:button[Light: Dots]");
  await app.scroll("role:menuitemradio[01 Dots]", 224);
  await app.press("role:menuitemradio[14 Current]");
  await app.waitFor("id:player >> role:button[Light: Current]");
  expect(app.storage()["visual:effect"]).toBe("current");

  // Opened again, the menu starts at the effect in use: Current is there
  // without a scroll.
  await app.press("id:player >> role:button[Light: Current]");
  await app.press("role:menuitemradio[14 Current]");
  await app.waitFor("id:player >> role:button[Light: Current]");

  // Random picks another effect at once, and says which.
  const shown = () => ["Spectrum", "Ribbons", "Bars", "Aurora", "Wave", "Halo", "Mountains", "Mesh", "Particles", "Strings", "Orb", "Dots", "Grid", "Current"]
    .find((name) => app.shows(`id:player >> role:button[Light: Random (${name})]`));
  await app.press("id:player >> role:button[Light: Current]");
  await app.press("role:menuitemradio[Random]");
  await app.waitUntil(() => shown() !== undefined);
  const first = shown();
  expect(first).not.toBe("Current");
  expect(app.storage()["visual:effect"]).toBe("random");

  // The next track brings another.
  await app.press("id:player >> role:button[Next]");
  await app.waitUntil(() => shown() !== undefined && shown() !== first);
});

// --- The queue, radio, the library, discovery -----------------------------------

test("a song's menu plays it next; the queue shows it, takes songs out and jumps to one", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.press("role:button[First Light, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  // Play next from the row's "…" menu.
  await app.press("role:button[More for Kites]");
  await app.press("role:menuitem[Play next]");
  await app.waitFor("Will play next.");
  await app.press("id:player >> role:button[Queue]");
  await app.waitFor("id:queue-panel >> text:Next up");
  // Kites is next, right after what plays.
  const shown = app.texts();
  expect(shown[shown.indexOf("Next up") + 1]).toBe("Kites");
  // Out of the queue.
  await app.press("id:queue-panel >> role:button[Remove Window Seat from the queue]");
  await app.waitFor("id:queue-panel >> text:Window Seat", { state: "gone" });
  // Pressed, a song plays.
  await app.press("id:queue-panel >> role:button[Hollow Pines, The Quiet Fields]");
  await app.waitFor("id:player >> text:Hollow Pines");
});

test("a card's own menu starts its radio", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.rightClick("role:button[Neon Orchard, 2023 · Mira Vale]");
  await app.press("role:menuitem[Start radio]");
  await app.waitFor("id:player >> text:Orchard");
});

test("Explore lists new releases and moods; a mood opens its own page", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Explore]");
  await app.waitFor("role:header[Explore]");
  expect(app.texts()).toContain("New albums & singles");
  await app.press("role:button[Chill]");
  await app.waitFor("role:header[Chill]");
  expect(app.texts()).toContain("Chill mixes");
});

test("Home's chips filter it, one at a time", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Relax]");
  await app.waitFor("Relax mixes");
  await app.press("role:button[Relax]");
  await app.waitFor("Made for you");
});

test("Search narrows to songs, a page at a time, and suggests queries", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Search]");
  await app.type("label:Search YouTube Music", "the");
  await app.submit("label:Search YouTube Music");
  await app.waitFor("role:button[All]");
  await app.press("role:button[Songs]");
  await app.waitFor("role:button[Show more]");
  const before = app.texts().filter((t) => t === "The Quiet Fields").length;
  await app.press("role:button[Show more]");
  await app.waitUntil(() => app.texts().filter((t) => t === "The Quiet Fields").length > before);
  // What YouTube Music would suggest for it.
  await app.clear("label:Search YouTube Music");
  await app.type("label:Search YouTube Music", "low");
  await app.waitFor("role:button[Search for low harbor]");
});

test("an album is saved to the library, and an artist subscribed to, from their pages", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Neon Orchard, 2023 · Mira Vale]");
  await app.press("role:button[Save to library]");
  await app.waitFor("Saved to your library.");
  await app.waitFor("role:button[Remove from library]");
  await app.press("role:button[Home]");
  await app.press("role:button[Low Harbor, Artist]");
  await app.waitFor("role:button[Unsubscribe]");
});

test("a new playlist is made from a song's menu; a playlist of one's own takes songs out", async () => {
  const app = await desktop();
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.rightClick("role:button[Kites, The Quiet Fields]");
  await app.press("role:menuitem[Add to playlist]");
  await app.press("role:menuitem[New playlist…]");
  await app.waitFor("id:new-playlist");
  await app.type("label:Playlist name", "Night Drive");
  await app.press("role:button[Create]");
  await app.waitFor("Playlist made.");
  await app.waitFor("Night Drive");
  // Road Trip is the account's own: a song comes out of it.
  await app.press("role:button[Road Trip]");
  await app.waitFor("role:header[Road Trip]");
  await app.waitFor("role:button[Slow River, The Quiet Fields]");
  await app.rightClick("role:button[Slow River, The Quiet Fields]");
  await app.press("role:menuitem[Remove from this playlist]");
  await app.waitFor("Removed from the playlist.");
  await app.waitFor("role:button[Slow River, The Quiet Fields]", { state: "gone" });
});

test("History lists what was played; the player's menu dislikes the song", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[History]");
  await app.waitFor("role:header[History]");
  await app.press("role:button[Play]");
  await app.waitFor("id:player >> role:button[Pause]");
  await app.press("id:player >> role:button[More for Kites]");
  await app.press("role:menuitem[Dislike]");
  await app.waitFor("Disliked: you'll hear less like this.");
});

test("the mini player floats in its own window, plays from there and switches back", async () => {
  const app = await desktop({ premium: true });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Paper Lanterns]");
  await app.press("role:button[First Light, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  // The bar's button switches: the mini player opens, the main window hides.
  await app.press("id:player >> role:button[Mini player]");
  await app.waitFor("id:mini-player >> text:First Light");
  expect(app.window("mini-player").state()?.visible).toBe(true);
  expect(app.window("main").state()?.visible).toBe(false);
  // Its controls drive the one player.
  await app.press("id:mini-player >> role:button[Pause]");
  await app.waitFor("id:mini-player >> role:button[Play]");
  await app.press("id:mini-player >> role:button[Next]");
  await app.waitFor("id:mini-player >> text:First Light", { state: "gone" });
  // Back: the main window shows again, and the mini player closes.
  await app.press("id:mini-player >> role:button[Back to the full player]");
  await app.waitFor("id:mini-player", { state: "gone" });
  expect(app.window("main").state()?.visible).toBe(true);
  expect(app.window("mini-player").state()).toBe(null);
  // The shortcut switches too; closing it some other way brings the main
  // window back.
  await app.keyboard.press("mod+shift+m");
  await app.waitFor("id:mini-player");
  await app.window("mini-player").pressClose();
  await app.waitFor("id:mini-player", { state: "gone" });
  expect(app.window("main").state()?.visible).toBe(true);
});
