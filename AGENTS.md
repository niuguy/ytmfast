# AGENTS.md

YTMFast is an unofficial native YouTube Music client built on NSH in its mixed mode, derived from Spotish: a Rust
crate (the engine that drives YouTube Music's web player in a headless browser) and a TSX interface. Read `CONTRIBUTING.md` first: setup, checks, the
project's layout, and the rules for commits and pull requests. `docs/DESIGN.md` describes the design.

The rules agents most often break:

- **Every change goes through a pull request.** Never push to `main` directly, not even a CI fix or a version bump.
- **One commit and one PR do one thing.** Titles and subjects are `<area>: <What the change does>` (the areas are
  listed in CONTRIBUTING.md), with a body that says why.
- **Run the checks before calling work done:** `nsh check`, `nsh build`, `nsh test`, and for the bridge
  `node --test src/bridge/tests/*.test.mjs` and `node src/bridge/gen-source.mjs --check`. Headless tests prove behavior, not the
  look: take a screenshot for anything visible (`nsh test --target linux` with `app.screenshot`).
- **Never write to `/tmp`.** Put scratch files and logs under `target/agents/`, and point `TMPDIR` outside the
  repository for test runs.
- **YouTube's ads are never blocked or skipped**, and tests never need an account or the network (see "Respecting
  YouTube" in CONTRIBUTING.md). `cargo run --example probe` checks the bridge against the live site by hand.
