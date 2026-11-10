// The player's surface and the music's light. The surface is the player's
// colour, opaque, with a one-pixel rim; it reads nothing behind it
// (a glass that did cost a picture of the page under it on every frame of
// a scroll, more than a 120 Hz frame has). Over it, in a layer of its own,
// the music's light (an effect in the cover's colours,
// src/platform/audio.ts); the controls are drawn on top as they are.
//
// Every effect is `fn glow(p: vec2f, uv: vec2f) -> vec4f`: the light's
// colour (rgb, tamed after) and strength (a, 0..1) at `p` (points in the
// surface). Without metering (other
// systems, the demo) effects run at a resting level; paused, they hold
// still; with reduced motion they rest. In a terminal: a plain box.

import { Animated, type AnimatedValue, cleanup, createAnimatedValue, Easing, effect, type JSX, reduceMotion, Shader, token, View } from "nsh";
import { audioLevels, liveValues } from "../../platform/audio";
import { alpha } from "../../state/tint";
import { terminal } from "./controls";

const HEAD = /* wgsl */ `
struct Uniforms {
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
  c3: vec4f,
  base: vec4f,
  b0: vec4f,
  b1: vec4f,
  b2: vec4f,
  b3: vec4f,
  beat: f32,
  level: f32,
  bass: f32,
  mid: f32,
  treble: f32,
  strength: f32,
  radius: f32,
  reach: f32,
  // How far the colours have travelled along the light (0..1, wrapping).
  phase: f32,
  // Seconds, moving on with the music's levels (about 60 updates a second
  // while it plays): what makes the effects flow, at no frame cost of their own.
  clock: f32,
  // Seconds since the last beat began (held at 2 once long past), and that
  // beat's clock time (one value per beat: a seed for what it does).
  since: f32,
  onset: f32,
}

fn band(i: i32) -> f32 {
  let k = clamp(i, 0, 15);
  let v = select(select(select(uniforms.b3, uniforms.b2, k < 12), uniforms.b1, k < 8), uniforms.b0, k < 4);
  let j = k % 4;
  return select(select(select(v.w, v.z, j < 3), v.y, j < 2), v.x, j < 1);
}

// The spectrum at x in 0..1, smooth between bands.
fn spectrum(x: f32) -> f32 {
  let s = clamp(x, 0.0, 1.0) * 15.0;
  let i = i32(floor(s));
  let f = fract(s);
  return mix(band(i), band(i + 1), f * f * (3.0 - 2.0 * f));
}

// The surface's shape: a rounded box of corner radius (a pill when the
// radius is half its height or more).
fn pill(p: vec2f) -> f32 {
  let r = min(uniforms.radius, nsh.size.y * 0.5);
  let c = nsh.size * 0.5;
  let q = abs(p - c) - (c - vec2f(r, r));
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn vivid(c: vec3f) -> vec3f {
  let hi = max(max(c.r, c.g), c.b);
  let lo = min(min(c.r, c.g), c.b);
  let chroma = smoothstep(0.03, 0.2, hi - lo);
  let pure = (c - vec3f(lo)) / max(hi - lo, 0.001);
  return mix(vec3f(0.85), mix(vec3f(0.3), vec3f(1.0), pure), chroma);
}

// The light's colour, held in a band of brightness: the cover's hue, never
// so bright that the controls over it lose their contrast.
fn tame(c: vec3f) -> vec3f {
  let v = vivid(c);
  let lum = dot(v, vec3f(0.2126, 0.7152, 0.0722));
  return clamp(v * (0.32 / max(lum, 0.05)), vec3f(0.0), vec3f(0.9));
}

// The cover's three colours in a loop that travels (the phase), so they
// change places as the music plays; x is where along it, 0..1.
fn cycle(x: f32) -> vec3f {
  let q = fract(x + uniforms.phase) * 3.0;
  let f = smoothstep(0.0, 1.0, fract(q));
  let i = i32(floor(q));
  let a = select(select(uniforms.c2.rgb, uniforms.c1.rgb, i == 1), uniforms.c0.rgb, i == 0);
  let b = select(select(uniforms.c0.rgb, uniforms.c2.rgb, i == 1), uniforms.c1.rgb, i == 0);
  return mix(a, b, f);
}

// Fades toward the surface's ends, so nothing meets its border edge-on.
fn ends(uv: vec2f) -> f32 {
  return smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
}
`;


// Light rising from the bottom edge, the spectrum mirrored from the centre.
const SPECTRUM = /* wgsl */ `
fn effect(p: vec2f, uv: vec2f) -> f32 {
  // Mirrored from the centre (the bass in the middle), sharpened so loud
  // bands stand up as crests over the quiet ones.
  let v = pow(spectrum(abs(uv.x - 0.5) * 2.0), 1.5);
  let up = nsh.size.y - p.y;
  let crest = 2.0 + uniforms.reach * v + 4.0 * uniforms.beat;
  // The body under the crest fades upward; the crest itself is a bright line.
  let body = smoothstep(crest + 2.0, crest - 3.0, up) * (0.15 + 0.45 * v) * (0.4 + 0.6 * (1.0 - up / max(crest, 1.0)));
  let line = exp(-pow((up - crest) / 1.1, 2.0)) * (0.35 + 0.65 * v);
  return (body + line) * ends(uv) * (0.5 + 0.5 * uniforms.level);
}

fn glow(p: vec2f, uv: vec2f) -> vec4f {
  return vec4f(cycle(uv.x * 0.75), effect(p, uv));
}
`;

