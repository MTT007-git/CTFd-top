/**
 * Popup wiring: activation, live settings, exceptions, and the auto-deactivate
 * guard for pages that are not CTFd. Runs the built dist/popup.js.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Doc } from "./dom.mjs";
import { flush, makeChrome, ORIGIN, STORAGE_EXCEPTIONS, STORAGE_SITES } from "./harness.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = readFileSync(path.join(ROOT, "dist", "popup.js"), "utf8");

/** popup.html is real markup; the ids it defines are stubbed on demand here. */
function makePopupEnv(chrome, { isCtfd = true } = {}) {
  const doc = new Doc();
  const registry = new Map();
  doc.getElementById = (id) => {
    let element = registry.get(id);
    if (!element) {
      element = doc.createElement("div");
      element.setAttribute("id", id);
      registry.set(id, element);
      doc.body.appendChild(element);
    }
    return element;
  };

  chrome.tabs.query = async () => [{ id: 7, url: `${ORIGIN}/challenges` }];
  chrome.tabs.sendMessage = async () => ({ ok: true, users: [] });
  chrome.scripting.executeScript = async (options) => {
    if (options.func) return [{ result: isCtfd }];
    injected.push(options.files?.[0]);
    return [{ result: undefined }];
  };
  chrome.scripting.insertCSS = async (options) => {
    injected.push(options.files?.[0]);
  };
  const sent = [];
  chrome.runtime.sendMessage = async (message) => {
    sent.push(message);
    return { ok: true };
  };
  const injected = [];

  const env = {
    document: doc,
    location: { href: "chrome-extension://x/popup.html" },
    chrome,
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    setTimeout: (fn, ms, ...args) => {
      const handle = setTimeout(fn, ms, ...args);
      if (typeof handle?.unref === "function") handle.unref();
      return handle;
    },
    clearTimeout,
    console,
    URL,
  };
  env.window = env;
  return { env, doc, id: doc.getElementById, sent, injected };
}

/* ------------------------------------------------- activating a CTFd site */
{
  const chrome = makeChrome();
  const { env, doc, id, sent, injected } = makePopupEnv(chrome);
  vm.createContext(env);
  vm.runInContext(SOURCE, env, { filename: "dist/popup.js" });
  await flush();

  assert.equal(id("host").textContent, "ctf.example.com");
  assert.equal(id("activate").disabled, false, "activate is enabled on a CTFd page");
  assert.equal(id("warn").hidden, true);
  assert.equal(id("settings-section").hidden, true, "settings stay hidden until activation");
  assert.equal(id("footer").hidden, true);

  id("activate").click();
  await flush();

  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN].active, true, "site activated");
  assert.deepEqual(
    sent.map((message) => message.type),
    ["ctfd-top-reconcile"],
    "the background worker is asked to reconcile",
  );
  assert.deepEqual([...injected].sort(), ["badges.css", "content.js"], "injected into the open tab");
  assert.equal(id("settings-section").hidden, false);
  assert.equal(id("footer").hidden, false);
  assert.equal(id("activate").hidden, true);

  // Defaults are reflected in the form.
  assert.equal(id("topN").value, "3");
  assert.equal(id("cacheDurationSec").value, "3600");
  assert.equal(id("showRank").checked, true);
  assert.equal(id("compact").checked, false);

  // Settings persist per origin, live.
  id("topN").value = "99";
  id("topN").dispatch("change");
  await flush();
  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.topN, 50, "clamped to the cap");

  id("cacheDurationSec").value = "abc";
  id("cacheDurationSec").dispatch("change");
  await flush();
  assert.equal(
    chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.cacheDurationSec,
    15,
    "NaN falls back to the minimum",
  );

  id("compact").checked = true;
  id("compact").dispatch("change");
  await flush();
  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.compact, true);

  // The progress metric radios only matter once the bar is on.
  assert.equal(id("metric-row").hidden, true);
  id("showSolveProgress").checked = true;
  id("showSolveProgress").dispatch("change");
  await flush();
  assert.equal(id("metric-row").hidden, false);
  id("metric-points").dispatch("change");
  await flush();
  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.solveProgressMetric, "points");

  // Watch list.
  id("watch-input").value = "charlie";
  id("watch-add").click();
  await flush();
  assert.deepEqual(
    [...chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.watchUsers],
    ["charlie"],
  );
  assert.equal(id("watch-input").value, "", "the input clears after adding");

  // Removing it again through the rendered list.
  const removeButton = id("watch-list").querySelector(".list-remove");
  assert.ok(removeButton, "the watched name is listed with a remove button");
  removeButton.click();
  await flush();
  assert.deepEqual([...chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.watchUsers], []);

  // Deactivation clears the site entirely.
  id("deactivate").click();
  await flush();
  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN], undefined, "site config removed");
  assert.equal(id("settings-section").hidden, true);
  assert.equal(doc.querySelectorAll("#activate").length, 1);
}

/* --------------------------- a non-CTFd page cannot be activated, and any
                               stale activation is removed automatically     */
{
  const chrome = makeChrome();
  await chrome.storage.local.set({
    [STORAGE_SITES]: { [ORIGIN]: { active: true, settings: {} } },
  });
  const { env, id, sent } = makePopupEnv(chrome, { isCtfd: false });
  vm.createContext(env);
  vm.runInContext(SOURCE, env, { filename: "dist/popup.js" });
  await flush();

  assert.equal(id("activate").disabled, true, "activation is blocked");
  assert.equal(id("warn").hidden, false);
  assert.match(id("warn").textContent, /does not look like a CTFd site/);
  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN], undefined, "auto-deactivated");
  assert.ok(sent.some((message) => message.type === "ctfd-top-reconcile"));

  // Clicking anyway must not activate.
  id("activate").click();
  await flush();
  assert.equal(chrome.__store.get(STORAGE_SITES)?.[ORIGIN], undefined);

  // Adding the site as an exception activates it in one action.
  id("add-exception").click();
  await flush();
  assert.deepEqual([...chrome.__store.get(STORAGE_EXCEPTIONS)], [ORIGIN]);
  assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN].active, true, "exception activates");
  assert.equal(id("settings-section").hidden, false);
}

console.log("ok - popup");
