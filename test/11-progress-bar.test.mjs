/** Personal progress bar, in both tasks and points modes. */
import assert from "node:assert/strict";
import {
  buildChallengesPage,
  createEnv,
  flush,
  makeApi,
  makeChrome,
  ORIGIN,
  runContent,
  seedSite,
  STORAGE_SITES,
} from "./harness.mjs";

const players = [{ id: 11, name: "alpha", score: 500, solves: [] }];

const challenges = [
  { id: 1, name: "A", category: "web", value: 100, solves: 3, solved_by_me: true },
  { id: 2, name: "B", category: "web", value: 200, solves: 3, solved_by_me: false },
  { id: 3, name: "C", category: "web", value: 300, solves: 3, solved_by_me: true },
  { id: 4, name: "D", category: "web", value: 400, solves: 3, solved_by_me: false },
];

const chrome = makeChrome();
const base = { topN: 1, showSolveProgress: true, solveProgressMetric: "tasks" };
await seedSite(chrome, base);
const api = makeApi({ players, challenges });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  {
    name: "web",
    challenges: [
      { id: 1, name: "A", value: 100 },
      { id: 2, name: "B", value: 200 },
      { id: 3, name: "C", value: 300 },
      { id: 4, name: "D", value: 400 },
    ],
  },
]);

runContent(env);
await flush();

const bar = env.document.querySelector(".ctfd-top-progress");
assert.ok(bar, "the progress bar is inserted");
assert.equal(bar.parentElement, env.document.body);
assert.equal(
  bar.parentElement.children.indexOf(bar),
  bar.parentElement.children.indexOf(page.jumbotron) + 1,
  "the bar sits directly after the page header",
);

const label = () => env.document.querySelector(".ctfd-top-progress-label").textContent;
const fill = () => env.document.querySelector(".ctfd-top-progress-fill").style.getPropertyValue("width");

assert.equal(label(), "2 / 4 tasks solved (50%)");
assert.equal(fill(), "50%");

// ------------------------------------------------------------ points metric
await chrome.storage.local.set({
  [STORAGE_SITES]: {
    [ORIGIN]: { active: true, settings: { ...base, solveProgressMetric: "points" } },
  },
});
await flush();
assert.equal(label(), "400 / 1000 points earned (40%)", "100 + 300 of 1000 points");
assert.equal(fill(), "40%");

// The bar is created once and updated in place.
assert.equal(env.document.querySelectorAll(".ctfd-top-progress").length, 1);

// ------------------------------------------------------ switching it off
await chrome.storage.local.set({
  [STORAGE_SITES]: {
    [ORIGIN]: { active: true, settings: { ...base, showSolveProgress: false } },
  },
});
await flush();
assert.equal(env.document.querySelector(".ctfd-top-progress"), null, "the bar is removed");

console.log("ok - progress bar");