// Three ribbons of light weaving across, each swelling where its part of
// the spectrum is loud: a thin bright line in a soft glow.
const RIBBONS = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let h = nsh.size.y;
  let lift = min(uniforms.reach * 0.45, h * 0.5);
  var col = vec3f(0.0);
  var sum = 0.0;
  for (var i = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    // Along the spectrum and back (a triangle, never a jump where it wraps).
    let v = pow(spectrum(abs(fract(uv.x * 0.45 + fi * 0.31) * 2.0 - 1.0)), 1.3);
    let amp = (0.15 + 0.85 * v) * min(uniforms.reach * 0.5, h * 0.4) * (0.4 + 0.6 * uniforms.level);
    let y = h - lift + amp * sin(uv.x * (5.0 + fi * 1.7) * 3.14159 + uniforms.clock * (0.8 + fi * 0.35) + fi * 2.1);
    let d = abs(p.y - y);
    let w = (exp(-pow(d / 1.2, 2.0)) + 0.3 * exp(-d / (5.0 + 10.0 * v))) * (0.35 + 0.65 * v);
    col = col + cycle(fi / 3.0 + uv.x * 0.25) * w;
    sum = sum + w;
  }
  return vec4f(col / max(sum, 0.001), sum * 0.6 * ends(uv));
}
`;

// Rounded bars standing on the bottom edge, the spectrum mirrored from the
// centre; each bar's top catches the light.
const BARS = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let n = max(floor(nsh.size.x / 22.0), 8.0);
  let x = uv.x * n;
  let cx = (floor(x) + 0.5) / n;
  let v = pow(spectrum(abs(cx - 0.5) * 2.0), 1.3);
  let top = 3.0 + uniforms.reach * v + 3.0 * uniforms.beat;
  let up = nsh.size.y - p.y;
  let cellw = nsh.size.x / n;
  let half = cellw * 0.26;
  let dx = abs(fract(x) - 0.5) * cellw;
  // A capsule: rounded at the top by half the bar's width.
  let q = vec2f(dx, max(up - (top - half), 0.0));
  let d = length(q) - half;
  let bar = clamp(0.5 - d * nsh.scale, 0.0, 1.0) * step(0.0, up);
  let body = 0.25 + 0.45 * clamp(up / max(top, 1.0), 0.0, 1.0);
  let cap = exp(-pow((up - top + half * 0.5) / 2.0, 2.0)) * smoothstep(half + 1.0, 0.0, dx);
  return vec4f(cycle(cx * 0.75), (bar * body + cap * 0.6) * ends(uv) * (0.6 + 0.4 * uniforms.level));
}
`;

// Curtains of light rising and swaying, tallest where the music is loud:
// a crisp bright hem along the top, fine vertical rays below it fading down.
const AURORA = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let t = uniforms.clock;
  let up = nsh.size.y - p.y;
  let sway = 0.03 * sin(uv.x * 9.0 + t * 0.7) + 0.02 * sin(uv.x * 23.0 - t * 1.1);
  let v = pow(spectrum(abs(uv.x + sway - 0.5) * 2.0), 1.2);
  let top = 6.0 + uniforms.reach * (0.2 + 0.75 * v) + 4.0 * uniforms.beat;
  // The hem: a sharp line where the curtain ends, a pixel or so across.
  let edge = top - up;
  let hem = exp(-pow(edge / 0.9, 2.0));
  let inside = clamp(edge * nsh.scale + 0.5, 0.0, 1.0);
  // Rays: narrow bright folds, drifting, crisp across their width.
  let x = p.x + 8.0 * sin(uv.x * 7.0 + t * 0.8);
  let ray = pow(0.5 + 0.5 * cos(x * 0.55 + t * 0.6), 6.0);
  let k = clamp(up / max(top, 1.0), 0.0, 1.0);
  let curtain = inside * (0.1 + 0.55 * ray) * (0.2 + 0.8 * k * k);
  return vec4f(cycle(uv.x * 0.6 + k * 0.15), (curtain + hem * (0.5 + 0.5 * v)) * (0.5 + 0.5 * uniforms.level) * ends(uv));
}
`;

// An audio waveform, one neon line: four tones (the bass slow and wide, the
// treble quick and fine), each as loud as its part of the spectrum, the
// whole loudest at the centre and calm toward the ends.
const WAVE = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let t = uniforms.clock;
  let h = nsh.size.y;
  let mid = h - min(uniforms.reach * 0.55, h * 0.5);
  let room = min(uniforms.reach * 0.4, h * 0.45);
  let x = p.x - nsh.size.x * 0.5;
  let side = clamp(abs(x) / (nsh.size.x * 0.5), 0.0, 1.0);
  let env = exp(-side * side * 4.0) * (0.35 + 0.65 * spectrum(side));
  let a = room * env * clamp(0.3 + 0.7 * uniforms.level + 0.3 * uniforms.beat, 0.0, 1.0);

  let w = vec4f(0.5 * (band(0) + band(1)) + 0.1, 0.5 * (band(4) + band(5)), 0.5 * (band(9) + band(10)), 0.5 * (band(13) + band(14)));
  let f = vec4f(0.045, 0.11, 0.23, 0.47);
  let ph = x * f + vec4f(1.3, 2.1, 3.4, 5.0) * t + vec4f(0.0, 1.7, 0.6, 2.9);
  let sum = max(w.x + w.y + w.z + w.w, 0.2);
  let y = mid + a * dot(w, sin(ph)) / sum;
  // The distance to the line across it (by its slope), so it stays one
  // even thickness on steep strokes.
  let slope = a * dot(w * f, cos(ph)) / sum;
  let d = abs(p.y - y) / sqrt(1.0 + slope * slope);
  let core = exp(-pow(d / 0.75, 2.0));
  let halo = 0.3 * exp(-d / 4.0);
  return vec4f(cycle(uv.x * 0.9), (core + halo) * (0.5 + 0.5 * env) * ends(uv));
}
`;

