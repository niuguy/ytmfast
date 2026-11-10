// The audio meter's TSX side: headless there is no music to meter, so the
// levels stay at zero and nothing is recorded. (The analysis itself is
// tested in Rust: src/audio.rs.)
import { describe, expect, test } from "nsh/test";
import { AudioMeter } from "spotish/native";

import { audioLevels, ZERO_FRAME } from "./audio";

describe("audio levels", () => {
  test("the zero frame is silence in every value", () => {
    expect(ZERO_FRAME.bands.length).toBe(16);
    expect(ZERO_FRAME.bands.every((b) => b === 0)).toBe(true);
    expect([ZERO_FRAME.level, ZERO_FRAME.bass, ZERO_FRAME.mid, ZERO_FRAME.treble, ZERO_FRAME.beat]).toEqual([0, 0, 0, 0, 0]);
  });

  test("headless, the levels are the zero frame", () => {
    const levels = audioLevels();
    expect(levels()).toEqual(ZERO_FRAME);
    expect(levels()).toEqual(ZERO_FRAME);
  });

  test("a meter that never runs stops cleanly", () => {
    const meter = new AudioMeter();
    expect(typeof meter.available).toBe("boolean");
    const stop = meter.onFrame(() => {});
    stop();
    meter.stop();
    meter.dispose();
  });
});
