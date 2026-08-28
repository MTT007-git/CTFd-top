/** Focus mode tracks exactly one player, overriding top-N and the watch list. */
import assert from "node:assert/strict";
import {
  badgeTexts,
  buildChallengesPage,
  createEnv,
  flush,
  indicatorText,
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
await seedSite(chrome, {
  topN: 3,
  focusMode: true,
  focusUser: "  CHARLIE ",
  watchUsers: ["bravo"],
});
const api = makeApi({ players, challenges: [] });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "Login" }, { id: 2, name: "Cipher" }] },
]);

runContent(env);
await flush();

assert.deepEqual(badgeTexts(page.buttons.get(1)), [], "alpha and bravo are ignored under focus");
assert.deepEqual(badgeTexts(page.buttons.get(2)), ["#3 charlie"]);
assert.match(indicatorText(env.document), /Focusing on charlie/);

// Focusing a player who is not on the leaderboard tracks nobody and says so.
const chrome2 = makeChrome();
await seedSite(chrome2, { topN: 3, focusMode: true, focusUser: "nobody" });
const api2 = makeApi({ players, challenges: [] });
const env2 = createEnv({ chrome: chrome2, fetch: api2.fetch });
const page2 = buildChallengesPage(env2.document, [
  { name: "web", challenges: [{ id: 1, name: "Login" }] },
]);
runContent(env2);
await flush();

assert.deepEqual(badgeTexts(page2.buttons.get(1)), []);
assert.match(indicatorText(env2.document), /No player named "nobody" found/);

console.log("ok - focus mode");