// A ring on a wave (neon): a line wavers across, swelling toward the centre,
// and runs into a smooth ring there that swells with the bass and the
// beat. Thin bright cores in a soft glow.
const HALO = /* wgsl */ `
fn neon(d: f32) -> f32 {
  return exp(-pow(d / 0.8, 2.0)) + 0.3 * exp(-d / 4.0);
}

fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let t = uniforms.clock;
  let h = nsh.size.y;
  let mid = h - min(uniforms.reach * 0.55, h * 0.5);
  let c = vec2f(nsh.size.x * 0.5, mid);
  let room = min(uniforms.reach * 0.42, h * 0.42);
  let big = room * (0.62 + 0.1 * uniforms.bass + 0.12 * uniforms.beat);

  // The ring.
  let q = p - c;
  let ang = atan2(q.x, -q.y);
  // A clean circle: it breathes with the bass and the beat, no petals.
  let rim = big;
  let ring = neon(abs(length(q) - rim));

  // The wave: louder toward the centre, faded out inside the ring.
  let x = p.x - c.x;
  let side = clamp(abs(x) / (nsh.size.x * 0.5), 0.0, 1.0);
  let s = pow(spectrum(side), 1.2);
  let amp = room * (0.12 + 0.55 * s) * (1.0 - 0.6 * side);
  let k = 0.09;
  let ph = x * k - t * 2.2;
  let y = mid + amp * sin(ph);
  // The distance to the curve, not just up or down, so the line is even.
  let slope = amp * k * cos(ph);
  let dl = abs(p.y - y) / sqrt(1.0 + slope * slope);
  let outside = smoothstep(rim * 0.85, rim * 1.05, abs(x));
  let line = neon(dl) * outside * (0.4 + 0.6 * s);

  let w = ring + line;
  let col = (cycle(0.5 + ang / 6.28318 * 0.5) * ring + cycle(uv.x * 0.9) * line) / max(w, 0.001);
  return vec4f(col, w * (0.55 + 0.45 * uniforms.level) * ends(uv));
}
`;

// The terrain the 3D effects draw: a surface of rows in perspective (row i
// of n, 0 at the front), the rows bunching toward a horizon and spreading
// wider behind; its height is a smooth field, a massif in the middle that
// rises with the spectrum, rolling slowly. `ridge` returns a row's y at a
// point of the surface and the terrain x there (0..1, the centre at 0.5).
const TERRAIN = /* wgsl */ `
fn depth_x(uvx: f32, z: f32) -> f32 {
  return (uvx - 0.5) * (1.0 + z * 1.4) + 0.5;
}

fn room() -> f32 {
  return min(uniforms.reach, nsh.size.y - 4.0);
}

fn row_base(z: f32) -> f32 {
  let k = (1.0 - 1.0 / (1.0 + z * 2.5)) / (1.0 - 1.0 / 3.5);
  return nsh.size.y - 2.0 - room() * 0.4 * k;
}

fn field(xs: f32, z: f32) -> f32 {
  let t = uniforms.clock;
  let v = pow(spectrum(abs(xs - 0.5) * 2.0), 1.2);
  let massif = exp(-pow((xs - 0.5) * 2.4, 2.0));
  let roll = 0.5 + 0.5 * sin(xs * 9.0 + z * 5.0 + t * 0.5) * cos(xs * 3.7 - z * 3.0 - t * 0.3);
  let middle = exp(-pow((z - 0.35) / 0.5, 2.0));
  return (0.15 + 0.85 * v) * (0.3 + 0.7 * massif) * (0.35 + 0.65 * roll) * middle;
}

fn ridge(uvx: f32, i: f32, n: f32) -> vec2f {
  let z = i / max(n - 1.0, 1.0);
  let xs = depth_x(uvx, z);
  // At most half the room above the farthest row: nothing reaches past the
  // top of the strip it is drawn in.
  let lift = room() * 0.5 * field(xs, z) * (1.0 - 0.35 * z) * clamp(0.6 + 0.4 * uniforms.level + 0.2 * uniforms.beat, 0.0, 1.0);
  return vec2f(row_base(z) - lift, xs);
}

// The distance from p to row i, across the line (by its slope), so it is
// one thickness on steep slopes.
fn row_distance(p: vec2f, uvx: f32, i: f32, n: f32) -> vec2f {
  let r = ridge(uvx, i, n);
  let slope = ridge(uvx + 1.0 / nsh.size.x, i, n).x - r.x;
  return vec2f(abs(p.y - r.x) / sqrt(1.0 + slope * slope), r.x);
}
`;

// Mountains of the spectrum: many fine ridgelines one behind another, a
// surface seen in perspective, brightest on the peaks; the rows in front
// hide those behind.
const MOUNTAINS = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let n = 22.0;
  var seen = 1.0;
  var col = vec3f(0.0);
  var sum = 0.0;
  for (var k = 0; k < 22; k = k + 1) {
    let i = f32(k);
    let z = i / (n - 1.0);
    let rd = row_distance(p, uv.x, i, n);
    let peak = clamp((row_base(z) - rd.y) / max(room() * 0.35, 1.0), 0.0, 1.0);
    let w = (exp(-pow(rd.x / 0.6, 2.0)) + 0.12 * exp(-rd.x / 2.5)) * (1.0 - 0.6 * z) * (0.35 + 0.65 * peak) * seen;
    col = col + cycle(depth_x(uv.x, z) * 0.75 + peak * 0.2) * w;
    sum = sum + w;
    seen = seen * (1.0 - clamp((p.y - rd.y) * nsh.scale + 0.5, 0.0, 1.0));
    if (seen < 0.01) { break; }
  }
  return vec4f(col / max(sum, 0.001), sum * ends(uv));
}
`;

// A wireframe terrain: the same surface as a mesh, rows and the columns
// joining them, each column a line of one terrain x from row to row.
const MESH = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let n = 16.0;
  let cols = 36.0;
  var seen = 1.0;
  var col = vec3f(0.0);
  var sum = 0.0;
  for (var k = 0; k < 16; k = k + 1) {
    let i = f32(k);
    let z = i / (n - 1.0);
    let fade = (1.0 - 0.6 * z) * seen;
    let rd = row_distance(p, uv.x, i, n);
    var w = exp(-pow(rd.x / 0.55, 2.0)) * 0.8;
    // The column segment from this row to the next, at the nearest column.
    if (k < 15) {
      let xc = (floor(depth_x(uv.x, z) * cols) + 0.5) / cols;
      let z1 = (i + 1.0) / (n - 1.0);
      let u0 = (xc - 0.5) / (1.0 + z * 1.4) + 0.5;
      let u1 = (xc - 0.5) / (1.0 + z1 * 1.4) + 0.5;
      let a = vec2f(u0 * nsh.size.x, ridge(u0, i, n).x);
      let b = vec2f(u1 * nsh.size.x, ridge(u1, i + 1.0, n).x);
      let ab = b - a;
      let h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.0001), 0.0, 1.0);
      let dc = length(p - a - ab * h);
      w = w + exp(-pow(dc / 0.5, 2.0)) * 0.55;
    }
    w = w * fade;
    col = col + cycle(depth_x(uv.x, z) * 0.75 + z * 0.1) * w;
    sum = sum + w;
    seen = seen * (1.0 - 0.85 * clamp((p.y - rd.y) * nsh.scale + 0.5, 0.0, 1.0));
  }
  return vec4f(col / max(sum, 0.001), sum * ends(uv));
}
`;

