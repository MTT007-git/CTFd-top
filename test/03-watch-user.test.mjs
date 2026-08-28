/** A watched player outside the top N still gets badged. */
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
  { id: 11, name: "alpha", score: 500, solves: [1] },
  { id: 22, name: "bravo", score: 400, solves: [2] },
  { id: 33, name: "charlie", score: 300, solves: [1] },
  { id: 44, name: "Delta", score: 100, solves: [1, 2] },
];

const chrome = makeChrome();
// Watched name given in a different case on purpose.
await seedSite(chrome, { topN: 2, watchUsers: ["delta"] });
const api = makeApi({ players, challenges: [] });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "Login" }, { id: 2, name: "Cipher" }] },
]);

runContent(env);
await flush();

assert.deepEqual(badgeTexts(page.buttons.get(1)), ["#1 alpha", "#4 Delta"]);
assert.deepEqual(badgeTexts(page.buttons.get(2)), ["#2 bravo", "#4 Delta"]);

// Watching a user needs the full leaderboard, so the fast path is skipped outright.
assert.equal(api.count(/\/scoreboard\/top\//), 0, "no top-N request when watching users");
assert.equal(api.count(/\/api\/v1\/scoreboard$/), 1);

console.log("ok - watch user");
