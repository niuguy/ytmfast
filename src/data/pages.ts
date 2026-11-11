// A long playlist a page at a time: its first page shows at once, and the
// rest follow from its continuation, the list growing as they come.

import type { Collection, TrackPage } from "../backend/types";

/** The most pages followed after a list's first. */
export const PAGES_MOST = 20;

/** `first` with its other tracks, up to about `most`, asked of `more` page
 * by page. Before each page, `partial` gets the list so far, so it shows
 * and grows while the rest load. A failed page fails the whole. */
export async function followPages(
  first: Collection,
  most: number,
  more: (continuation: string, offset: number) => Promise<TrackPage>,
  partial: (list: Collection) => void,
): Promise<Collection> {
  let list = first;
  let token = first.continuation ?? "";
  for (let page = 0; token && list.tracks.length < most && page < PAGES_MOST; page++) {
    partial(list);
    const next = await more(token, list.tracks.length);
    if (!next.tracks.length) break;
    const tracks = list.tracks.concat(next.tracks);
    list = { ...list, tracks, total: Math.max(list.total, tracks.length) };
    token = next.continuation;
  }
  return { ...list, continuation: "" };
}