// A wave of particles: the terrain's rows as lines of fine dots in
// perspective, nearer dots larger and brighter, the surface rolling with
// the spectrum.
const PARTICLES = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let n = 12.0;
  var col = vec3f(0.0);
  var sum = 0.0;
  for (var k = 0; k < 12; k = k + 1) {
    let i = f32(k);
    let z = i / (n - 1.0);
    let r = ridge(uv.x, i, n);
    // The nearest dot along this row: dots evenly spaced in the terrain,
    // closer together in the distance.
    let count = 64.0;
    let spacing = nsh.size.x / (count * (1.0 + z * 0.8));
    let dx = abs(fract(r.y * count) - 0.5) * spacing;
    let d = length(vec2f(dx, p.y - r.x));
    let size = 0.55 + 0.6 * (1.0 - z) + 0.4 * uniforms.beat;
    let w = (exp(-pow(d / size, 2.0)) + 0.15 * exp(-d / 2.0)) * (1.0 - 0.7 * z);
    col = col + cycle(r.y * 0.75 + z * 0.15) * w;
    sum = sum + w;
  }
  return vec4f(col / max(sum, 0.001), sum * (0.6 + 0.4 * uniforms.level) * ends(uv));
}
`;

// Strings: five fine lines across, each vibrating like a plucked string
// (a standing wave, still at the ends), the low strings slow and wide, the
// high ones quick and tight, each as loud as its part of the spectrum.
const STRINGS = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let t = uniforms.clock;
  let h = nsh.size.y;
  let span = min(uniforms.reach * 0.7, h - 8.0);
  var col = vec3f(0.0);
  var sum = 0.0;
  for (var k = 0; k < 5; k = k + 1) {
    let i = f32(k);
    let y0 = h - 4.0 - span * (0.1 + 0.2 * i);
    let v = pow(spectrum(i / 4.0), 1.2);
    let modes = 1.0 + i;
    let amp = span * 0.09 * (0.15 + 0.85 * v) * (0.7 + 0.3 * uniforms.beat);
    let ph = uv.x * 3.14159 * modes;
    let osc = sin(t * (6.0 + i * 3.0));
    let y = y0 + amp * sin(ph) * osc;
    let slope = amp * 3.14159 * modes / nsh.size.x * cos(ph) * osc;
    let d = abs(p.y - y) / sqrt(1.0 + slope * slope);
    let w = (exp(-pow(d / 0.6, 2.0)) + 0.18 * exp(-d / 3.0)) * (0.4 + 0.6 * v);
    col = col + cycle(i / 5.0 + uv.x * 0.3) * w;
    sum = sum + w;
  }
  return vec4f(col / max(sum, 0.001), sum * ends(uv) * (0.6 + 0.4 * uniforms.level));
}
`;

