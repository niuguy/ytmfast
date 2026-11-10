// The Spotish mark, the website's: three rounded bars of a level meter on
// a glossy green tile. Rendered as an SVG data-URI through <Image> (TSX has
// no inline-SVG element). The website's favicon and header
// (website/public/favicon.svg, website/src/layouts/Home.astro) draw the
// same mark; the tray draws its bars alone (src/platform/desktop.ts).

import { Image } from "nsh";

const INK = "#04130a";

/** The logo SVG at `size` points: a rounded tile in a light-to-deep green
 * gradient with a soft top gloss, and three near-black bars. */
export function logoMarkup(size = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">\
<defs>\
<linearGradient id="t" x1="0" y1="0" x2="1" y2="1">\
<stop offset="0" stop-color="#5ff08f"/><stop offset="0.5" stop-color="#1ed760"/><stop offset="1" stop-color="#14833b"/>\
</linearGradient>\
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1">\
<stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>\
</linearGradient>\
</defs>\
<rect width="32" height="32" rx="8" fill="url(#t)"/>\
<path d="M8 0h16a8 8 0 0 1 8 8v4.5C24 15.5 8 15.5 0 12.5V8a8 8 0 0 1 8-8z" fill="url(#s)"/>\
<g fill="${INK}">\
<rect x="8" y="13" width="4" height="11" rx="2"/>\
<rect x="14" y="8" width="4" height="16" rx="2"/>\
<rect x="20" y="16" width="4" height="8" rx="2"/>\
</g></svg>`;
}

/** The Spotish logo, `size` points square. */
export function Logo(props: { size?: number }) {
  const size = () => props.size ?? 32;
  return (
    <Image
      src={`data:image/svg+xml,${encodeURIComponent(logoMarkup(size()))}`}
      style={{ width: size(), height: size() }}
    />
  );
}
