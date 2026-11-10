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
  // The sidebar: Home, then on down into the library, whose first entry is
  // Liked Songs.
  await app.keyboard.press("ctrl+left");
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
