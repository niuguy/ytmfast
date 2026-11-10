// The app's one backend, chosen once: the native engine on the desktops and
// in a terminal, the demo on the web, on phones and when the host asks for
// it (`host.params.backend === "demo"`, as tests do). The engine gets the
// bridge script shipped with this bundle, so an OTA update can fix it.

import { host, platform } from "nsh";
import { DemoBackend, type DemoOptions } from "../backend/demo";
import { enrich } from "../backend/fixtures";
import { engineBackend } from "../backend/engine";
import { BRIDGE_SOURCE } from "../bridge/source";
import type { Backend } from "../backend/types";

const DEMO_KEY = "__ytmfastDemo";

function params(): Record<string, unknown> {
  try {
    return (host.params ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function demo(p: Record<string, unknown>): Backend {
  const g = globalThis as unknown as Record<string, DemoBackend | undefined>;
  let backend = g[DEMO_KEY];
  if (!backend) {
    const options: DemoOptions = {};
    if (typeof p.premium === "boolean") options.premium = p.premium;
    if (typeof p.signedIn === "boolean") options.signedIn = p.signedIn;
    if (typeof p.ad === "boolean") options.ad = p.ad;
    if (typeof p.latency === "number") options.latency = p.latency;
    // A library as large as a real one, with covers: for performance runs,
    // and on phones, where the demo is all there is (no engine to log in
    // with), so it looks like music rather than placeholders.
    const phone = platform.os === "ios" || platform.os === "android";
    if (p.demo === "rich" || (phone && p.backend !== "demo")) enrich();
    backend = new DemoBackend(options);
    g[DEMO_KEY] = backend;
  }
  return backend;
}

function choose(): Backend {
  const p = params();
  const engineWanted = p.backend !== "demo" && platform.desktop && platform.os !== "web";
  if (engineWanted) {
    try {
      const engine = engineBackend();
      engine.setBridge(BRIDGE_SOURCE);
      return engine;
    } catch (error) {
      console.error("spotish: the engine is unavailable, playing the demo:", String(error));
    }
  }
  return demo(p);
}

/** The backend every store goes through. */
export const backend: Backend = choose();

/** Whether the music is the demo's. */
export const isDemo = backend.kind === "demo";