// An orb of particles: a sphere fully covered in dots (rows of latitude,
// each with as many dots as its circumference holds), turning slowly and
// tilted, its surface pushed out where the spectrum is loud (the bass at
// the poles, the treble at the equator) and swelling on the beat. Dots in
// front are larger and brighter than those seen through it behind.
const ORB = /* wgsl */ `
fn orb_turn(v: vec3f, a: f32, b: f32) -> vec3f {
  // Turn about y by a, then tilt about x by b.
  let ca = cos(a);
  let sa = sin(a);
  let r1 = vec3f(ca * v.x + sa * v.z, v.y, -sa * v.x + ca * v.z);
  let cb = cos(b);
  let sb = sin(b);
  return vec3f(r1.x, cb * r1.y - sb * r1.z, sb * r1.y + cb * r1.z);
}

fn orb_back(v: vec3f, a: f32, b: f32) -> vec3f {
  let cb = cos(b);
  let sb = sin(b);
  let r1 = vec3f(v.x, cb * v.y + sb * v.z, -sb * v.y + cb * v.z);
  let ca = cos(a);
  let sa = sin(a);
  return vec3f(ca * r1.x - sa * r1.z, r1.y, sa * r1.x + ca * r1.z);
}

fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let t = uniforms.clock;
  let c = vec2f(nsh.size.x * 0.5, nsh.size.y * 0.5);
  let r0 = min(nsh.size.y * 0.36, nsh.size.x * 0.3);
  let turn = t * 0.35;
  let tilt = 0.35 + 0.1 * sin(t * 0.2);
  let rows = 26.0;
  let pi = 3.14159265;
  // Where on the sphere this point looks (the average radius), front and back.
  let q0 = (p - c) / (r0 * 1.12);
  let len = length(q0);
  let q = q0 / max(len, 1.0);
  let zf = sqrt(max(1.0 - dot(q, q), 0.0));
  var col = vec3f(0.0);
  var sum = 0.0;
  for (var side = 0; side < 2; side = side + 1) {
    let z = select(-zf, zf, side == 0);
    let dir = orb_back(vec3f(q.x, -q.y, z), turn, tilt);
    let lat = acos(clamp(dir.y, -1.0, 1.0));
    let lon = atan2(dir.z, dir.x) + pi;
    let row = floor(lat / pi * rows);
    for (var dr = -1; dr <= 1; dr = dr + 1) {
      let i = clamp(row + f32(dr), 0.0, rows - 1.0);
      let la = (i + 0.5) / rows * pi;
      let n = max(1.0, floor(2.0 * rows * sin(la) + 0.5));
      let jc = floor(lon / (2.0 * pi) * n);
      for (var dj = -1; dj <= 1; dj = dj + 1) {
        let j = jc + f32(dj);
        let lo = (j + 0.5) / n * 2.0 * pi - pi;
        let unit = vec3f(sin(la) * cos(lo), cos(la), sin(la) * sin(lo));
        let band = spectrum(abs(la / pi - 0.5) * 2.0);
        let v = pow(band, 1.2) * (0.65 + 0.35 * sin(lo * 3.0 + t * 1.3));
        let r = r0 * (1.0 + 0.28 * v * (0.5 + 0.5 * uniforms.level) + 0.06 * uniforms.beat);
        let w3 = orb_turn(unit, turn, tilt) * r;
        let at = c + vec2f(w3.x, -w3.y);
        let near = clamp(w3.z / r * 0.5 + 0.5, 0.0, 1.0);
        let size = (0.45 + 0.75 * near) * (0.8 + 0.6 * v) * max(r0 / 90.0, 0.6);
        let d = length(p - at);
        let dot = exp(-pow(d / size, 2.0)) * (0.2 + 0.8 * near) * (0.5 + 0.5 * v);
        col = col + cycle(la / pi * 0.5 + (j / n) * 0.5) * dot;
        sum = sum + dot;
      }
    }
  }
  // A faint halo around it.
  let halo = 0.06 * exp(-max(len - 1.0, 0.0) * 3.0) * (0.5 + 0.5 * uniforms.level);
  return vec4f((col + cycle(0.0) * halo) / max(sum + halo, 0.001), sum + halo);
}
`;

// A dot matrix: columns of round dots lit from the bottom up to where the
// spectrum reaches, the dots swelling and brightening toward the crest.
const DOTS = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let pitch = 7.0;
  let cell = floor(p / pitch);
  let c = (cell + 0.5) * pitch;
  let cx = c.x / nsh.size.x;
  let v = pow(spectrum(abs(cx - 0.5) * 2.0), 1.3);
  let top = 2.0 + uniforms.reach * v + 4.0 * uniforms.beat;
  let up = nsh.size.y - c.y;
  // Lit below the crest, fading in over a dot or two above it.
  let lit = smoothstep(top + pitch, top - pitch * 0.5, up);
  let near = clamp(up / max(top, 1.0), 0.0, 1.0);
  // Dots grow toward the crest; a faint twinkle drifts through them.
  let twinkle = 0.85 + 0.15 * sin(uniforms.clock * 2.0 + hash(cell) * 6.28);
  let r = pitch * (0.16 + 0.16 * near * lit);
  let d = length(p - c) - r;
  let dot = clamp(0.5 - d * nsh.scale, 0.0, 1.0);
  let a = dot * (0.12 + 0.88 * lit * (0.35 + 0.65 * near)) * twinkle;
  return vec4f(cycle(cx * 0.75 + near * 0.1), a * ends(uv) * (0.55 + 0.45 * uniforms.level));
}
`;

// A wall of square pixel blocks, retro: each column lights up to the
// spectrum's height, its top tile bright; the unlit mesh shows faintly.
const GRID = /* wgsl */ `
fn glow(p: vec2f, uv: vec2f) -> vec4f {
  // Blocks sized to the surface (small in the player bar, larger in Now
  // Playing), snapped to whole device pixels so their edges stay crisp at
  // any zoom.
  let pitch = floor(clamp(nsh.size.y / 9.0, 5.0, 16.0) * nsh.scale + 0.5) / nsh.scale;
  let tile = floor(pitch * 0.8 * nsh.scale + 0.5) / nsh.scale;
  let cell = floor(p / pitch);
  let c = (cell + 0.5) * pitch;
  let cx = c.x / nsh.size.x;
  let v = pow(spectrum(abs(cx - 0.5) * 2.0), 1.3);
  let top = 2.0 + uniforms.reach * v + 4.0 * uniforms.beat;
  let up = nsh.size.y - (cell.y * pitch);
  // A square block, its corners eased a little.
  let ease = min(1.0, tile * 0.12);
  let q = abs(p - c) - vec2f(tile * 0.5 - ease);
  let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - ease;
  let square = clamp(0.5 - d * nsh.scale, 0.0, 1.0);
  let lit = step(up - pitch, top);
  // The column's top tile: within one pitch of the crest.
  let peak = lit * step(top, up);
  let near = clamp(up / max(top, 1.0), 0.0, 1.0);
  let scan = 0.9 + 0.1 * sin(cell.y * 0.9 - uniforms.clock * 3.0);
  let a = square * (0.07 + lit * (0.25 + 0.4 * near) * scan + peak * 0.35);
  return vec4f(cycle(cx * 0.75 + cell.y * 0.02), a * ends(uv) * (0.55 + 0.45 * uniforms.level));
}
`;

// Electric current: arcs between floating electrodes. The electrodes sit
// along the strip the light owns, by turns high and low, drifting; arcs
// burn between every other one (one to the one after next), so a high
// pair's arc and a low pair's cross each other on the way, and each
// electrode carries one arc at a time, never a chain of them (a current
// never turns a corner). Each arc is a few fine filaments pinched to the
// two electrodes and wound round one another between them, the whole arc bending in a
// smooth curve; the filaments are smooth too, each flowing from one shape
// to the next and flickering on a quick clock of its own. Which pairs burn
// changes every few seconds, and an arc comes and goes as its part of the
// spectrum is loud; on the beat they flare and swell. Crisp: hard white
// cores, anti-aliased, with only a narrow rim of the cover's colour.
const CURRENT = /* wgsl */ `
// Smooth noise along x, -1..1.
fn e_wave(x: f32, seed: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2f(i, seed)), hash(vec2f(i + 1.0, seed)), u) * 2.0 - 1.0;
}

