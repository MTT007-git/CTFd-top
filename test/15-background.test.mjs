/**
 * The background worker decides where the extension may run at all: it
 * registers a content script for each active origin and unregisters the rest.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { flush, makeChrome, ORIGIN, STORAGE_SITES } from "./harness.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(path.join(ROOT, "dist", "background.js"), "utf8");
const OTHER = "https://other-ctf.test";
const GONE = "https://gone.example";

const chrome = makeChrome();
await chrome.storage.local.set({
  [STORAGE_SITES]: {
    [ORIGIN]: { active: true, settings: {} },
    [OTHER]: { active: true, settings: {} },
    "https://inactive.example": { active: false, settings: {} },
  },
});

/** Objects come from the vm realm, so copy them before comparing. */
const plain = (value) => (value === undefined ? undefined : { ...value });
const plainAll = (values) => values.map(plain);

const registered = [];
const unregistered = [];
const badges = [];
const colors = [];
const hooks = {};

chrome.scripting.getRegisteredContentScripts = async () => [
  // A script for an origin that is no longer active, plus somebody else's.
  { id: `ctfd-top_${GONE.replace(/[^A-Za-z0-9_-]/g, "_")}`, matches: [`${GONE}/*`] },
  { id: "some-other-extension-script", matches: ["https://unrelated.test/*"] },
];
chrome.scripting.registerContentScripts = async (scripts) => registered.push(...scripts);
chrome.scripting.unregisterContentScripts = async (filter) => unregistered.push(...filter.ids);
chrome.action.setBadgeText = async (details) => badges.push(details);
chrome.action.setBadgeBackgroundColor = async (details) => colors.push(details);
chrome.tabs.query = async () => [
  { id: 1, url: `${ORIGIN}/challenges` },
  { id: 2, url: "https://unrelated.test/" },
];
chrome.tabs.get = async (id) =>
  id === 1 ? { id: 1, url: `${ORIGIN}/challenges` } : { id, url: "https://unrelated.test/" };
chrome.runtime.onInstalled = { addListener: (fn) => (hooks.installed = fn) };
chrome.runtime.onStartup = { addListener: (fn) => (hooks.startup = fn) };
chrome.tabs.onActivated = { addListener: (fn) => (hooks.activated = fn) };
chrome.tabs.onUpdated = { addListener: (fn) => (hooks.updated = fn) };

const env = {
  chrome,
  console,
  URL,
  setTimeout,
  clearTimeout,
  fetch: async () => ({ ok: false, status: 404 }),
};
env.window = env;
env.self = env;
vm.createContext(env);
vm.runInContext(SOURCE, env, { filename: "dist/background.js" });

assert.equal(typeof hooks.installed, "function", "onInstalled is wired");
assert.equal(typeof hooks.startup, "function", "onStartup is wired");

hooks.installed();
await flush();

/* --------------------------------------------------------- registration */
assert.equal(registered.length, 2, "one script per active origin");
const forOrigin = registered.find((script) => script.matches[0] === `${ORIGIN}/*`);
assert.ok(forOrigin, "the active origin is registered");
assert.equal(forOrigin.id, "ctfd-top_https___ctf_example_com");
assert.deepEqual([...forOrigin.js], ["content.js"]);
assert.deepEqual([...forOrigin.css], ["badges.css"]);
assert.equal(forOrigin.runAt, "document_idle");
assert.equal(forOrigin.allFrames, false);
assert.ok(
  registered.some((script) => script.matches[0] === `${OTHER}/*`),
  "the second active origin is registered",
);
assert.ok(
  !registered.some((script) => script.matches[0].includes("inactive")),
  "inactive origins are never registered",
);

/* ------------------------------------------------------- unregistration */
assert.deepEqual(unregistered, [`ctfd-top_${GONE.replace(/[^A-Za-z0-9_-]/g, "_")}`]);
assert.ok(
  !unregistered.includes("some-other-extension-script"),
  "other extensions' scripts are left alone",
);

/* ------------------------------------------------------------- the badge */
assert.deepEqual(
  plain(badges.find((entry) => entry.tabId === 1)),
  { tabId: 1, text: "CT" },
  "activated tabs are badged",
);
assert.deepEqual(
  plain(badges.find((entry) => entry.tabId === 2)),
  { tabId: 2, text: "" },
  "other tabs are cleared",
);
assert.deepEqual(plain(colors.find((entry) => entry.tabId === 1)), {
  tabId: 1,
  color: "#e63946",
});

/* ------------------------------------- the popup's reconcile message works */
const response = await chrome.__send({ type: "ctfd-top-reconcile" });
assert.equal(response.ok, true);

/* ------------------------- a tab switch recomputes the badge for that tab */
badges.length = 0;
hooks.activated({ tabId: 2 });
await flush();
assert.deepEqual(plainAll(badges), [{ tabId: 2, text: "" }]);

badges.length = 0;
hooks.updated(1, { status: "complete" });
await flush();
assert.deepEqual(plainAll(badges), [{ tabId: 1, text: "CT" }]);

badges.length = 0;
hooks.updated(1, { status: "loading" });
await flush();
assert.deepEqual(plainAll(badges), [], "only completed loads trigger a badge update");

console.log("ok - background worker");
