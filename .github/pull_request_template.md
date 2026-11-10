## Description

What this pull request changes and the problem it solves. Keep **one PR to one thing**, and keep small improvements
small.

## Screenshots

For anything visible: before and after, on each platform it changes (Linux, macOS, Windows, a phone or the
terminal). If nothing is visible, remove this section.

| Platform | Before | After |
| -------- | ------ | ----- |
| Linux    |        |       |

## Performance

For a change made for speed or memory: before and after numbers (`nsh test --trace`, `tests/bench.test.tsx`). If
none, remove this section.

## How to Test

The tests and checks you ran, and how to reproduce them. Say what was not tested (a real Google account, a
platform).

## Checklist

- [ ] The title is `<area>: <What the change does>` (see "Commits and pull requests" in CONTRIBUTING.md).
- [ ] `nsh check`, `nsh build` and `nsh test` pass.
- [ ] Changes to the bridge: `node --test src/bridge/tests/` passes and `node src/bridge/gen-source.mjs --check` is clean.
- [ ] I reviewed the changes, including any AI-generated code.