// A filament's course at t (0..1 along its arc), flowing from one shape to
// the next as its clock runs: smooth broad swings with a finer wave on them.
fn e_flow(t: f32, seed: f32, clk: f32) -> f32 {
  let k = floor(clk);
  let f = smoothstep(0.0, 1.0, fract(clk));
  let s0 = k * 1.37 + seed;
  let s1 = s0 + 1.37;
  let c0 = e_wave(t * 3.0, s0) * 0.7 + e_wave(t * 7.0, s0 + 2.0) * 0.3;
  let c1 = e_wave(t * 3.0, s1) * 0.7 + e_wave(t * 7.0, s1 + 2.0) * 0.3;
  return mix(c0, c1, f);
}

// Electrode i: spaced along the strip, by turns high and low, drifting.
fn e_node(i: f32, gap: f32, room: f32) -> vec2f {
  let t = uniforms.clock;
  let high = select(0.28, 0.72, i - 2.0 * floor(i * 0.5) > 0.5);
  let y = high + 0.16 * sin(t * (0.3 + 0.25 * hash(vec2f(i, 1.0))) + hash(vec2f(i, 2.0)) * 6.28);
  let x = (i + 0.5 + 0.2 * sin(t * (0.2 + 0.2 * hash(vec2f(i, 3.0))) + i)) * gap;
  return vec2f(x, room * y);
}

// The arc's offset across its line at t: the filament's own course inside
// the bundle, on the whole arc's bow.
fn e_off(t: f32, bulge: f32, bow: f32, reach: f32, seed: f32, clk: f32) -> f32 {
  let s = sin(3.14159 * t);
  return bow * s + bulge * reach * pow(s, 0.8) * e_flow(t, seed, clk);
}

