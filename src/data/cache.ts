// A cache-first data layer: a query shows what was cached for its key at
// once, loads it again, and keeps the cached value when loading fails.
// Entries belong to one account (one account never sees another's), are
// kept in `Storage` across launches (`{ savedAt, v }`, under a schema
// version), are written only when they change, and the least recently used
// go once there are more than `CAPACITY`.

import { type Accessor, resource, signal, Storage } from "nsh";

/** The version of the stored entries' shape; others are dropped. */
export const SCHEMA = 1;
/** The most entries kept, over every account. */
export const CAPACITY = 60;

const ROOT = "cache:";
const PREFIX = `${ROOT}v${SCHEMA}:`;

interface Entry {
  savedAt: number;
  v: unknown;
  /** `v` as JSON, to tell whether a new value changed anything. */
  json: string;
}

/** Entries by storage key, least recently used first. */
const entries = new Map<string, Entry>();
/** Bumped on every change, so readers follow the map. */
const version = signal(0);
const hydrated = signal(false);
let hydration: Promise<void> | null = null;

function bump() {
  version.update((v) => v + 1);
}

function accountPrefix(account: string): string {
  return `${PREFIX}${encodeURIComponent(account)}:`;
}

function storageKey(account: string, key: string): string {
  return accountPrefix(account) + key;
}

/** An entry as Storage keeps it: `JSON.stringify({ savedAt, v })`, written
 * from the JSON the entry already has rather than serializing `v` again. */
function stored(entry: Entry): string {
  return `${storedHead(entry.savedAt)}${entry.json}}`;
}

/** What a stored entry starts with, up to `v`'s JSON. */
function storedHead(savedAt: number): string {
  return `{"savedAt":${JSON.stringify(savedAt)},"v":`;
}

function persist(k: string, entry: Entry) {
  Storage.setItem(k, stored(entry)).catch((error) =>
    console.warn("spotish: the cache could not save an entry:", String(error)),
  );
}

function forget(k: string) {
  Storage.removeItem(k).catch(() => {});
}

function evict() {
  while (entries.size > CAPACITY) {
    const oldest = entries.keys().next().value as string;
    entries.delete(oldest);
    forget(oldest);
  }
}

/** Loads the stored entries once (later calls wait for the same load), and
 * drops entries of other schema versions. Queries wait for it: they read
 * nothing until it ends. */
export function hydrate(): Promise<void> {
  hydration ??= (async () => {
    try {
      const keys = await Storage.keys();
      const loaded: [string, Entry][] = [];
      for (const k of keys) {
        if (!k.startsWith(ROOT)) continue;
        if (!k.startsWith(PREFIX)) {
          forget(k);
          continue;
        }
        const raw = await Storage.getItem(k);
        try {
          const parsed = raw ? (JSON.parse(raw) as { savedAt?: unknown; v?: unknown }) : null;
          if (!parsed || typeof parsed.savedAt !== "number" || parsed.v === undefined) throw new Error("bad entry");
          // `v`'s JSON is the stored text after the head (as `stored` writes
          // it): taken as it is, not serialized again (a large playlist
          // costs QuickJS a stringify per entry at every launch).
          const head = storedHead(parsed.savedAt);
          const json = raw!.startsWith(head) && raw!.endsWith("}") ? raw!.slice(head.length, -1) : JSON.stringify(parsed.v);
          loaded.push([k, { savedAt: parsed.savedAt, v: parsed.v, json }]);
        } catch {
          forget(k);
        }
      }
      loaded.sort((a, b) => a[1].savedAt - b[1].savedAt);
      // What loaded while hydrating is newer: keep it, after the stored ones.
      const fresh = [...entries];
      entries.clear();
      for (const [k, entry] of loaded) entries.set(k, entry);
      for (const [k, entry] of fresh) {
        entries.delete(k);
        entries.set(k, entry);
      }
      evict();
    } catch (error) {
      console.warn("spotish: the cache could not load:", String(error));
    }
    hydrated.set(true);
    bump();
  })();
  return hydration;
}

/** Whether the stored entries are loaded (tracked where it is read). */
export const cacheReady: Accessor<boolean> = () => hydrated();

/** The cached value of `key` for `account` (tracked where it is read). */
export function readCache<T>(account: string, key: string): T | undefined {
  version();
  return entries.get(storageKey(account, key))?.v as T | undefined;
}

/** Caches `value` for `key` of `account`: the most recently used entry. It
 * is saved only when it differs from the one cached. */
export function writeCache(account: string, key: string, value: unknown): void {
  const k = storageKey(account, key);
  const json = JSON.stringify(value);
  const existing = entries.get(k);
  entries.delete(k);
  if (existing && existing.json === json) {
    entries.set(k, existing);
    return;
  }
  const entry = { savedAt: Date.now(), v: value, json };
  entries.set(k, entry);
  persist(k, entry);
  evict();
  bump();
}

/** Forgets everything cached for `account`, in memory and in Storage. */
export async function clearAccount(account: string): Promise<void> {
  const prefix = accountPrefix(account);
  for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
  bump();
  try {
    for (const k of await Storage.keys()) if (k.startsWith(prefix)) await Storage.removeItem(k);
  } catch (error) {
    console.warn("spotish: the cache could not clear an account:", String(error));
  }
}

/** Forgets every entry in memory (Storage keeps them); for tests. */
export function clearMemory(): void {
  entries.clear();
  bump();
}

/** The number of entries in memory (tracked where it is read). */
export function cacheSize(): number {
  version();
  return entries.size;
}

/** What a query loads: a key of an account, at an epoch (a new epoch loads
 * again, as after signing in or a new token). */
export interface CacheSource {
  account: string;
  key: string;
  epoch: number;
}

/** The state of a cache-first query. */
export interface CachedQuery<T> {
  /** The value for the current source: the loaded one, else the cached one. */
  data: Accessor<T | undefined>;
  /** Loading with nothing to show yet. */
  loading: Accessor<boolean>;
  /** Loading again behind a value that shows. */
  refreshing: Accessor<boolean>;
  /** Why the last load failed (any cached value still shows). */
  error: Accessor<unknown>;
  /** Loads the current source again. */
  refetch(): void;
}

/** A cache-first query of `source()` (null: nothing to load). */
export function cachedQuery<T>(
  source: () => CacheSource | null,
  fetcher: (key: string) => Promise<T>,
): CachedQuery<T> {
  const live = () => (hydrated() ? source() : null);
  const loaded = resource(live, async (s) => {
    const v = await fetcher(s.key);
    writeCache(s.account, s.key, v);
    return { account: s.account, key: s.key, v };
  });
  const data = (): T | undefined => {
    const s = source();
    if (!s) return undefined;
    const fresh = loaded();
    if (fresh && fresh.account === s.account && fresh.key === s.key) return fresh.v;
    return readCache<T>(s.account, s.key);
  };
  const busy = () => {
    const state = loaded.state();
    return state === "pending" || state === "refreshing";
  };
  return {
    data,
    loading: () => source() !== null && data() === undefined && (!hydrated() || busy() || loaded.state() === "unresolved"),
    refreshing: () => data() !== undefined && busy(),
    error: () => (loaded.state() === "errored" ? loaded.error() : undefined),
    refetch: () => loaded.refetch(),
  };
}
