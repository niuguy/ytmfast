# AGENTS.md

Spotish is an unofficial native Spotify client built on NSH in its mixed mode: a Rust crate (the engine that drives
Spotify's web player in a headless browser) and a TSX interface. Read `CONTRIBUTING.md` first: setup, checks, the
project's layout, and the rules for commits and pull requests. `docs/DESIGN.md` describes the design.

The rules agents most often break:

- **Every change goes through a pull request.** Never push to `main` directly, not even a CI fix or a version bump.
- **One commit and one PR do one thing.** Titles and subjects are `<area>: <What the change does>` (the areas are
  listed in CONTRIBUTING.md), with a body that says why.
- **Run the checks before calling work done:** `nsh check`, `nsh build`, `nsh test`, and for the bridge
  `node --test src/bridge/tests/` and `node src/bridge/gen-source.mjs --check`. Headless tests prove behavior, not the
  look: take a screenshot for anything visible (`nsh test --target linux` with `app.screenshot`).
- **Never write to `/tmp`.** Put scratch files and logs under `target/agents/`, and point `TMPDIR` outside the
  repository for test runs.
- **Spotify's ads are never blocked or skipped**, and tests never need an account or the network (see "Respecting
  Spotify" in CONTRIBUTING.md).
