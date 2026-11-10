# Contributing to Spotish

Contributions are welcome. If you find a bug or have an idea, please open an issue or a pull request.

Please submit **one PR that does one thing** — it is easier to review and faster to merge. Write clean code that
follows the style and organization of the code around it, and make sure the checks below pass.

## Respecting Spotify

Spotish plays through Spotify's own web player with the listener's own account, and it **never blocks, skips, mutes,
hides or shortens Spotify's ads**. Keep it that way: changes that remove ads or get around Spotify Free's limits (on
demand play, skips) will not be merged. Point listeners to Spotify Premium instead. Spotish is unofficial: use
"Spotify" only to say what Spotish works with, and do not use Spotify's logo, green or look.

## Setup

1. **Rust** through [rustup](https://rustup.rs), and on Linux GTK 4.14+ development packages (see NSH's
   [installation guide](https://nsh.dev/docs/installation.md)).
2. **The `nsh` CLI, nightly.** Spotish follows NSH's `main` branch. Install the nightly build (macOS arm64, Linux
   x86_64; Windows: `$env:NSH_VERSION="nightly"; irm https://nsh.dev/install.ps1 | iex`):

   ```sh
   curl -fsSL https://nsh.dev/install.sh | sh -s -- --nightly
   nsh --version    # e.g. "nsh 0.4.0 (f81b965)": the commit it was built from
   ```

3. **A browser with Widevine**: Google Chrome, Chromium, Microsoft Edge or Brave. Only needed to play music, not for
   demo mode or the tests.

### How Spotish depends on NSH

`Cargo.toml` takes NSH's crates from Git, from its `main` branch:

```toml
nsh-core = { git = "https://github.com/longbridge/nsh", branch = "main" }
```

`Cargo.lock` holds the commit. The `nsh` CLI generates its hosts from the same Git checkout Cargo resolved, so the app
and its hosts share one `nsh-core`. The locked commit must be the one your CLI was built from (the hash
`nsh --version` prints): the code the CLI generates calls that commit's API. The `nightly` tag moves with NSH's
`main`; to follow it, reinstall the CLI, run `cargo update -p nsh-core` (it takes `main`'s latest commit, so do it
soon after the nightly is published; `cargo update -p nsh-core --precise <hash>` takes the exact commit
`git ls-remote https://github.com/longbridge/nsh refs/tags/nightly` prints), and run `nsh check` and `nsh test`. CI
warns when the nightly CLI and the locked commit differ.

To work against a local NSH checkout instead (for example while changing NSH itself), point the `nsh-*` lines at it
with `path = "../nsh/crates/nsh-core"` (and so on) and use a CLI built from that checkout. Do not commit that change:
nobody else has your checkout.

## Running

```sh
nsh run                       # build the engine, bundle the TSX interface, run on this machine
SPOTISH_DEMO=1 nsh run        # demo mode: recorded sample data, no browser, no account
nsh run --target tui          # the terminal interface
```

- **Demo mode** (`SPOTISH_DEMO=1`) is the quickest way to work on the interface, and is what Web and mobile run.
- **Importing an existing login.** Set `SPOTISH_PROFILE` to the profile directory of a browser you are already signed
  in to Spotify with (for example `~/.config/chromium` or `~/.config/google-chrome`). Spotish imports that login once
  into its own profile; close that browser first. Without it, press **Log in** and sign in in the window that opens.
- `SPOTISH_BROWSER` picks the browser executable when Spotish does not find yours.

## Checks and tests

Run these before opening a PR; CI runs the same (`.github/workflows/ci.yml`):

```sh
nsh check                              # cargo check --all-targets, then tsc
nsh build                              # describe the crate and bundle the TSX (bundler diagnostics)
nsh test                               # cargo test, then the *.test.tsx files headless
cargo test                             # the Rust crate alone
node --check src/bridge/bridge.js      # the bridge parses
node --test src/bridge/*.test.mjs      # the bridge's tests, when present
```

Tests never need a Spotify account or the network: test the engine on recorded bridge payloads
(`src/spotify/fixtures/`), and the interface against demo data. If a test runs something that makes temporary
directories, point `TMPDIR` outside the repository.

## Commits and pull requests

Spotish follows [NSH's rules](https://github.com/longbridge/nsh/blob/main/CONTRIBUTING.md) for commits and pull
requests:

- **Every change goes through a pull request; nothing is pushed to `main` directly.** That includes documentation,
  version bumps and CI or workflow fixes. Make a topic branch, push it, open a PR against `main`, and merge it once
  CI passes.
- **One commit, one PR: one thing.** No unrelated refactors, cleanups or formatting along the way. A change that does
  two things is two PRs.
- **Subjects and PR titles are `<area>: <What the change does>`.** The area is lower case and names one part, never
  several separated by commas. For a change that spans parts, name the part it is mostly about. After the colon comes
  an imperative sentence that starts with a capital letter, with no trailing period, about 72 characters in all. Say
  what it does for people using Spotish, not which files changed. Never use conventional prefixes (`fix:`, `feat:`).

  The areas:

  | Area | What it covers |
  | --- | --- |
  | `engine` | The Rust engine: the browser, CDP and the session (`src/spotify/`, `src/exports.rs`) |
  | `bridge` | The script that drives the web player (`src/bridge/`) |
  | `audio` | The audio meter (`src/audio.rs`, `src/platform/audio.ts`) |
  | `media` | The system's media controls and keys (`src/media.rs`, `src/platform/media.ts`) |
  | `theme` | The system theme and the color tokens (`src/theme.rs`, `theme.json`) |
  | A screen or component | A part of the interface, in snake case: `player`, `now_playing`, `lyrics`, `sidebar`, `header`, `home`, `search`, `collection`, `nav`, `ui` (the shared controls) |
  | `desktop`, `phone`, `tui` | One shell (`src/shells/`) |
  | `data` | Queries and the cache (`src/data/`) |
  | `ci`, `release` | The workflows: checks, and packaging and publishing |
  | `website`, `docs`, `tests` | The site, the documentation, the tests alone |

  For example: `lyrics: Show the lyrics in Now Playing`, `nav: Keep the last four pages in the stack`,
  `ci: Install GStreamer for the Linux builds`.
- **The body explains why**, wrapped at 72 columns. A change made for speed or memory includes its before and after
  numbers (`nsh test --trace`, or `tests/bench.test.tsx`).
- **A PR follows the template** (`.github/pull_request_template.md`): what it changes and why, screenshots of anything
  visible, and how it was tested, including what was not.
- End AI-assisted commits with a `Co-Authored-By:` line naming the model.

## Project layout

Rust (the engine):

- `src/spotify/` — runs and drives Spotify's web player in your browser over the DevTools protocol (browser discovery
  and launch, the CDP connection, the session), the typed models of what it returns, and demo data.
- `src/exports.rs` — what the engine exports to TSX (`#[class]` classes and `JsObject` types). This is the only
  door between Rust and TSX; keep it typed.
- `src/lib.rs` — the crate root.

The bridge:

- `src/bridge/bridge.js` — the script installed in the web player. It reads what the player uses to talk to Spotify
  and reports the player's state. Every selector and query name of the web player is read in this one file, so a
  change to Spotify's web player is mended here. Its tests sit beside it as `*.test.mjs`.

TSX (the interface), from `App.tsx`:

- `src/backend/` — the `Backend` interface and its implementations: the engine (desktop, TUI), demo data (Web, mobile,
  tests) and, later, a remote control for a desktop Spotish.
- `src/state/` — the app's stores (engine, player, session, feedback), the one owner of what the backend reports.
- `src/data/` — data loading and the cache (keyed by account, cleared on sign-out).
- `src/components/` — the app's own components: theme-token styling, icons, controls, and shared player pieces
  (transport, seek bar, like). Wrap each `nsh/base` component once here.
- `src/pages/` — Home, Search, Library, collections, Now Playing, About.
- `src/shells/` — Desktop, Phone and Terminal shells that arrange the pages.
- `src/platform/` — platform integrations (tray, media keys, system theme).
- `src/nav.ts` — navigation: a stack of pages that keep their scroll, with back.
- `theme.json` — the color tokens, light and dark. Draw with tokens, never raw colors.
- `tests/` — the app's flows on the demo backend (`app.test.tsx`), the opt-in benchmarks (`bench.test.tsx`), and the
  Rust tests.

The website (`website/`, Astro) is separate: `cd website && bun install && bun run build`. It also serves the
installers, `website/public/install.sh` and `install.ps1`.

## Built on NSH

Read NSH's [coding and design guides](https://nsh.dev/docs) before changing the interface, and keep the look Spotish's
own.
