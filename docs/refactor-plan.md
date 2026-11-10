# Spotish refactor plan

Synthesized from four read-only reviews (Rust engine, bridge.js, TSX/state, architecture), November 2026. Visual design is being redone separately in Claude Design (see `design-brief.md`); this plan covers correctness, architecture and platform scope.

## Decisions needed from the owner

1. **Name and color.** "Spotish" plus Spotify's exact green (`#1ed760`, `#1db954`) and copy like "Spotify, natively" carry trademark risk. Options: keep the name and drop the green; rename; keep both.
2. **Platform scope.** Free-tier playback works only on desktop (Linux, macOS; Windows via Edge) and TUI. Web and mobile cannot spawn Chromium or use Widevine, and Spotify's SDKs are Premium-only there. Proposal: ship Web and mobile as a demo plus a remote control for your own desktop Spotish.
3. **Headless user-agent rewrite.** The engine hides `HeadlessChrome` and replays Spotify's private GraphQL. Both touch Spotify's terms on automated access. Keep, or switch to a visible (offscreen) window?

## P0 — correctness and safety (do first)

| # | Change | Why | Where |
|---|---|---|---|
| 1 | Import the existing browser login **once**, behind a marker file, via SQLite backup into a staging file, then rename. Never re-import after sign-in or sign-out. | Sign-out currently signs you back in; a fresh sign-in is overwritten; copying a live DB with WAL files can corrupt cookies (looks like "lost login"). | `chrome.rs:37-79`, `session.rs:204` |
| 2 | Bridge guards: run only in the top frame; refuse seek/next/previous during ads; throw when a control is missing or disabled. | Seeking during an ad is possible (compliance); iframes post empty states (player bar flicker); failed controls report success. | `bridge.js` |
| 3 | Play by identity: wait for the new page to render, find rows by track URI, not index. | Wrong track plays; playing a new context can be ignored. | `bridge.js:468-503` |
| 4 | One engine per process (Rust-side singleton; TSX gets a handle). Clean shutdown on quit; check the profile lock and explain it. Stop endless retries on permanent errors. | Hot reload starts a second Chromium → "exit status 21" (profile in use); orphaned Chromium on macOS. | `store.ts:105`, `session.rs:220-232`, `chrome.rs:242` |
| 5 | Cache keyed by account + epoch; cleared on sign-out; reactive hydration; size cap and schema version. | Account B sees account A's Home and Liked Songs; cached pages never retry after sign-in. | `cache.ts`, `store.ts` |
| 6 | Read position/duration/paused from the media element with a timestamp; set controls to a target state with read-back. Remove the UI "hold" workaround. | Seek/volume snapping at the source; toggles not idempotent. | `bridge.js:380-457`, `store.ts` |
| 7 | Remove `--remote-allow-origins=*`; restrict `openExternal` to `https:`. | Local web pages can attach to the debugging port. | `chrome.rs:223`, `exports.rs:367` |

## P1 — architecture

| # | Change | Where |
|---|---|---|
| 8 | Ship `bridge.js` in the TSX bundle and pass it to Rust (`setBridge`), so OTA can repair it. Set up the NSH updater (`nsh.json` updater, signed packages, `minRuntime`, crate `Version`). | `session.rs:22`, `nsh.json` |
| 9 | Typed models: parse bridge answers into `#[derive(JsObject)]` structs in Rust; enums for `Health.status`, `repeat`; structured errors `{ code, message }`. Delete `src/ui/types.ts`, `finishSignIn`, the duplicate signed-in source. | `exports.rs`, `model.rs` |
| 10 | CDP over `--remote-debugging-pipe`, owned by one `BrowserSupervisor`; non-blocking calls through the pending map; coalesce seek/volume; backoff; Chromium log file; restore last context after a crash. | `chrome.rs`, `cdp.rs`, `session.rs` |
| 11 | TSX restructure: `nav.ts` with `createNavStack` (pages keep scroll, phone back gesture, transitions); store split into engine/player/session/feedback; overlays via `Dialog`, `Sheet`, `ToastStack`; shared player components (transport, seek bar, like). | `App.tsx`, `src/ui`, `src/screens` |
| 12 | Shells: Desktop, Phone (working back, drawer with full sidebar, safe areas, no fixed 360pt covers), Terminal (text labels for icon buttons, cell-based layout). | `App.tsx`, `sidebar.tsx`, `controls.tsx` |
| 13 | Tray + keep playing on close (`nsh/desktop`: `closeOnPress: false` → hide; `Tray.set`); media keys and system Now Playing via `souvlaki` (MPRIS/SMTC/MPNowPlaying). | new `shell.tsx`, `media.rs` |
| 14 | Omarchy theme: read `~/.local/state/omarchy/current/theme/colors.toml` (fallback `~/.config/omarchy/current/theme`), map to tokens with `setTheme`/`setColorScheme`, watch `theme.generation` from Rust. | new `theme.rs` |
| 15 | Platform paths: `dirs` crate for data dirs; find Chrome/Edge/Brave in standard install locations; Widevine paths per OS. | `chrome.rs` |
| 16 | Messages: remove "Starting the Spotify web player…", "Starting playback…", "The player is still starting." (disable controls instead); one page-level "Spotify isn't available" + Retry instead of raw errors; skeletons instead of "Loading"; make the Free-tier shuffle notice actually visible once per session. | `App.tsx`, `store.ts`, screens |

## P2

17. `Backend` interface in TSX with `EngineBackend` (desktop/TUI), `DemoBackend` (Web, mobile, tests), `RemoteBackend` (websocket to a desktop instance on the LAN).
18. Tests and CI: Rust contract tests on recorded bridge payloads; bridge snapshot test (opt-in Chromium); replace the stale `tests/app.test.tsx`; `cache` and `store` tests; GitHub Action running `nsh check` and `nsh test`.
19. Make the repo buildable by others (`Cargo.toml` points at a local NSH worktree); fix stale `CONTRIBUTING.md`; first-run sheet with disclaimer and Premium; show ad artwork and click-through during ads.
20. Benchmarks for README and website.

## Order of work

P0 1–7 (about 3 days) → design lands from Claude Design → P1 11–12 together with the new visual system → P1 8–10, 13–16 → P2.
