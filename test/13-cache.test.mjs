/**
 * Caching: at most one leaderboard request per cache window, invalidated by any
 * change to the tracking key, and bypassed by the indicator's ↻ button.
 */
import assert from "node:assert/strict";
import {
  badgeTexts,
  barButton,
  buildChallengesPage,
  createEnv,
  documentOrder,
  flush,
  makeApi,
  makeChrome,
  ORIGIN,
  runContent,
  seedSite,
  STORAGE_SITES,
} from "./harness.mjs";

const players = [
  { id: 11, name: "alpha", score: 500, solves: [1, 2] },
  { id: 22, name: "bravo", score: 400, solves: [2] },
  { id: 33, name: "charlie", score: 300, solves: [1] },
];
const challenges = [
  { id: 1, name: "A", category: "web", value: 100, solves: 3, solved_by_me: false },
  { id: 2, name: "B", category: "web", value: 200, solves: 7, solved_by_me: false },
];
const layout = [{ name: "web", challenges: [{ id: 1, name: "A" }, { id: 2, name: "B" }] }];

const chrome = makeChrome();
const settings = { topN: 2, cacheDurationSec: 3600, showSolveCount: true };
await seedSite(chrome, settings);

/* ------------------------------------------------------------- first load */
const api1 = makeApi({ players, challenges });
const env1 = createEnv({ chrome, fetch: api1.fetch });
buildChallengesPage(env1.document, layout);
runContent(env1);
await flush();
assert.equal(api1.calls.length, 2, "leaderboard + challenge metadata");

/* ----------------------------------- second page load hits the cache only */
const api2 = makeApi({ players, challenges });
const env2 = createEnv({ chrome, fetch: api2.fetch });
const page2 = buildChallengesPage(env2.document, layout);
runContent(env2);
await flush();

assert.equal(api2.calls.length, 0, "no requests within the cache window");
assert.deepEqual(badgeTexts(page2.buttons.get(1)), ["#1 alpha"], "badges from cache");
assert.deepEqual(badgeTexts(page2.buttons.get(2)), ["#1 alpha", "#2 bravo"]);
assert.equal(page2.buttons.get(2).querySelector(".ctfd-top-bubble").textContent, "7");

/* ------------------------------ ↻ forces a refetch and keeps widget state */
barButton(env2.document, "ctfd-top-sort").click();
await flush();
assert.deepEqual(documentOrder(env2.document), [2, 1], "sorted by solves, descending");
const sortMode = barButton(env2.document, "ctfd-top-sort").getAttribute("data-mode");
const grouped = barButton(env2.document, "ctfd-top-group").getAttribute("data-active");

env2.document.querySelector(".ctfd-top-indicator-btn").click();
await flush();

assert.ok(api2.calls.length >= 1, "↻ bypasses the cache");
assert.equal(barButton(env2.document, "ctfd-top-sort").getAttribute("data-mode"), sortMode);
assert.equal(barButton(env2.document, "ctfd-top-group").getAttribute("data-active"), grouped);
assert.deepEqual(documentOrder(env2.document), [2, 1], "sort survives the refresh");

/* ----------------------------- changing topN invalidates the cached entry */
await chrome.storage.local.set({
  [STORAGE_SITES]: { [ORIGIN]: { active: true, settings: { ...settings, topN: 3 } } },
});
await flush();

const api3 = makeApi({ players, challenges });
const env3 = createEnv({ chrome, fetch: api3.fetch });
const page3 = buildChallengesPage(env3.document, layout);
runContent(env3);
await flush();
assert.equal(api3.calls.length, 0, "the top-N change already refreshed the cache");
assert.deepEqual(
  badgeTexts(page3.buttons.get(1)),
  ["#1 alpha", "#3 charlie"],
  "the third player is now tracked",
);

/* ------------------------- the popup's force-reload message clears the cache */
const response = await chrome.__send({ type: "ctfd-top-force-reload" });
await flush();
assert.equal(response.ok, true);
assert.ok(api3.calls.length >= 2, "force reload refetches");

console.log("ok - caching");
