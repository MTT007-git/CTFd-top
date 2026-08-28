/**
 * The solved/unsolved filter cycles all -> solved -> unsolved -> all, removing
 * cards from the DOM rather than hiding them (which would leave empty grid
 * tracks), and restores them faithfully.
 */
import assert from "node:assert/strict";
import {
  barButton,
  buildChallengesPage,
  createEnv,
  documentOrder,
  flush,
  makeApi,
  makeChrome,
  orderOf,
  runContent,
  seedSite,
} from "./harness.mjs";

const players = [{ id: 11, name: "alpha", score: 500, solves: [] }];

const challenges = [
  { id: 1, name: "A", category: "web", value: 100, solves: 3, solved_by_me: true },
  { id: 2, name: "B", category: "web", value: 100, solves: 3, solved_by_me: false },
  { id: 3, name: "C", category: "web", value: 100, solves: 3, solved_by_me: true },
  { id: 4, name: "D", category: "pwn", value: 100, solves: 3, solved_by_me: false },
  { id: 5, name: "E", category: "pwn", value: 100, solves: 3, solved_by_me: true },
  { id: 6, name: "F", category: "pwn", value: 100, solves: 3, solved_by_me: false },
];

const chrome = makeChrome();
// Only the filter is enabled: the bar must appear with just that one button.
await seedSite(chrome, { topN: 1, showSolveFilter: true });
const api = makeApi({ players, challenges });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }] },
  { name: "pwn", challenges: [{ id: 4, name: "D" }, { id: 5, name: "E" }, { id: 6, name: "F" }] },
]);

runContent(env);
await flush();

const filter = barButton(env.document, "ctfd-top-filter");
assert.ok(filter, "the filter button is present");
assert.equal(barButton(env.document, "ctfd-top-sort"), null, "no sort button without bubbles");
assert.equal(barButton(env.document, "ctfd-top-group"), null, "no group button without bubbles");
assert.equal(filter.getAttribute("data-mode"), "all");
assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6]);

// ------------------------------------------------------------- solved only
filter.click();
await flush();
assert.equal(filter.getAttribute("data-mode"), "solved");
assert.deepEqual(documentOrder(env.document), [1, 3, 5]);
assert.deepEqual(orderOf(page.rows.get("web")), [1, 3]);
assert.deepEqual(orderOf(page.rows.get("pwn")), [5]);
// Physically detached, not merely hidden.
assert.equal(page.cards.get(2).parentElement, null);
assert.equal(page.cards.get(2).style.getPropertyValue("display"), "");

// ----------------------------------------------------------- unsolved only
// Switching straight from solved to unsolved must reconsider the cards the
// previous pass removed.
filter.click();
await flush();
assert.equal(filter.getAttribute("data-mode"), "unsolved");
assert.deepEqual(documentOrder(env.document), [2, 4, 6]);
assert.deepEqual(orderOf(page.rows.get("web")), [2]);
assert.deepEqual(orderOf(page.rows.get("pwn")), [4, 6]);
assert.equal(page.cards.get(1).parentElement, null);

// -------------------------------------------------------------------- all
filter.click();
await flush();
assert.equal(filter.getAttribute("data-mode"), "all");
assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6], "original order restored");
assert.deepEqual(orderOf(page.rows.get("web")), [1, 2, 3]);
assert.deepEqual(orderOf(page.rows.get("pwn")), [4, 5, 6]);

console.log("ok - filter widget");