fn glow(p: vec2f, uv: vec2f) -> vec4f {
  let h = nsh.size.y;
  let room = min(max(uniforms.reach, 12.0), h - 2.0);
  let q = vec2f(p.x, h - p.y);
  let hot = clamp(1.0 - uniforms.since / 0.3, 0.0, 1.0) * clamp(uniforms.beat * 1.5, 0.0, 1.0);
  let gap = min(clamp(room * 0.9, 34.0, 130.0), nsh.size.x / 5.0);
  let count = floor(nsh.size.x / gap);
  let here = floor(q.x / gap);
  // Which pairs may burn: two of every four in turn, moving on every few
  // seconds; so no electrode ever carries two.
  let turn = floor(uniforms.clock * 0.35);
  var core = 0.0;
  var rgb = vec3f(0.0);
  var rimw = 0.0;
  for (var dj = -3; dj <= 0; dj = dj + 1) {
    let i = here + f32(dj);
    let j = i + 2.0;
    if (i < 0.0 || j >= count) { continue; }
    let m = i + 2.0 * turn;
    if (m - 4.0 * floor(m * 0.25) > 1.5) { continue; }
    let lid = vec2f(i, 7.0);
    let a = e_node(i, gap, room);
    let b = e_node(j, gap, room);
    let mid = (a.x + b.x) * 0.5 / nsh.size.x;
    let v = clamp(pow(spectrum(abs(mid - 0.5) * 2.0), 1.1) + uniforms.level * 0.25, 0.0, 1.0);
    // It comes and goes with the music.
    let tick = floor(uniforms.clock * (1.0 + hash(lid)) + hash(lid + 0.5) * 5.0);
    if (hash(vec2f(tick, i)) > 0.55 + 0.4 * v + 0.4 * hot) { continue; }
    let ab = b - a;
    let len = max(length(ab), 1.0);
    let dir = ab / len;
    let r = q - a;
    let t = dot(r, dir) / len;
    let n = r.x * dir.y - r.y * dir.x;
    let bulge = len * 0.24 * (0.6 + 0.4 * v) * (1.0 + 0.35 * hot);
    let bow = len * 0.1 * select(-1.0, 1.0, hash(vec2f(tick, i + 0.5)) > 0.5);
    if (t < -0.05 || t > 1.05 || abs(n) > abs(bow) + bulge + 4.0) { continue; }
    let tc = clamp(t, 0.0, 1.0);
    let tn = clamp(tc + 0.01, 0.0, 1.0);
    let colour = cycle(mid * 0.75);
    var lit = 0.0;
    for (var k = 0; k < 4; k = k + 1) {
      let fid = i * 4.0 + f32(k);
      let blink = uniforms.clock * (9.0 + 8.0 * hash(vec2f(fid, 1.0)));
      if (hash(vec2f(floor(blink), fid)) > 0.6 + 0.3 * v + 0.4 * hot) { continue; }
      let clk = uniforms.clock * (1.5 + 2.0 * hash(vec2f(fid, 2.0))) + hash(vec2f(fid, 3.0)) * 9.0;
      let reach = 0.3 + 0.7 * (f32(k) + hash(vec2f(fid, 4.0))) / 4.0;
      let o = e_off(tc, bulge, bow, reach, fid * 3.3, clk);
      let slope = (e_off(tn, bulge, bow, reach, fid * 3.3, clk) - o) / (0.01 * len);
      let d = length(vec2f((t - tc) * len, (n - o) / sqrt(1.0 + slope * slope)));
      let life = 0.6 + 0.4 * (1.0 - fract(blink));
      let w = 0.5 + 0.2 * v + 0.2 * hot;
      core = core + clamp((w - d) * nsh.scale + 0.5, 0.0, 1.0) * life;
      let rr = clamp(1.0 - d / 2.2, 0.0, 1.0) * 0.4 * life;
      rgb = rgb + colour * rr;
      rimw = rimw + rr;
      lit = 1.0;
    }
    // Its electrodes: small hard points with a little rim.
    let de = min(length(q - a), length(q - b));
    core = core + clamp((1.3 + 0.5 * hot - de) * nsh.scale + 0.5, 0.0, 1.0) * lit;
    let er = clamp(1.0 - de / 5.0, 0.0, 1.0) * 0.45 * lit;
    rgb = rgb + colour * er;
    rimw = rimw + er;
  }
  let white = min(core, 1.0);
  let tint = min(rimw, 0.5);
  let alpha = white + tint;
  let col = (vec3f(1.0) * white + rgb / max(rimw, 0.001) * tint) / max(alpha, 0.001);
  return vec4f(col, alpha * ends(uv) * (0.75 + 0.25 * uniforms.level));
}
`;

// The music's light alone: nothing read from behind, so drawing it with
// every change of the music costs little at any size. Kept inside the
// surface's shape, a pixel in from its rim.
const LIGHT_TAIL = /* wgsl */ `
fn shade(uv: vec2f) -> vec4f {
  let p = uv * nsh.size;
  let inside = clamp(-0.5 - pill(p) * nsh.scale, 0.0, 1.0);
  let g = glow(p, uv);
  let light = clamp(g.a, 0.0, 1.0) * uniforms.strength * inside;
  let noise = (fract(52.9829189 * fract(dot(p * nsh.scale, vec2f(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  return vec4f(tame(g.rgb), clamp(light + noise * inside, 0.0, 0.55));
}
`;

// As LIGHT_TAIL, but white stays white (a light grey, held below the
// controls' own white), and the coloured part (small, brief light) keeps
// the cover's hue vivid.
const WHITE_TAIL = /* wgsl */ `
fn shade(uv: vec2f) -> vec4f {
  let p = uv * nsh.size;
  let inside = clamp(-0.5 - pill(p) * nsh.scale, 0.0, 1.0);
  let g = glow(p, uv);
  let chroma = max(max(g.r, g.g), g.b) - min(min(g.r, g.g), g.b);
  // The coloured light (thin, small, brief) keeps the cover's hue vivid.
  let rgb = mix(vec3f(0.72), vivid(g.rgb) * 0.9, smoothstep(0.04, 0.3, chroma));
  let light = clamp(g.a, 0.0, 1.0) * uniforms.strength * inside;
  let noise = (fract(52.9829189 * fract(dot(p * nsh.scale, vec2f(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  return vec4f(rgb, clamp(light + noise * inside, 0.0, 0.7));
}
`;

/** The lights, by name: each defines `glow`, its colour and strength. */
const LIGHTS = {
  dots: /* wgsl */ `${HEAD}${DOTS}${LIGHT_TAIL}`,
  grid: /* wgsl */ `${HEAD}${GRID}${LIGHT_TAIL}`,
  wave: /* wgsl */ `${HEAD}${WAVE}${LIGHT_TAIL}`,
  orb: /* wgsl */ `${HEAD}${ORB}${LIGHT_TAIL}`,
  spectrum: /* wgsl */ `${HEAD}${SPECTRUM}${LIGHT_TAIL}`,
  bars: /* wgsl */ `${HEAD}${BARS}${LIGHT_TAIL}`,
  ribbons: /* wgsl */ `${HEAD}${RIBBONS}${LIGHT_TAIL}`,
  halo: /* wgsl */ `${HEAD}${HALO}${LIGHT_TAIL}`,
  aurora: /* wgsl */ `${HEAD}${AURORA}${LIGHT_TAIL}`,
  mountains: /* wgsl */ `${HEAD}${TERRAIN}${MOUNTAINS}${LIGHT_TAIL}`,
  mesh: /* wgsl */ `${HEAD}${TERRAIN}${MESH}${LIGHT_TAIL}`,
  particles: /* wgsl */ `${HEAD}${TERRAIN}${PARTICLES}${LIGHT_TAIL}`,
  strings: /* wgsl */ `${HEAD}${STRINGS}${LIGHT_TAIL}`,
  current: /* wgsl */ `${HEAD}${CURRENT}${WHITE_TAIL}`,
} as const;

export type ToolbarEffect = keyof typeof LIGHTS;

/** How many of the cover's colours each effect uses (up to four). */
const COLORS: Record<ToolbarEffect, number> = { spectrum: 3, ribbons: 3, bars: 3, aurora: 3, wave: 3, halo: 3, mountains: 3, mesh: 3, particles: 3, strings: 3, orb: 3, dots: 3, grid: 3, current: 3 };

/** Each effect's name, for the switch. */
export const EFFECT_NAMES: Record<ToolbarEffect, string> = {
  spectrum: "Spectrum",
  ribbons: "Ribbons",
  bars: "Bars",
  aurora: "Aurora",
  wave: "Wave",
  halo: "Halo",
  mountains: "Mountains",
  mesh: "Mesh",
  particles: "Particles",
  strings: "Strings",
  orb: "Orb",
  dots: "Dots",
  grid: "Grid",
  current: "Current",
};
export const TOOLBAR_EFFECTS = Object.keys(LIGHTS) as ToolbarEffect[];

/** How far up each effect reaches in Now Playing, as a share of the room it
 * is given: the terrains and the aurora fill it, the lines take less. */
const REACH: Record<ToolbarEffect, number> = {
  dots: 0.8,
  grid: 0.8,
  wave: 0.55,
  spectrum: 0.6,
  bars: 0.7,
  ribbons: 0.55,
  halo: 0.6,
  aurora: 0.9,
  mountains: 1,
  mesh: 1,
  particles: 0.9,
  strings: 0.5,
  orb: 1,
  current: 0.7,
};

// The music's numbers among HEAD's uniforms, by slot.
const BAND0 = 0; // 16 bands
const BEAT = 16;
const LEVEL = 17;
const BASS = 18;
const MID = 19;
const TREBLE = 20;
const SINCE = 21;
const ONSET = 22;

/** Every uniform of HEAD's struct: the music's (live, resting, or still)
 * and the colours, for `effect`. Call in a component's body. The music's
 * numbers are animated values set as the levels change, so the uniforms
 * themselves (and the layer) change only with the colours, the effect or
 * the size. */
function lightUniforms(props: { effect: ToolbarEffect; colors: string[]; playing: boolean }) {
  const audio = audioLevels();
  const on = () => props.playing && !reduceMotion();
  const live = liveValues(23);
  let lastBeat = -10;
  let lastPulse = 0;
  effect(() => {
    // Paused (or less motion): everything at 0, and the music's frames not
    // followed (not read), so they run nothing here.
    if (!on()) {
      for (let i = 0; i < 23; i++) live.set(i, 0);
      live.set(SINCE, 2);
      return;
    }
    const a = audio();
    // Without metering, a resting level keeps the light alive.
    const metered = a.level > 0.02;
    const rest = metered ? 0 : 0.35;
    for (let i = 0; i < 16; i++) live.set(BAND0 + i, metered ? (a.bands[i] ?? rest) : rest);
    live.set(BEAT, metered ? a.beat : 0);
    live.set(LEVEL, metered ? a.level : 0.4);
    live.set(BASS, metered ? a.bass : 0.3);
    live.set(MID, metered ? a.mid : 0.3);
    live.set(TREBLE, metered ? a.treble : 0.3);
    const now = Date.now() / 1000;
    const pulse = metered ? a.beat : 0;
    if (pulse > lastPulse + 0.5) lastBeat = now;
    lastPulse = pulse;
    live.set(SINCE, Math.min(2, now - lastBeat));
    live.set(ONSET, lastBeat % 600);
  });
  // Time moves the light while it plays, metered or not (where nothing
  // meters the music, as on macOS, no levels come at all): two native
  // loops, run on the UI thread with nothing from JS per frame. The
  // colours travel round every 24 s; the clock wraps every ten minutes,
  // where no effect shows it.
  const phase = createAnimatedValue(0);
  const clock = createAnimatedValue(0);
  effect(() => {
    if (!on()) {
      phase.set(0);
      clock.set(0);
      return;
    }
    const loop = (value: AnimatedValue, toValue: number, seconds: number) => {
      value.set(0);
      const run = Animated.loop(Animated.timing(value, { toValue, duration: seconds * 1000, easing: Easing.linear }));
      void run.start();
      return run;
    };
    const runs = [loop(phase, 1, 24), loop(clock, 600, 600)];
    cleanup(() => runs.forEach((r) => r.stop()));
  });
  const v = live.values;
  const bands = (from: number) => [v[BAND0 + from], v[BAND0 + from + 1], v[BAND0 + from + 2], v[BAND0 + from + 3]];
  const palette = () => {
    const given = props.colors.length ? props.colors : [String(token("primary"))];
    const n = COLORS[props.effect];
    const at = (i: number) => given[Math.min(i, n - 1) % given.length];
    return { c0: at(0), c1: at(1), c2: at(2), c3: at(3) };
  };
  return {
    on,
    uniforms: (extra: { strength: number; radius: number; reach: number }) => ({
      ...palette(),
      base: "#00000000",
      b0: bands(0),
      b1: bands(4),
      b2: bands(8),
      b3: bands(12),
      beat: v[BEAT],
      level: v[LEVEL],
      bass: v[BASS],
      mid: v[MID],
      treble: v[TREBLE],
      ...extra,
      phase,
      clock,
      since: v[SINCE],
      onset: v[ONSET],
    }),
  };
}

/** The player's surface behind `children`, filling its box (`class` gives
 * size, padding and layout): a pill by default, or a box of corner
 * `radius` points. Three layers: the surface, the music's light over it
 * (cheap, with the music), and the controls on top, drawn as they are. */
export function PlayerGlass(props: {
  effect: ToolbarEffect;
  /** The cover's colours, most telling first; an effect takes the first it
   * needs, repeating them when the cover has fewer. */
  colors: string[];
  playing: boolean;
  radius?: number;
  class?: string;
  testID?: string;
  children: JSX.Element;
}) {
  if (terminal) return <View class={props.class}>{props.children}</View>;
  const light = lightUniforms(props);
  const radius = () => props.radius ?? 9999;
  return (
    <View testID={props.testID} class={`relative ${props.class ?? ""}`}>
      {/* The surface: the player's colour, opaque, with a faint rim.
          It reads nothing behind it, so a page scrolling under it costs no
          picture of what it covers. */}
      <View
        accessibilityElementsHidden
        class="absolute inset-0 border border-white/10"
        style={{ backgroundColor: alpha(String(token("player")), 1), borderRadius: radius() }}
      />
      <Shader
        source={LIGHTS[props.effect]}
        accessibilityElementsHidden
        paused={!light.on()}
        class="absolute inset-0"
        uniforms={light.uniforms({ strength: 0.6, radius: radius(), reach: 40 })}
      />
      {props.children}
    </View>
  );
}

/** The music's light along the bottom of its parent (`absolute`, first
 * child), the crests reaching up to `reach` points. Only that strip is
 * drawn: the rest of the page costs nothing. */
export function MusicLight(props: { effect: ToolbarEffect; colors: string[]; playing: boolean; reach: number }) {
  if (terminal) return <View class="hidden" />;
  const light = lightUniforms(props);
  // Each effect its own height (only that strip is drawn).
  const reach = () => props.reach * REACH[props.effect];
  return (
    <Shader
      source={LIGHTS[props.effect]}
      accessibilityElementsHidden
      paused={!light.on()}
      class="absolute inset-x-0 bottom-0"
      style={{ height: Math.ceil(reach() + 24) }}
      uniforms={light.uniforms({ strength: 0.7, radius: 0, reach: reach() })}
    />
  );
}
