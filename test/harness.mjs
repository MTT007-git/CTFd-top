/**
 * Test harness: runs the *built* dist/content.js inside a mock browser.
 * Nothing here imports the TypeScript sources — the tests exercise the same
 * bundle that ships in the extension.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Doc, makeMutationObserver } from "./dom.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ORIGIN = "https://ctf.example.com";
export const STORAGE_SITES = "ctfdTop:sites";
export const STORAGE_EXCEPTIONS = "ctfdTop:exceptions";

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

/* ------------------------------------------------------------------ chrome */

export function makeChrome() {
  const store = new Map();
  const changeListeners = [];
  const messageListeners = [];

  const emit = (changes) => {
    for (const listener of [...changeListeners]) listener(changes, "local");
  };

  const local = {
    async get(query) {
      const keys =
        typeof query === "string"
          ? [query]
          : Array.isArray(query)
            ? query
            : Object.keys(query ?? {});
      const out = {};
      for (const key of keys) if (store.has(key)) out[key] = clone(store.get(key));
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = {
          oldValue: store.has(key) ? clone(store.get(key)) : undefined,
          newValue: clone(value),
        };
        store.set(key, clone(value));
      }
      emit(changes);
    },
    async remove(query) {
      const keys = typeof query === "string" ? [query] : query;
      const changes = {};
      for (const key of keys) {
        if (!store.has(key)) continue;
        changes[key] = { oldValue: clone(store.get(key)), newValue: undefined };
        store.delete(key);
      }
      if (Object.keys(changes).length > 0) emit(changes);
    },
  };

  return {
    storage: {
      local,
      onChanged: {
        addListener: (fn) => changeListeners.push(fn),
        removeListener: (fn) => {
          const index = changeListeners.indexOf(fn);
          if (index >= 0) changeListeners.splice(index, 1);
        },
      },
    },
    runtime: {
      id: "ctfd-top-test",
      lastError: undefined,
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      sendMessage: async () => undefined,
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => undefined,
    },
    scripting: {
      getRegisteredContentScripts: async () => [],
      registerContentScripts: async () => undefined,
      unregisterContentScripts: async () => undefined,
    },
    action: {
      setBadgeText: async () => undefined,
      setBadgeBackgroundColor: async () => undefined,
    },

    /* test-only helpers */
    __store: store,
    __listenerCount: () => messageListeners.length,
    /** Deliver a message the way chrome.tabs.sendMessage would. */
    __send(message) {
      return new Promise((resolve) => {
        let asynchronous = false;
        let settled = false;
        for (const listener of messageListeners) {
          const result = listener(message, { id: "test" }, (response) => {
            settled = true;
            resolve(response);
          });
          if (result === true) asynchronous = true;
        }
        if (!asynchronous && !settled) resolve(undefined);
      });
    },
  };
}

export async function seedSite(chrome, settings = {}, { origin = ORIGIN, active = true } = {}) {
  await chrome.storage.local.set({
    [STORAGE_SITES]: { [origin]: { active, settings } },
  });
}

/* ------------------------------------------------------------------- fetch */

/**
 * CTFd-shaped API mock. `config.status` entries force an HTTP status for a
 * route so the fallback path can be exercised.
 */
