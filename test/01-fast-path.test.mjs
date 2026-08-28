/**
 * Happy path: one /scoreboard/top/{N} request answers everything.
 * No fallback leaderboard call, no per-challenge fan-out.
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
  { id: 44, name: "delta", score: 100, solves: [1, 2, 3] },
];

const challenges = [
  { id: 1, name: "Login", category: "web", value: 100, solves: 9, solved_by_me: false },
  { id: 2, name: "Cipher", category: "crypto", value: 200, solves: 4, solved_by_me: false },
  { id: 3, name: "Heap", category: "pwn", value: 300, solves: 1, solved_by_me: false },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 3 });
const api = makeApi({ players, challenges });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "Login", value: 100 }] },
  { name: "crypto", challenges: [{ id: 2, name: "Cipher", value: 200 }] },
  { name: "pwn", challenges: [{ id: 3, name: "Heap", value: 300 }] },
]);

runContent(env);
await flush();

// Badges reflect exactly who solved what, in rank order.
assert.deepEqual(badgeTexts(page.buttons.get(1)), ["#1 alpha", "#2 bravo"]);
assert.deepEqual(badgeTexts(page.buttons.get(2)), ["#1 alpha", "#3 charlie"]);
assert.deepEqual(badgeTexts(page.buttons.get(3)), ["#1 alpha", "#2 bravo"]);

// delta is 4th, outside the tracked top 3.
for (const id of [1, 2, 3]) {
  assert.ok(!badgeTexts(page.buttons.get(id)).some((text) => text.includes("delta")));
}

// Exactly one leaderboard request, plus the single challenge-metadata request.
assert.equal(api.count(/\/api\/v1\/scoreboard\/top\/3$/), 1, "one top-N request");
assert.equal(api.count(/\/api\/v1\/scoreboard$/), 0, "no fallback leaderboard request");
assert.equal(api.count(/\/solves$/), 0, "no per-challenge fan-out");
assert.equal(api.count(/\/api\/v1\/challenges$/), 1, "one challenge metadata request");
assert.equal(api.calls.length, 2, "two requests in total");

// Credentials come from the session cookie; nothing else is sent.
for (const call of api.calls) {
  assert.equal(call.init.credentials, "include");
  assert.equal(call.init.cache, "no-store");
  assert.equal(call.init.method, "GET");
  assert.ok(!("body" in call.init));
}

// A CTFd re-render must not refetch, and must not rewrite unchanged badges.
const before = page.buttons.get(1).querySelector(".ctfd-top-badges");
env.document._mutated();
await flush();
await new Promise((resolve) => setTimeout(resolve, 220));
await flush();
assert.equal(api.calls.length, 2, "re-render triggers no new requests");
assert.equal(
  page.buttons.get(1).querySelector(".ctfd-top-badges"),
  before,
  "unchanged badges are not re-created",
);

console.log("ok - fast path");
