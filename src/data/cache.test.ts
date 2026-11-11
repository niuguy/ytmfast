// The cache layer on its own: hits and misses, one account never seeing
// another's, a new epoch loading again, the size cap, and a failed load
// keeping what was cached. Driven by plain signals, without the app.
import { expect, test } from "nsh/test";
import { signal, Storage } from "nsh";
import { CAPACITY, type CacheSource, cachedQuery, cacheSize, clearAccount, clearMemory, hydrate, readCache, writeCache } from "./cache";

function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > end) throw new Error("timed out");
    await tick(5);
  }
}

test("a query shows the cache at once, then the loaded value", async () => {
  await hydrate();
  clearMemory();
  writeCache("acct-a", "home", { greeting: "cached" });
  const source = signal<CacheSource | null>({ account: "acct-a", key: "home", epoch: 0 });
  let release: (v: unknown) => void = () => {};
  const query = cachedQuery(source, () => new Promise((resolve) => (release = resolve)));
  expect(query.data()).toEqual({ greeting: "cached" });
  expect(query.loading()).toBe(false);
  await until(() => query.refreshing());
  release({ greeting: "fresh" });
  await until(() => (query.data() as { greeting: string }).greeting === "fresh");
  expect(readCache("acct-a", "home")).toEqual({ greeting: "fresh" });
});

test("a miss loads, with nothing to show meanwhile", async () => {
  await hydrate();
  clearMemory();
  const source = signal<CacheSource | null>({ account: "acct-a", key: "ytm:playlist:x", epoch: 0 });
  const query = cachedQuery(source, async (key) => ({ key }));
  expect(query.data()).toBeUndefined();
  await until(() => query.data() !== undefined);
  expect(query.data()).toEqual({ key: "ytm:playlist:x" });
});

test("one account never sees another's entries", async () => {
  await hydrate();
  clearMemory();
  writeCache("acct-a", "home", { who: "a" });
  expect(readCache("acct-b", "home")).toBeUndefined();
  const source = signal<CacheSource | null>({ account: "acct-a", key: "home", epoch: 0 });
  const query = cachedQuery(source, () => new Promise(() => {}));
  expect(query.data()).toEqual({ who: "a" });
  source.set({ account: "acct-b", key: "home", epoch: 0 });
  expect(query.data()).toBeUndefined();

  await clearAccount("acct-a");
  expect(readCache("acct-a", "home")).toBeUndefined();
});

test("a new epoch loads again", async () => {
  await hydrate();
  clearMemory();
  let loads = 0;
  const source = signal<CacheSource | null>({ account: "acct-a", key: "library", epoch: 0 });
  const query = cachedQuery(source, async () => ++loads);
  await until(() => query.data() === 1);
  source.set({ account: "acct-a", key: "library", epoch: 1 });
  await until(() => query.data() === 2);
  expect(loads).toBe(2);
});

test("a failed load keeps the cached value and reports the error", async () => {
  await hydrate();
  clearMemory();
  writeCache("acct-a", "home", { greeting: "cached" });
  const source = signal<CacheSource | null>({ account: "acct-a", key: "home", epoch: 0 });
  const query = cachedQuery(source, async () => {
    throw new Error("E_OFFLINE: no network");
  });
  await until(() => query.error() !== undefined);
  expect(query.data()).toEqual({ greeting: "cached" });
  expect(query.loading()).toBe(false);
});

test("the least recently used entries go past the cap", async () => {
  await hydrate();
  clearMemory();
  for (let i = 0; i < CAPACITY + 5; i++) writeCache("acct-a", `k${i}`, i);
  expect(cacheSize()).toBe(CAPACITY);
  expect(readCache("acct-a", "k0")).toBeUndefined();
  expect(readCache("acct-a", `k${CAPACITY + 4}`)).toBe(CAPACITY + 4);
});

test("an entry is stored as the JSON of { savedAt, v }", async () => {
  await hydrate();
  clearMemory();
  const value = { name: "Mix \"1\"", tracks: [1, 2.5, null, "ü"], nested: { a: true } };
  writeCache("acct-s", "stored", value);
  await tick(10);
  const raw = await Storage.getItem("cache:v1:acct-s:stored");
  const parsed = JSON.parse(raw ?? "null") as { savedAt: number; v: unknown };
  expect(raw).toBe(JSON.stringify({ savedAt: parsed.savedAt, v: value }));
  expect(parsed.v).toEqual(value);
});

test("a partial value shows while nothing else can, and is never cached", async () => {
  await hydrate();
  clearMemory();
  const source = signal<CacheSource | null>({ account: "acct-a", key: "ytm:playlist:long", epoch: 0 });
  let step: (v: number[]) => void = () => {};
  let release: (v: number[]) => void = () => {};
  const query = cachedQuery<number[]>(source, (_key, partial) => {
    step = partial;
    return new Promise((resolve) => (release = resolve));
  });
  await until(() => query.loading());
  step([1, 2]);
  await until(() => query.data()?.length === 2);
  expect(query.loading()).toBe(false);
  expect(readCache("acct-a", "ytm:playlist:long")).toBeUndefined();
  step([1, 2, 3, 4]);
  await until(() => query.data()?.length === 4);
  release([1, 2, 3, 4, 5]);
  await until(() => query.data()?.length === 5);
  expect(readCache("acct-a", "ytm:playlist:long")).toEqual([1, 2, 3, 4, 5]);
});

test("a cached value shows over a partial one while it loads again", async () => {
  await hydrate();
  clearMemory();
  writeCache("acct-a", "ytm:playlist:long", [1, 2, 3, 4, 5]);
  const source = signal<CacheSource | null>({ account: "acct-a", key: "ytm:playlist:long", epoch: 0 });
  let release: (v: number[]) => void = () => {};
  const query = cachedQuery<number[]>(source, (_key, partial) => {
    partial([1]);
    return new Promise((resolve) => (release = resolve));
  });
  await until(() => query.refreshing());
  expect(query.data()).toEqual([1, 2, 3, 4, 5]);
  release([1, 2, 3, 4, 5, 6]);
  await until(() => query.data()?.length === 6);
});

test("a load that fails takes its partial value away, and reports the error", async () => {
  await hydrate();
  clearMemory();
  const source = signal<CacheSource | null>({ account: "acct-a", key: "ytm:playlist:cut", epoch: 0 });
  let fail: (e: Error) => void = () => {};
  const query = cachedQuery<number[]>(source, (_key, partial) => {
    partial([1, 2]);
    return new Promise((_, reject) => (fail = reject));
  });
  await until(() => query.data()?.length === 2);
  fail(new Error("E_NETWORK: gone"));
  await until(() => query.error() !== undefined);
  expect(query.data()).toBeUndefined();
});