export function makeApi(config = {}) {
  const calls = [];

  const respond = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  });

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, init });

    const topMatch = /\/api\/v1\/scoreboard\/top\/(\d+)$/.exec(target);
    if (topMatch) {
      if (config.topStatus) return respond(config.topStatus, { success: false });
      const limit = Number(topMatch[1]);
      return respond(200, { success: true, data: topPayload((config.players ?? []).slice(0, limit)) });
    }

    if (/\/api\/v1\/scoreboard$/.test(target)) {
      if (config.scoreboardStatus) return respond(config.scoreboardStatus, { success: false });
      return respond(200, { success: true, data: scoreboardPayload(config.players ?? []) });
    }

    const solvesMatch = /\/api\/v1\/challenges\/(\d+)\/solves$/.exec(target);
    if (solvesMatch) {
      if (config.solvesStatus) return respond(config.solvesStatus, { success: false });
      const id = Number(solvesMatch[1]);
      return respond(200, { success: true, data: solversPayload(config.players ?? [], id) });
    }

    if (/\/api\/v1\/challenges$/.test(target)) {
      if (config.challengesStatus) return respond(config.challengesStatus, { success: false });
      return respond(200, { success: true, data: config.challenges ?? [] });
    }

    return respond(404, { success: false });
  };

  return {
    fetch: fetchImpl,
    calls,
    /** How many calls hit a route, e.g. count(/\/scoreboard\/top\//). */
    count(pattern) {
      return calls.filter((call) => pattern.test(call.url)).length;
    },
    urls() {
      return calls.map((call) => call.url);
    },
  };
}

export function topPayload(players) {
  const data = {};
  players.forEach((player, index) => {
    data[String(index + 1)] = {
      id: player.id,
      name: player.name,
      score: player.score ?? 0,
      bracket_name: player.bracket ?? "",
      solves: (player.solves ?? []).map((challengeId) => ({ challenge_id: challengeId })),
    };
  });
  return data;
}

export function scoreboardPayload(players) {
  return players.map((player, index) => ({
    pos: index + 1,
    account_id: player.id,
    name: player.name,
    score: player.score ?? 0,
    bracket_name: player.bracket ?? "",
  }));
}

export function solversPayload(players, challengeId) {
  return players
    .filter((player) => (player.solves ?? []).includes(challengeId))
    .map((player) => ({
      account_id: player.id,
      name: player.name,
      date: "2026-01-01T00:00:00Z",
      account_url: `/users/${player.id}`,
    }));
}

/* --------------------------------------------------------------------- DOM */

/**
 * Build a page shaped like CTFd's core theme:
 *   div.jumbotron > div.container > h1
 *   div.container > (div.category-header + div.category-challenges.row)*
 */
export function buildChallengesPage(doc, categories, options = {}) {
  const {
    footer = true,
    iconHref = "/themes/core/static/img/favicon.ico",
    heading = "Challenges",
    // CTFd's core theme wraps each category's header + row in a spacing
    // container (`pt-5`); that wrapper is what leaves gaps behind when a
    // category is emptied by the flat sort.
    wrapCategories = false,
  } = options;

  if (iconHref) {
    const link = doc.createElement("link");
    link.setAttribute("rel", "shortcut icon");
    link.setAttribute("href", iconHref);
    doc.head.appendChild(link);
  }

  const jumbotron = doc.createElement("div");
  jumbotron.className = "jumbotron";
  const jumboContainer = doc.createElement("div");
  jumboContainer.className = "container";
  const title = doc.createElement("h1");
  title.textContent = heading;
  jumboContainer.appendChild(title);
  jumbotron.appendChild(jumboContainer);
  doc.body.appendChild(jumbotron);

  const board = doc.createElement("div");
  board.className = "container";
  board.setAttribute("id", "challenges-board");
  doc.body.appendChild(board);

  const rows = new Map();
  const buttons = new Map();
  const cards = new Map();
  const wrappers = new Map();

  for (const category of categories) {
    let host = board;
    if (wrapCategories) {
      const wrapper = doc.createElement("div");
      wrapper.className = "pt-5";
      board.appendChild(wrapper);
      wrappers.set(category.name, wrapper);
      host = wrapper;
    }

    const header = doc.createElement("div");
    header.className = "category-header col-md-12";
    const h3 = doc.createElement("h3");
    h3.textContent = category.name;
    header.appendChild(h3);
    host.appendChild(header);

    const row = doc.createElement("div");
    row.className = "category-challenges row";
    host.appendChild(row);
    rows.set(category.name, row);

    for (const challenge of category.challenges) {
      const card = doc.createElement("div");
      card.className = "col-md-3 mb-2";
      const button = doc.createElement("button");
      button.className = "btn btn-dark challenge-button w-100 text-truncate";
      button.setAttribute("value", String(challenge.id));
      const inner = doc.createElement("div");
      inner.className = "challenge-inner my-3";
      const name = doc.createElement("p");
      name.textContent = challenge.name;
      const points = doc.createElement("span");
      points.textContent = String(challenge.value ?? 100);
      inner.appendChild(name);
      inner.appendChild(points);
      button.appendChild(inner);
      card.appendChild(button);
      row.appendChild(card);
      buttons.set(challenge.id, button);
      cards.set(challenge.id, card);
    }
  }

  if (footer) {
    const link = doc.createElement("a");
    link.setAttribute("href", "https://ctfd.io");
    link.textContent = "Powered by CTFd";
    doc.body.appendChild(link);
  }

  return { jumbotron, board, rows, buttons, cards, wrappers };
}

