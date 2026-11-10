// Spotify's images come in a few sizes, and the size is part of the URL.
// A cover shown small (a track row, the sidebar) asks for the small one: a
// decoded 300 × 300 cover is 360 KB, a 64 × 64 one 16 KB, and a long list
// holds one per row.

/** Each family of Spotify image ids, largest first, with the small one. */
const FAMILIES: { sizes: string[]; small: string }[] = [
  // Album covers: 640, 300, 64.
  { sizes: ["ab67616d0000b273", "ab67616d00001e02"], small: "ab67616d00004851" },
  // Artists: 640, 320; 160 the small one.
  { sizes: ["ab6761610000e5eb", "ab67616100005174"], small: "ab6761610000f178" },
];

/** `url` at a size for a picture `points` across: the small variant when
 * it is small enough (up to 40 points), else as it is. URLs it doesn't
 * know come back unchanged. */
export function imageFor(url: string, points: number | undefined): string {
  if (!url || points === undefined || points > 40) return url;
  for (const f of FAMILIES) {
    for (const s of f.sizes) {
      if (url.includes(`/image/${s}`)) return url.replace(`/image/${s}`, `/image/${f.small}`);
    }
  }
  // Playlist mosaics: mosaic.scdn.co/<size>/…
  const m = /^(https:\/\/mosaic\.scdn\.co\/)(\d+)(\/.*)$/.exec(url);
  if (m && +m[2] > 60) return `${m[1]}60${m[3]}`;
  return url;
}
