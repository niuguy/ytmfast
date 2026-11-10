// Links that leave the app: opened in the system browser, https only.

import { openUrl } from "nsh";

export const PREMIUM_URL = "https://www.youtube.com/musicpremium";
export const YTM_URL = "https://music.youtube.com/";
export const TERMS_URL = "https://www.youtube.com/t/terms";
export const NSH_URL = "https://nsh.dev";
/** YTMFast's source. */
export const REPO_URL = "https://github.com/niuguy/ytmfast";
/** Spotish, the native Spotify client YTMFast is forked from. */
export const SPOTISH_URL = "https://github.com/huacnlee/spotish";

/** Opens `url` in the system browser; anything but https is refused. */
export function openExternal(url: string): void {
  if (!url.startsWith("https://")) {
    console.warn(`ytmfast: refused to open a non-https link: ${url}`);
    return;
  }
  openUrl(url).catch((error) => console.warn("ytmfast: couldn't open a link:", String(error)));
}

/** Opens YouTube Music Premium's page. */
export function openPremium(): void {
  openExternal(PREMIUM_URL);
}