/** A `/users/<id>` profile page. */
export function buildProfilePage(doc, name) {
  const link = doc.createElement("link");
  link.setAttribute("rel", "shortcut icon");
  link.setAttribute("href", "/themes/core/static/img/favicon.ico");
  doc.head.appendChild(link);

  const jumbotron = doc.createElement("div");
  jumbotron.className = "jumbotron";
  const container = doc.createElement("div");
  container.className = "container";
  const h1 = doc.createElement("h1");
  h1.textContent = name;
  container.appendChild(h1);
  jumbotron.appendChild(container);
  doc.body.appendChild(jumbotron);

  const footerLink = doc.createElement("a");
  footerLink.setAttribute("href", "https://ctfd.io");
  doc.body.appendChild(footerLink);

  return { jumbotron, container };
}

/* ------------------------------------------------------------------ runner */

export function createEnv({ chrome, fetch: fetchImpl, pathname = "/challenges", origin = ORIGIN }) {
  const doc = new Doc();
  // Unref timers so a pending auto-hide never keeps the test process alive.
  const timeout = (fn, ms, ...args) => {
    const handle = setTimeout(fn, ms, ...args);
    if (typeof handle?.unref === "function") handle.unref();
    return handle;
  };

  const env = {
    document: doc,
    location: { origin, pathname, href: `${origin}${pathname}`, host: origin.replace(/^https?:\/\//, "") },
    chrome,
    fetch: fetchImpl,
    MutationObserver: makeMutationObserver(doc),
    setTimeout: timeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    console,
    URL,
    structuredClone,
  };
  env.window = env;
  env.self = env;
  return env;
}

export function runContent(env) {
  const source = readFileSync(path.join(ROOT, "dist", "content.js"), "utf8");
  vm.createContext(env);
  vm.runInContext(source, env, { filename: "dist/content.js" });
}

/** Let pending promise chains settle. */
export async function flush(times = 40) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* -------------------------------------------------------------- assertions */

export function badgeTexts(button) {
  const container = button.querySelector(".ctfd-top-badges");
  if (!container) return [];
  return container.children.map((child) => child.textContent);
}

export function badgeColors(button) {
  const container = button.querySelector(".ctfd-top-badges");
  if (!container) return [];
  return container.children.map((child) => child.style.getPropertyValue("--ct-bg"));
}

export function bubbleOf(button) {
  return button.querySelector(".ctfd-top-bubble");
}

export function bubbleText(button) {
  return bubbleOf(button)?.textContent ?? null;
}

/** Challenge ids in DOM order within a row. */
export function orderOf(row) {
  return row.children
    .map((card) => card.querySelector("button.challenge-button"))
    .filter(Boolean)
    .map((button) => Number(button.getAttribute("value")));
}

/** Challenge ids in DOM order across the whole document. */
export function documentOrder(doc) {
  return doc
    .querySelectorAll("button.challenge-button")
    .map((button) => Number(button.getAttribute("value")));
}

export function barButton(doc, className) {
  return doc.querySelector(`.${className}`);
}

export function indicatorText(doc) {
  return doc.querySelector(".ctfd-top-indicator-msg")?.textContent ?? null;
}
