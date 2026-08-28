/**
 * /scoreboard/top returns 403 (hidden scores, or an older CTFd without the
 * endpoint) -> fall back to /scoreboard plus lazy per-challenge /solves.
 * The rendered result must be identical to the fast path.
 */
import assert from "node:assert/strict";
import {
  badgeTexts,
  buildChallengesPage,
  createEnv,
  flush,
  makeApi,
  makeChrome,
  runContent,
  seedSite,
} from "./harness.mjs";

const players = [
  { id: 11, name: "alpha", score: 500, solves: [1, 2, 3] },
  { id: 22, name: "bravo", score: 400, solves: [1, 3] },
  { id: 33, name: "charlie", score: 300, solves: [2] },
];

const challenges = [
  { id: 1, name: "Login", category: "web", value: 100, solves: 9, solved_by_me: false },
  { id: 2, name: "Cipher", category: "crypto", value: 200, solves: 4, solved_by_me: false },
  { id: 3, name: "Heap", category: "pwn", value: 300, solves: 1, solved_by_me: false },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 3 });
const api = makeApi({ players, challenges, topStatus: 403 });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "Login" }] },
  { name: "crypto", challenges: [{ id: 2, name: "Cipher" }] },
  { name: "pwn", challenges: [{ id: 3, name: "Heap" }] },
]);

runContent(env);
await flush();

assert.deepEqual(badgeTexts(page.buttons.get(1)), ["#1 alpha", "#2 bravo"]);
assert.deepEqual(badgeTexts(page.buttons.get(2)), ["#1 alpha", "#3 charlie"]);
assert.deepEqual(badgeTexts(page.buttons.get(3)), ["#1 alpha", "#2 bravo"]);

assert.equal(api.count(/\/scoreboard\/top\//), 1, "top-N tried once");
assert.equal(api.count(/\/api\/v1\/scoreboard$/), 1, "fell back to the full leaderboard");
// Only the three challenges on the page, one request each.
assert.equal(api.count(/\/solves$/), 3, "one solves request per visible challenge");
for (const id of [1, 2, 3]) {
  assert.equal(api.count(new RegExp(`/challenges/${id}/solves$`)), 1);
}

// Memoized: a re-render must not repeat the per-challenge requests.
const total = api.calls.length;
env.document._mutated();
await flush();
await new Promise((resolve) => setTimeout(resolve, 220));
await flush();
assert.equal(api.calls.length, total, "per-challenge solves are memoized");

console.log("ok - fallback path");
