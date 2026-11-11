// A long playlist a page at a time: the list grows page by page, stops at
// its cap or its end, and a failed page fails the whole.
import { expect, test } from "nsh/test";
import type { Collection, Track, TrackPage } from "../backend/types";
import { followPages, PAGES_MOST } from "./pages";

function tracks(from: number, count: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({ uri: `ytm:track:t${from + i}`, name: `T${from + i}` }) as Track);
}

function list(count: number, continuation: string, total = count): Collection {
  return {
    header: { uri: "ytm:playlist:p", kind: "playlist", name: "P", subtitle: "", image: "", description: "" },
    tracks: tracks(0, count),
    releases: [],
    total,
    continuation,
  };
}

/** Pages of `size` up to `end` tracks, continuing as `@<offset>`. */
function pager(size: number, end: number) {
  const asked: [string, number][] = [];
  const more = async (continuation: string, offset: number): Promise<TrackPage> => {
    asked.push([continuation, offset]);
    const to = Math.min(offset + size, end);
    return { tracks: tracks(offset, to - offset), continuation: to < end ? `@${to}` : "" };
  };
  return { asked, more };
}

test("the list grows page by page to its end, and comes back whole", async () => {
  const { asked, more } = pager(2, 7);
  const seen: number[] = [];
  const whole = await followPages(list(3, "@3", 7), 1000, more, (l) => seen.push(l.tracks.length));
  expect(whole.tracks.map((t) => t.name)).toEqual(["T0", "T1", "T2", "T3", "T4", "T5", "T6"]);
  expect(whole.continuation).toBe("");
  expect(whole.total).toBe(7);
  expect(asked).toEqual([["@3", 3], ["@5", 5]]);
  expect(seen).toEqual([3, 5]);
});

test("a list on one page asks for nothing more", async () => {
  const { asked, more } = pager(2, 3);
  const seen: number[] = [];
  const whole = await followPages(list(3, ""), 1000, more, (l) => seen.push(l.tracks.length));
  expect(whole.tracks.length).toBe(3);
  expect(asked).toEqual([]);
  expect(seen).toEqual([]);
});

test("it stops at the cap, at the most pages, and at an empty page", async () => {
  const capped = pager(100, 5000);
  expect((await followPages(list(100, "@100"), 1000, capped.more, () => {})).tracks.length).toBe(1000);
  const paged = pager(10, 5000);
  expect((await followPages(list(10, "@10"), 5000, paged.more, () => {})).tracks.length).toBe(10 + PAGES_MOST * 10);
  const empty = async (): Promise<TrackPage> => ({ tracks: [], continuation: "@again" });
  expect((await followPages(list(3, "@3"), 1000, empty, () => {})).tracks.length).toBe(3);
});

test("a failed page fails the whole", async () => {
  const broken = async (): Promise<TrackPage> => {
    throw new Error("E_NETWORK: gone");
  };
  let error = "";
  await followPages(list(3, "@3"), 1000, broken, () => {}).catch((e) => (error = String(e)));
  expect(error).toContain("E_NETWORK");
});
