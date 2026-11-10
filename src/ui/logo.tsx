// The YTMFast mark: a play triangle with three speed lines on a glossy
// violet-to-coral tile (the app icon, icon.svg, draws the same). Rendered as
// an SVG data-URI through <Image> (TSX has no inline-SVG element); the tray
// draws the triangle and lines alone (src/platform/desktop.ts).

import { Image } from "nsh";

const INK = "#120a24";

/** The logo SVG at `size` points: a rounded tile in a violet-to-coral
 * gradient with a soft top gloss, and a near-black play mark. */
export function logoMarkup(size = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">\
<defs>\
<linearGradient id="t" x1="0" y1="0" x2="1" y2="1">\
<stop offset="0" stop-color="#a48bff"/><stop offset="0.5" stop-color="#7a5cff"/><stop offset="1" stop-color="#ff6f7d"/>\
</linearGradient>\
<linearGradient id="s" x1="0" y1="0" x2="0" y2="1">\
<stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>\
</linearGradient>\
</defs>\
<rect width="32" height="32" rx="8" fill="url(#t)"/>\
<path d="M8 0h16a8 8 0 0 1 8 8v4.5C24 15.5 8 15.5 0 12.5V8a8 8 0 0 1 8-8z" fill="url(#s)"/>\
<g fill="${INK}" transform="translate(16 16) scale(0.86) translate(-14.55 -16)">\
${MARK}\
</g></svg>`;
}

/** The play mark with its speed lines, in a 32-point frame. */
export const MARK =
  '<rect x="4.5" y="11.25" width="6" height="2.5" rx="1.25"/>' +
  '<rect x="2.5" y="14.75" width="8" height="2.5" rx="1.25"/>' +
  '<rect x="4.5" y="18.25" width="6" height="2.5" rx="1.25"/>' +
  '<path d="M14.6 9.6c0-1.15 1.25-1.87 2.25-1.29l9.3 6.4c.9.62.9 1.96 0 2.58l-9.3 6.4c-1 .58-2.25-.14-2.25-1.29z"/>';

/** The YTMFast logo, `size` points square. */
export function Logo(props: { size?: number }) {
  const size = () => props.size ?? 32;
  return (
    <Image
      src={`data:image/svg+xml,${encodeURIComponent(logoMarkup(size()))}`}
      style={{ width: size(), height: size() }}
    />
  );
}
