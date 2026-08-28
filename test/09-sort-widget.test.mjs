/**
 * The sort button cycles default -> most solved -> least solved -> default,
 * grouped by category or flat, using only cached counts.
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
  { id: 1, name: "A", category: "web", value: 100, solves: 10, solved_by_me: false },
  { id: 2, name: "B", category: "web", value: 100, solves: 2, solved_by_me: false },
  { id: 3, name: "C", category: "web", value: 100, solves: 6, solved_by_me: false },
  { id: 4, name: "D", category: "pwn", value: 100, solves: 1, solved_by_me: false },
  { id: 5, name: "E", category: "pwn", value: 100, solves: 9, solved_by_me: false },
  { id: 6, name: "F", category: "pwn", value: 100, solves: 5, solved_by_me: false },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 1, showSolveCount: true });
const api = makeApi({ players, challenges });
const env = createEnv({ chrome, fetch: api.fetch });

const page = buildChallengesPage(env.document, [
  { name: "web", challenges: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }] },
  { name: "pwn", challenges: [{ id: 4, name: "D" }, { id: 5, name: "E" }, { id: 6, name: "F" }] },
]);

runContent(env);
await flush();

const web = page.rows.get("web");
const pwn = page.rows.get("pwn");
const sort = barButton(env.document, "ctfd-top-sort");
const group = barButton(env.document, "ctfd-top-group");
const requestsAfterLoad = api.calls.length;

assert.ok(sort, "the sort button is present when bubbles are on");
assert.ok(group, "the group button is present");
assert.equal(sort.getAttribute("data-mode"), "default");
assert.equal(group.getAttribute("data-active"), "true", "grouped by category by default");
assert.deepEqual(orderOf(web), [1, 2, 3]);
assert.deepEqual(orderOf(pwn), [4, 5, 6]);

// -------------------------------------------------- grouped, most solved first
sort.click();
await flush();
assert.equal(sort.getAttribute("data-mode"), "desc");
assert.deepEqual(orderOf(web), [1, 3, 2], "web sorted 10, 6, 2");
assert.deepEqual(orderOf(pwn), [5, 6, 4], "pwn sorted 9, 5, 1");
assert.equal(env.document.querySelectorAll(".ctfd-top-cat").length, 0, "no card labels while grouped");

// ------------------------------------------------- grouped, least solved first
sort.click();
await flush();
assert.equal(sort.getAttribute("data-mode"), "asc");
assert.deepEqual(orderOf(web), [2, 3, 1]);
assert.deepEqual(orderOf(pwn), [4, 6, 5]);

// ------------------------------------------------------------- back to default
sort.click();
await flush();
assert.equal(sort.getAttribute("data-mode"), "default");
assert.deepEqual(orderOf(web), [1, 2, 3], "original order restored");
assert.deepEqual(orderOf(pwn), [4, 5, 6]);

// ------------------------------------------------------- ungrouped (flat) sort
group.click();
await flush();
sort.click();
await flush();
assert.equal(group.getAttribute("data-active"), "false");
assert.equal(sort.getAttribute("data-mode"), "desc");
assert.deepEqual(
  documentOrder(env.document),
  [1, 5, 3, 6, 2, 4],
  "one global list sorted across categories",
);
assert.equal(orderOf(pwn).length, 0, "the emptied row holds no cards");
assert.equal(pwn.style.getPropertyValue("display"), "none", "the emptied row is hidden");
assert.equal(web.style.getPropertyValue("padding-top"), "0", "no leading gap");
for (const header of env.document.querySelectorAll(".category-header")) {
  assert.equal(header.style.getPropertyValue("display"), "none", "native headers are hidden");
}
// Categories stay recognizable through per-card labels.
assert.equal(env.document.querySelectorAll(".ctfd-top-cat").length, 6);
assert.equal(page.buttons.get(5).querySelector(".ctfd-top-cat").textContent, "pwn");

// --------------------------------------------- flat ascending, then full reset
sort.click();
await flush();
assert.deepEqual(documentOrder(env.document), [4, 2, 6, 3, 5, 1]);

sort.click();
await flush();
assert.equal(sort.getAttribute("data-mode"), "default");
assert.deepEqual(orderOf(web), [1, 2, 3], "cards moved between rows are returned");
assert.deepEqual(orderOf(pwn), [4, 5, 6]);
assert.equal(pwn.style.getPropertyValue("display"), "", "hidden rows are shown again");
assert.equal(web.style.getPropertyValue("padding-top"), "");
assert.equal(env.document.querySelectorAll(".ctfd-top-cat").length, 0);
for (const header of env.document.querySelectorAll(".category-header")) {
  assert.equal(header.style.getPropertyValue("display"), "");
}

// Sorting is pure DOM work against cached counts.
assert.equal(api.calls.length, requestsAfterLoad, "sorting issues no requests");

/* ------------------------------------------------------------------------
   A challenge missing from /api/v1/challenges has no known count: it gets no
   bubble, and it sorts last in *both* directions.
   ------------------------------------------------------------------------ */
{
  const chrome2 = makeChrome();
  await seedSite(chrome2, { topN: 1, showSolveCount: true });
  const api2 = makeApi({
    players,
    challenges: [
      { id: 1, name: "A", category: "web", value: 100, solves: 8, solved_by_me: false },
      { id: 2, name: "B", category: "web", value: 100, solves: 2, solved_by_me: false },
    ],
  });
  const env2 = createEnv({ chrome: chrome2, fetch: api2.fetch });
  const page2 = buildChallengesPage(env2.document, [
    {
      name: "web",
      challenges: [{ id: 1, name: "A" }, { id: 9, name: "Unlisted" }, { id: 2, name: "B" }],
    },
  ]);
  runContent(env2);
  await flush();

  assert.equal(page2.buttons.get(9).querySelector(".ctfd-top-bubble"), null, "no bubble without a count");
  assert.equal(page2.buttons.get(1).querySelector(".ctfd-top-bubble").textContent, "8");

  const sort2 = barButton(env2.document, "ctfd-top-sort");
  sort2.click();
  await flush();
  assert.deepEqual(documentOrder(env2.document), [1, 2, 9], "unknown last when descending");
  sort2.click();
  await flush();
  assert.deepEqual(documentOrder(env2.document), [2, 1, 9], "unknown last when ascending too");
}

console.log("ok - sort widget");
