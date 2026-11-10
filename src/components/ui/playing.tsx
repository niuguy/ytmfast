// The "playing here" mark: three bars that bounce while music plays (with
// the music's bass, mids and treble where it is metered; on their own
// rhythm otherwise) and rest, short, while it is paused or with reduced
// motion. Drawn by a shader, so it moves natively. In a terminal: a ♪.

import { computed, effect, reduceMotion, Shader, Text, token, View } from "nsh";
import { audioLevels, liveValues } from "../../platform/audio";
import { terminal } from "./controls";

const SOURCE = /* wgsl */ `
struct Uniforms {
  color: vec4f,
  levels: vec4f,
  live: f32,
  playing: f32,
  pad0: f32,
  pad1: f32,
}

// A bar's height (0..1) on its own rhythm: two waves, so it never repeats
// plainly.
fn idle(i: f32, t: f32) -> f32 {
  let a = sin(t * (7.0 + i * 1.7) + i * 2.1);
  let b = sin(t * (11.0 - i * 2.3) + i * 4.7);
  return 0.55 + 0.45 * (0.6 * a + 0.4 * b);
}

fn shade(uv: vec2f) -> vec4f {
  let w = nsh.size.x;
  let h = nsh.size.y;
  // Slim bars (a sixth of the mark each), spaced a little wider, centred.
  let bw = w * 0.16;
  let gap = w * 0.2;
  let left = (w - bw * 3.0 - gap * 2.0) * 0.5;
  let p = uv * nsh.size;
  let i = clamp(floor((p.x - left + gap * 0.5) / (bw + gap)), 0.0, 2.0);
  let x0 = left + i * (bw + gap);
  var rest = array<f32, 3>(0.4, 0.7, 0.5);
  let idx = i32(i);
  var level = rest[idx];
  if (uniforms.playing > 0.5) {
    let metered = select(select(uniforms.levels.z, uniforms.levels.y, idx == 1), uniforms.levels.x, idx == 0);
    let own = idle(i, nsh.time);
    // Each bar keeps its own base (never all one height, even as the
    // music starts), the music adding to it; never past 80% of the mark.
    level = mix(own * 0.8, rest[idx] * 0.6 + 0.5 * metered, uniforms.live);
  }
  let bh = max(bw, h * clamp(level, 0.15, 0.8));
  // A rounded bar standing on the bottom.
  let r = bw * 0.5;
  let cx = x0 + r;
  let top = h - bh + r;
  let dy = p.y - clamp(p.y, top, h - r);
  let d = length(vec2f(p.x - cx, dy)) - r;
  let a = clamp(0.5 - d, 0.0, 1.0) * step(p.x, x0 + bw + 0.5);
  return vec4f(uniforms.color.rgb, a);
}
`;

/** The mark, `size` points tall (default 14). */
export function PlayingBars(props: { playing: boolean; size?: number }) {
  const height = () => props.size ?? 14;
  if (terminal) return <Text class="text-foreground">♪</Text>;
  const audio = audioLevels();
  // Changes only when the music starts or stops being metered; paused, the
  // music's frames are not followed.
  const live = computed(() => (props.playing && audio().level > 0.02 ? 1 : 0));
  // The levels reach the shader as animated values: its layer is not sent
  // anew with each of the music's frames.
  const levels = liveValues(3);
  effect(() => {
    // Paused: at rest, and the music's frames not followed (not read).
    if (!props.playing) {
      levels.set(0, 0);
      levels.set(1, 0);
      levels.set(2, 0);
      return;
    }
    const a = audio();
    levels.set(0, a.bass);
    levels.set(1, a.mid);
    levels.set(2, a.treble);
  });
  return (
    <View accessibilityLabel={props.playing ? "Playing" : "Paused"} style={{ width: height(), height: height() }}>
      <Shader
        source={SOURCE}
        accessibilityElementsHidden
        // Its own rhythm reads the clock, which redraws every display frame:
        // only while nothing is metered. Metered, it draws as the levels
        // change.
        paused={!props.playing || reduceMotion() || live() === 1}
        class="absolute inset-0"
        uniforms={{
          color: String(token("foreground")),
          levels: [levels.values[0], levels.values[1], levels.values[2], 0],
          live: props.playing ? live() : 0,
          playing: props.playing && !reduceMotion() ? 1 : 0,
          pad0: 0,
          pad1: 0,
        }}
      />
    </View>
  );
}
