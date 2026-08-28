/** showTopUsers: false tracks the watch list and nobody else. */
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
  { id: 11, name: "alpha", score: 500, solves: [1, 2] },
  { id: 22, name: "bravo", score: 400, solves: [1] },
  { id: 33, name: "charlie", score: 300, solves: [2] },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 3, showTopUsers: false, watchUsers: ["charlie"] });
const api = makeApi({ players, challenges: [] });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "Login" }, { id: 2, name: "Cipher" }] },
]);

runContent(env);
await flush();

assert.deepEqual(badgeTexts(page.buttons.get(1)), [], "nothing tracked on an unsolved-by-watched challenge");
assert.deepEqual(badgeTexts(page.buttons.get(2)), ["#3 charlie"]);
assert.equal(api.count(/\/scoreboard\/top\//), 0);

console.log("ok - watch only");
