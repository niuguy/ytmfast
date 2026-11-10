// A tiny fake DOM for the bridge's node tests: elements with attributes, a
// tree, and querySelector(All)/closest for the selector forms the bridge uses
// (tag, #id, .class, [attr], [attr="v"], [attr*= ^= $= "v" i], descendant
// combinator, comma lists). No dependencies.
"use strict";

function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let quote = "";
  let cur = "";
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (!quote && depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseCompound(text) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([*^$]?=)\s*"([^"]*)"\s*(i)?)?\s*\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) c.tag = m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4], op: m[5] || null, value: m[6], insensitive: !!m[7] });
    if (m[0] === "") re.lastIndex++;
  }
  return c;
}

function matchesCompound(el, c) {
  if (c.tag && c.tag !== "*" && el.tagName !== c.tag) return false;
  if (c.id && el.getAttribute("id") !== c.id) return false;
  for (const cls of c.classes) if (!(el.getAttribute("class") || "").split(/\s+/).includes(cls)) return false;
  for (const a of c.attrs) {
    let v = el.getAttribute(a.name);
    if (v == null) return false;
    if (!a.op) continue;
    let want = a.value;
    if (a.insensitive) {
      v = v.toLowerCase();
      want = want.toLowerCase();
    }
    if (a.op === "=" && v !== want) return false;
    if (a.op === "*=" && !v.includes(want)) return false;
    if (a.op === "^=" && !v.startsWith(want)) return false;
    if (a.op === "$=" && !v.endsWith(want)) return false;
  }
  return true;
}

function matches(el, selector) {
  return splitTop(selector, ",").some((alt) => {
    const parts = splitTop(alt, " ").map(parseCompound);
    if (!matchesCompound(el, parts[parts.length - 1])) return false;
    let i = parts.length - 2;
    let node = el.parentNode;
    while (i >= 0 && node && node.tagName) {
      if (matchesCompound(node, parts[i])) i--;
      node = node.parentNode;
    }
    return i < 0;
  });
}

class FakeElement {
  constructor(tag, attrs, children) {
    this.tagName = tag.toLowerCase();
    this.attributes = Object.assign({}, attrs || {});
    this.children = [];
    this.parentNode = null;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.clicks = 0;
    this.onclick = null;
    this.listeners = {};
    this.isConnected = true;
    (children || []).forEach((c) => this.append(c));
  }
  append(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
    this.isConnected = false;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? String(this.attributes[name]) : null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  get min() {
    return this.getAttribute("min") || "";
  }
  get max() {
    return this.getAttribute("max") || "";
  }
  get step() {
    return this.getAttribute("step") || "";
  }
  get src() {
    return this.getAttribute("src") || "";
  }
  click() {
    this.clicks++;
    if (this.onclick) this.onclick();
  }
  dispatchEvent(event) {
    (this.listeners[event.type] || []).forEach((f) => f(event));
    return true;
  }
  addEventListener(type, f) {
    (this.listeners[type] = this.listeners[type] || []).push(f);
  }
  *descendants() {
    for (const c of this.children) {
      yield c;
      yield* c.descendants();
    }
  }
  querySelectorAll(selector) {
    return [...this.descendants()].filter((el) => matches(el, selector));
  }
  querySelector(selector) {
    for (const el of this.descendants()) if (matches(el, selector)) return el;
    return null;
  }
  closest(selector) {
    for (let node = this; node && node.tagName; node = node.parentNode) if (matches(node, selector)) return node;
    return null;
  }
  scrollIntoView() {}
}

const h = (tag, attrs, ...children) => new FakeElement(tag, attrs, children.flat());

class FakeEvent {
  constructor(type, init) {
    this.type = type;
    this.bubbles = !!(init && init.bubbles);
  }
}

// A fake window around `body`. `clock.t` is the time; `sleep` advances it.
function fakeWindow(body) {
  const clock = { t: 1_000_000 };
  const documentRoot = new FakeElement("#document");
  documentRoot.tagName = undefined; // the root is not an element for matching
  documentRoot.append(body);
  documentRoot.cookie = "";
  const posted = [];
  const intervals = new Set();
  const win = {
    document: documentRoot,
    location: { pathname: "/", href: "https://open.spotify.com/" },
    history: {
      pushState(_s, _t, path) {
        win.location.pathname = path;
        win.location.href = "https://open.spotify.com" + path;
      },
    },
    navigator: {},
    performance: { getEntriesByType: () => [] },
    console: { warn: (...a) => win.warnings.push(a.join(" ")) },
    warnings: [],
    Event: FakeEvent,
    MouseEvent: FakeEvent,
    PopStateEvent: FakeEvent,
    dispatchEvent: (e) => (win.onDispatch ? win.onDispatch(e) : true),
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (f, ms) => {
      const id = setInterval(f, ms);
      intervals.add(id);
      return id;
    },
    clearInterval: (id) => {
      intervals.delete(id);
      clearInterval(id);
    },
    intervals,
    ytmfastEvent: (text) => posted.push(JSON.parse(text)),
    posted,
    clock,
  };
  win.top = win;
  win.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "" });
  return win;
}

const options = (win) => ({
  autostart: false,
  now: () => win.clock.t,
  sleep: async (ms) => {
    win.clock.t += ms;
  },
});

module.exports = { FakeElement, h, fakeWindow, options, matches };
