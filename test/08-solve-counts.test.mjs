/**
 * Solve-count bubbles come from one /api/v1/challenges call and are colored
 * red (fewest) to green (most) across the challenges on the page.
 */
import assert from "node:assert/strict";
import {
  buildChallengesPage,
  bubbleOf,
  bubbleText,
  createEnv,
  flush,
  makeApi,
  makeChrome,
  runContent,
  seedSite,
} from "./harness.mjs";

const players = [{ id: 11, name: "alpha", score: 500, solves: [1] }];

const challenges = [
  { id: 1, name: "Login", category: "web", value: 100, solves: 10, solved_by_me: false },
  { id: 2, name: "Cipher", category: "web", value: 200, solves: 5, solved_by_me: false },
  { id: 3, name: "Heap", category: "web", value: 300, solves: 0, solved_by_me: false },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 1, showSolveCount: true });
const api = makeApi({ players, challenges });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  {
    name: "web",
    challenges: [
      { id: 1, name: "Login" },
      { id: 2, name: "Cipher" },
      { id: 3, name: "Heap" },
    ],
  },
]);

runContent(env);
await flush();

assert.equal(bubbleText(page.buttons.get(1)), "10");
assert.equal(bubbleText(page.buttons.get(2)), "5");
assert.equal(bubbleText(page.buttons.get(3)), "0");

// hue = 120 * (count - min) / (max - min), clamped to [0, 120].
assert.equal(bubbleOf(page.buttons.get(1)).style.getPropertyValue("--ct-bg"), "hsl(120 70% 40%)");
assert.equal(bubbleOf(page.buttons.get(2)).style.getPropertyValue("--ct-bg"), "hsl(60 70% 40%)");
assert.equal(bubbleOf(page.buttons.get(3)).style.getPropertyValue("--ct-bg"), "hsl(0 70% 40%)");

assert.equal(bubbleOf(page.buttons.get(1)).getAttribute("title"), "10 solves");
assert.equal(bubbleOf(page.buttons.get(3)).getAttribute("title"), "0 solves");

// A spacer keeps the bubble clear of the challenge name.
assert.equal(page.buttons.get(1).querySelectorAll(".ctfd-top-space").length, 1);

// One request for every count on the page — never one per challenge.
assert.equal(api.count(/\/api\/v1\/challenges$/), 1);
assert.equal(api.count(/\/solves$/), 0);

// Idempotent: re-rendering does not replace the bubble element.
const bubble = bubbleOf(page.buttons.get(1));
env.document._mutated();
await flush();
await new Promise((resolve) => setTimeout(resolve, 220));
await flush();
assert.equal(bubbleOf(page.buttons.get(1)), bubble);

console.log("ok - solve counts");
