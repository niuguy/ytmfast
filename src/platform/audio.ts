// The music's live levels, for visuals that move with it (the shader).
// Rust (`AudioMeter`, src/audio.rs) records Spotish's own audio stream from
// the system mixer and analyzes it; this side shares one meter per process
// and hands out an accessor.
//
//   const audio = audioLevels();
//   <Shader uniforms={() => ({ pulse: audio().beat, bass: audio().bass })} />
//
// The frame is zero (ZERO_FRAME) where there is nothing to meter: off Linux
// and macOS 14.2+ for now, off the desktops, on the demo backend (tests),
// when the user asks for less motion, while the window is hidden, and while
// the music is quiet.
// The meter starts with its first user and stops a few seconds after its
// last one goes, so it costs nothing while no visual shows.

import { cleanup, createAnimatedValue, host, lifecycle, platform, reduceMotion, signal, type Accessor, type Signal } from "nsh";
import { AudioMeter, type AudioFrame } from "ytmfast/native";

export type { AudioFrame };

/** Silence: every value 0. */
export const ZERO_FRAME: AudioFrame = Object.freeze({
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
  bands: Object.freeze(new Array<number>(16).fill(0)) as number[],
});

/** How long the meter keeps running after its last user goes (a page
 * change that swaps one visual for another should not restart it). */
const LINGER_MS = 3000;

/** The visuals take at most one frame per this many milliseconds (about 60
 * a second): each frame redraws every shader that reads the levels, and
 * the window with them. 30 a second visibly stutters; the meter's own rate
 * (120) costs CPU the eye doesn't see. */
const FRAME_MS = 15;

interface Shared {
  meter: AudioMeter | null;
  stopListening: (() => void) | null;
  frame: Signal<AudioFrame>;
  users: number;
  linger: number | null;
  /** A start or stop is queued. */
  queued: boolean;
  /** The meter cannot run here (decided once). */
  unavailable: boolean;
}

// Survives hot reload: one meter (and one `parec` or tap) per process.
const SLOT = "__ytmfastAudio";

function shared(): Shared {
  const g = globalThis as unknown as Record<string, Shared | undefined>;
  let s = g[SLOT];
  if (!s) {
    s = {
      meter: null,
      stopListening: null,
      frame: signal<AudioFrame>(ZERO_FRAME),
      users: 0,
      linger: null,
      queued: false,
      unavailable: !wanted(),
    };
    g[SLOT] = s;
  }
  return s;
}

/** Whether metering makes sense here: the desktops' native engine, not the
 * demo backend (tests and the web play no real audio). */
function wanted(): boolean {
  let params: Record<string, unknown> = {};
  try {
    params = (host.params ?? {}) as Record<string, unknown>;
  } catch {
    // No host: the defaults.
  }
  return platform.desktop && platform.os !== "web" && params.backend !== "demo" && params.audio !== false;
}

/** Whether frames are wanted now. */
function showing(): boolean {
  return !reduceMotion() && lifecycle() !== "background";
}

/** Starts or stops the meter to match its users and `showing()`, outside
 * whatever runs now: off any owner (so `onFrame`'s listener is not stopped
 * with the binding that first read the levels) and never inside the meter's
 * own callback. */
function settle(s: Shared): void {
  if (s.queued) return;
  s.queued = true;
  void Promise.resolve().then(() => {
    s.queued = false;
    if (s.users > 0 && showing()) start(s);
    else stop(s);
  });
}

function start(s: Shared): void {
  if (s.meter || s.unavailable) return;
  let meter: AudioMeter;
  try {
    meter = new AudioMeter();
  } catch (error) {
    console.warn("audio meter: unavailable:", error);
    s.unavailable = true;
    return;
  }
  if (!meter.available) {
    meter.dispose();
    s.unavailable = true;
    return;
  }
  s.meter = meter;
  let last = 0;
  s.stopListening = meter.onFrame((frame) => {
    if (s.meter !== meter) return;
    if (showing()) {
      const now = Date.now();
      if (now - last < FRAME_MS) return;
      last = now;
      s.frame.set(frame);
    }
    // Hidden, or less motion asked for: stop recording until shown again
    // (the readers then read `showing()` again and restart it).
    else settle(s);
  });
  meter.run().catch((error: unknown) => console.warn("audio meter: stopped:", error));
}

function stop(s: Shared): void {
  const meter = s.meter;
  if (!meter) return;
  s.meter = null;
  s.stopListening?.();
  s.stopListening = null;
  meter.stop();
  meter.dispose();
  s.frame.set(ZERO_FRAME);
}

/**
 * The music's levels now (reactive, about 60 updates a second while it
 * plays): loudness, bass, mids, treble, a beat pulse and 16 spectrum bands,
 * each 0..1. Call it in a component's body; the shared meter runs while any
 * caller lives. Zero wherever there is nothing to meter.
 */
export function audioLevels(): Accessor<AudioFrame> {
  const s = shared();
  if (s.unavailable) return () => ZERO_FRAME;

  s.users += 1;
  if (s.linger !== null) {
    clearTimeout(s.linger);
    s.linger = null;
  }
  try {
    cleanup(() => {
      s.users -= 1;
      if (s.users > 0) return;
      if (s.linger !== null) clearTimeout(s.linger);
      s.linger = setTimeout(() => {
        s.linger = null;
        if (s.users === 0) settle(s);
      }, LINGER_MS);
    });
  } catch {
    // Called outside a component: a user for the rest of the run.
  }

  return () => {
    if (!showing()) return ZERO_FRAME;
    if (!s.meter) settle(s);
    return s.frame();
  };
}

/** Animated values that follow numbers set from JS: each `set` reaches the
 * shader as a value of its own (`ShaderLayer` slots), so the shader draws
 * again without its layer being sent anew. Sending the layer anew counts as
 * a change of the view's drawing, which costs a commit on each of the
 * music's frames. Only changed numbers are sent. */
export function liveValues(count: number) {
  const values = Array.from({ length: count }, () => createAnimatedValue(0));
  const last = new Array<number>(count).fill(0);
  return {
    values,
    set(i: number, v: number) {
      if (last[i] === v) return;
      last[i] = v;
      values[i].set(v);
    },
  };
}
