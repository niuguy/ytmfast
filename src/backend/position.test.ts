// The player's position between the backend's messages: moved on from when
// it was sampled while playing, held while paused, never past the end.
import { expect, test } from "nsh/test";
import { EMPTY_PLAYER, positionAt } from "./types";

const sampled = { ...EMPTY_PLAYER, title: "Kites", positionMs: 10_000, durationMs: 60_000, at: 1_000_000 };

test("while playing, the position moves on from its sample", () => {
  const p = { ...sampled, playing: true };
  expect(positionAt(p, 1_000_000)).toBe(10_000);
  expect(positionAt(p, 1_002_500)).toBe(12_500);
});

test("while paused, the position holds", () => {
  const p = { ...sampled, playing: false };
  expect(positionAt(p, 1_009_000)).toBe(10_000);
});

test("the position never passes the end, nor goes back before the sample", () => {
  const p = { ...sampled, playing: true };
  expect(positionAt(p, 1_000_000 + 120_000)).toBe(60_000);
  expect(positionAt(p, 999_000)).toBe(10_000);
});
