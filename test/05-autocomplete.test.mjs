/** The popup asks the content script for leaderboard names. */
import assert from "node:assert/strict";
import {
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
  { id: 22, name: "bravo", score: 400, solves: [1] },
  { id: 33, name: "Charlie", score: 300, solves: [] },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 2 });
const api = makeApi({ players, challenges: [] });
const env = createEnv({ chrome, fetch: api.fetch });

buildChallengesPage(env.document, [{ name: "web", challenges: [{ id: 1, name: "Login" }] }]);

runContent(env);
await flush();

const response = await chrome.__send({ type: "ctfd-top-get-users" });
assert.equal(response.ok, true);
// The response crosses a realm boundary, so copy it into a host array first.
assert.deepEqual([...response.users], ["alpha", "bravo", "Charlie"]);

// Names are memoized for five minutes, so a second request costs nothing.
const before = api.count(/\/api\/v1\/scoreboard$/);
const again = await chrome.__send({ type: "ctfd-top-get-users" });
await flush();
assert.deepEqual([...again.users], ["alpha", "bravo", "Charlie"]);
assert.equal(api.count(/\/api\/v1\/scoreboard$/), before, "names are cached");

// An unknown message type is ignored.
assert.equal(await chrome.__send({ type: "something-else" }), undefined);

console.log("ok - autocomplete names");
