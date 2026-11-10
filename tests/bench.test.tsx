// Performance scenarios on a library as large as a real one (`demo: "rich"`:
// covers everywhere, 8 rows on Home, playlists of 60). They measure, they do
// not check, so they run only when asked:
//
//   YTMFAST_BENCH=1 nsh test --target macos --fps -v tests/bench.test.tsx
//
// (or `--target linux`: the platform follows the machine's.)
// Each scenario logs a `bench:` mark before its per-second perf lines.
import os from "os";
import process from "process";
import { open, test as plainTest } from "nsh/test";

const test = process.env.YTMFAST_BENCH === "1" ? plainTest : plainTest.skip;

async function start() {
  const app = await open("../App.tsx", {
    platform: os.platform() === "linux" ? "linux" : "macos", width: 1280, height: 800,
    storage: { "firstRun:done": "1" },
    host: { params: { backend: "demo", demo: "rich" } },
  });
  await app.waitFor("Good evening, Ada");
  await app.press("role:button[Morning Static]");
  await app.waitFor("Soft starts for slow mornings.");
  await app.press("role:button[Slow River, The Quiet Fields]");
  await app.waitFor("id:player >> role:button[Pause]");
  return app;
}

function mark(name: string) {
  console.log(`bench: ${name}`);
}

test("bench 1: playing, idle on Home", async () => {
  const app = await start();
  await app.press("role:button[Home]");
  await app.waitFor("Good evening, Ada");
  await app.wait(1500);
  mark("idle");
  await app.wait(4000);
});

test("bench 2: scroll Home far down and back", async () => {
  const app = await start();
  await app.press("role:button[Home]");
  await app.waitFor("Good evening, Ada");
  await app.wait(1500);
  mark("home-scroll");
  for (let i = 0; i < 6; i++) await app.scroll("Made for you", 300);
  for (let i = 0; i < 6; i++) await app.scroll("Made for you", -300);
});

test("bench 3: scroll a long playlist under the player", async () => {
  const app = await start();
  await app.wait(1500);
  mark("playlist-scroll");
  for (let i = 0; i < 6; i++) await app.scroll("Soft starts for slow mornings.", 400);
  for (let i = 0; i < 6; i++) await app.scroll("Soft starts for slow mornings.", -400);
});

test("bench 4: switch pages from the sidebar", async () => {
  const app = await start();
  await app.wait(1500);
  mark("switch");
  for (let i = 0; i < 2; i++) {
    for (const page of ["Home", "Late Trains", "Harbor Walk", "Liked Songs", "Quiet Machines", "Little Streets"]) {
      await app.press(`role:button[${page}]`);
      await app.wait(400);
    }
  }
});

test("bench 5: open and close Now Playing", async () => {
  const app = await start();
  await app.wait(1500);
  mark("now-playing");
  for (let i = 0; i < 4; i++) {
    await app.press("id:player >> id:open-now-playing");
    await app.wait(1200);
    await app.press("role:button[Close Now Playing]");
    await app.wait(900);
  }
});

test("bench 6: visit many pages from the sidebar, then rest", async () => {
  const app = await start();
  await app.wait(1500);
  mark("visit-many");
  const pages = ["Late Trains", "Harbor Walk", "Liked Songs", "Quiet Machines", "Little Streets", "Distant Echoes", "Amber Gardens", "Copper Rooms", "Golden Windows", "Northern Islands"];
  for (let i = 0; i < 2; i++) {
    for (const page of pages) {
      await app.press(`role:button[${page}] >> nth=0`);
      await app.wait(700);
    }
  }
  mark("rest");
  await app.wait(5000);
}, 120000);
