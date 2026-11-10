// Generates src/bridge/source.ts from src/bridge/bridge.js, the single source
// of truth (the Rust engine `include_str!`s bridge.js; the TSX bundle carries
// source.ts so an OTA update can ship a newer bridge via `setBridge`).
//
//   node src/bridge/gen-source.mjs           # write source.ts
//   node src/bridge/gen-source.mjs --check   # exit 1 if source.ts is stale
//
// Plain node, no dependencies.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(here, "bridge.js");
const sourcePath = join(here, "source.ts");

export function render(bridge) {
  const sha = createHash("sha256").update(bridge).digest("hex");
  const revision = Number((/const REVISION = (\d+);/.exec(bridge) || [])[1]);
  const protocol = Number((/const PROTOCOL = (\d+);/.exec(bridge) || [])[1]);
  if (!revision || !protocol) throw new Error("bridge.js lacks `const REVISION = n;` or `const PROTOCOL = n;`");
  return [
    "// GENERATED from src/bridge/bridge.js by src/bridge/gen-source.mjs. Do not edit.",
    "// bridge.js is the single source of truth (the Rust engine include_str!s it);",
    "// this module lets the OTA-updatable TSX bundle hand a newer bridge to the",
    "// engine: `setBridge(BRIDGE_SOURCE)`. After editing bridge.js run",
    "//   node src/bridge/gen-source.mjs",
    "// (`--check` fails when this file is stale; the node tests check it too).",
    "",
    `/** The bridge's protocol version (every message carries \`v\`). */`,
    `export const BRIDGE_PROTOCOL = ${protocol};`,
    `/** The bridge's revision: an installed bridge is replaced only by the same or a newer one. */`,
    `export const BRIDGE_REVISION = ${revision};`,
    `/** sha256 of BRIDGE_SOURCE (hex). */`,
    `export const BRIDGE_SHA256 = ${JSON.stringify(sha)};`,
    `/** The bridge's JavaScript, to inject into the web player. */`,
    `export const BRIDGE_SOURCE: string = ${JSON.stringify(bridge)};`,
    "",
  ].join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const wanted = render(readFileSync(bridgePath, "utf8"));
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(sourcePath, "utf8");
    } catch (_) {}
    if (current !== wanted) {
      console.error("src/bridge/source.ts is stale: run `node src/bridge/gen-source.mjs`");
      process.exit(1);
    }
    console.log("src/bridge/source.ts is up to date");
  } else {
    writeFileSync(sourcePath, wanted);
    console.log("wrote src/bridge/source.ts");
  }
}
