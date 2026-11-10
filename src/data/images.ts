// YouTube Music's covers are served by Google's image hosts
// (lh3.googleusercontent.com, yt3.ggpht.com, …), which resize to the size
// the URL asks for (`=w544-h544-…`). A cover shown small (a track row, the
// sidebar) asks for a small one: a decoded 544 × 544 cover is 1.2 MB, a
// 120 × 120 one 56 KB, and a long list holds one per row.

/** The size a small cover asks for, in pixels (2× up to 40 points, and
 * then some). */
const SMALL = 120;

/** `url` at a size for a picture `points` across: the small variant when
 * it is small enough (up to 40 points), else as it is. URLs it doesn't
 * know come back unchanged. */
export function imageFor(url: string, points: number | undefined): string {
  if (!url || points === undefined || points > 40) return url;
  const m = /^(https:\/\/[^/]*(?:googleusercontent\.com|ggpht\.com)\/.*?=w)(\d+)-h(\d+)(.*)$/.exec(url);
  if (m && (+m[2] > SMALL || +m[3] > SMALL)) return `${m[1]}${SMALL}-h${SMALL}${m[4]}`;
  return url;
}
