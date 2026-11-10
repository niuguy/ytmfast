// Links that leave the app: opened in the system browser, https only.

import { openUrl } from "nsh";

export const PREMIUM_URL = "https://www.spotify.com/premium/";
export const SPOTIFY_URL = "https://www.spotify.com/";
export const TERMS_URL = "https://www.spotify.com/legal/end-user-agreement/";
export const NSH_URL = "https://nsh.dev";
export const REPO_URL = "https://github.com/huacnlee/spotish";

/** Opens `url` in the system browser; anything but https is refused. */
export function openExternal(url: string): void {
  if (!url.startsWith("https://")) {
    console.warn(`spotish: refused to open a non-https link: ${url}`);
    return;
  }
  openUrl(url).catch((error) => console.warn("spotish: couldn't open a link:", String(error)));
}

/** Opens Spotify Premium's page. */
export function openPremium(): void {
  openExternal(PREMIUM_URL);
}
