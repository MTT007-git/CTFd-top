/**
 * Regression: CTFd's core theme wraps each category's header and row in a
 * spacing container. When the flat sort empties a category, hiding only its row
 * left that wrapper's vertical padding behind, stacking into large gaps above
 * and below the surviving row.
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
  ORIGIN,
  orderOf,
  runContent,
  seedSite,
  STORAGE_SITES,
} from "./harness.mjs";

const players = [{ id: 11, name: "alpha", score: 500, solves: [1] }];
const challenges = [
  { id: 1, name: "A", category: "web", value: 100, solves: 8, solved_by_me: false },
  { id: 2, name: "B", category: "web", value: 100, solves: 2, solved_by_me: false },
  { id: 3, name: "C", category: "pwn", value: 100, solves: 5, solved_by_me: false },
  { id: 4, name: "D", category: "misc", value: 100, solves: 9, solved_by_me: false },
];
const layout = [
  { name: "web", challenges: [{ id: 1, name: "A" }, { id: 2, name: "B" }] },
  { name: "pwn", challenges: [{ id: 3, name: "C" }] },
  { name: "misc", challenges: [{ id: 4, name: "D" }] },
];

const chrome = makeChrome();
await seedSite(chrome, { topN: 1, showSolveCount: true });
const api = makeApi({ players, challenges });
const env = createEnv({ chrome, fetch: api.fetch });
const page = buildChallengesPage(env.document, layout, { wrapCategories: true });

runContent(env);
await flush();

const sort = barButton(env.document, "ctfd-top-sort");
// Grouping is on by default every page load; the button is the only way out.
barButton(env.document, "ctfd-top-group").click();
await flush();
const web = page.wrappers.get("web");
const pwn = page.wrappers.get("pwn");
const misc = page.wrappers.get("misc");

/* ------------------------------------------------------------ flat sort */
sort.click();
await flush();
assert.deepEqual(documentOrder(env.document), [4, 1, 3, 2], "one global list");

// The emptied categories are hidden branch and all — not just their rows.
for (const [name, wrapper] of [["pwn", pwn], ["misc", misc]]) {
  assert.equal(
    wrapper.style.getPropertyValue("display"),
    "none",
    `the emptied ${name} wrapper is hidden, so its spacing cannot linger`,
  );
  assert.equal(wrapper.querySelectorAll("button.challenge-button").length, 0);
}

// The surviving branch keeps its cards but loses its leading gap.
assert.equal(web.style.getPropertyValue("display"), "", "the surviving wrapper stays visible");
assert.equal(web.style.getPropertyValue("padding-top"), "0");
assert.equal(web.style.getPropertyValue("margin-top"), "0");
assert.equal(page.rows.get("web").style.getPropertyValue("padding-top"), "0");
assert.equal(web.querySelectorAll("button.challenge-button").length, 4, "all cards live here now");

// Nothing above the surviving branch is touched: the shared board and the page
// header must keep their own spacing.
assert.equal(page.board.style.getPropertyValue("display"), "");
assert.equal(page.board.style.getPropertyValue("padding-top"), "");
assert.equal(page.board.style.getPropertyValue("margin-top"), "");
assert.equal(env.document.body.style.getPropertyValue("padding-top"), "");
assert.equal(page.jumbotron.style.getPropertyValue("display"), "");

/* ------------------------------------------------- reversing then resetting */
sort.click();
await flush();
assert.deepEqual(documentOrder(env.document), [2, 3, 1, 4], "least solved first");
assert.equal(pwn.style.getPropertyValue("display"), "none", "still collapsed while sorted");

sort.click();
await flush();
assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4], "original order restored");
for (const [name, wrapper] of page.wrappers) {
  assert.equal(wrapper.style.getPropertyValue("display"), "", `${name} wrapper shown again`);
  assert.equal(wrapper.style.getPropertyValue("padding-top"), "", `${name} padding restored`);
  assert.equal(wrapper.style.getPropertyValue("margin-top"), "", `${name} margin restored`);
  assert.equal(wrapper.getAttribute("data-ctfd-top-hidden"), null);
  assert.equal(wrapper.getAttribute("data-ctfd-top-padded"), null);
}
assert.deepEqual(orderOf(page.rows.get("web")), [1, 2], "cards returned to their own rows");
assert.deepEqual(orderOf(page.rows.get("pwn")), [3]);
assert.deepEqual(orderOf(page.rows.get("misc")), [4]);
for (const header of env.document.querySelectorAll(".category-header")) {
  assert.equal(header.style.getPropertyValue("display"), "");
}

/* --------------------------- deactivating from a flat-sorted state is clean */
sort.click();
await flush();
assert.equal(pwn.style.getPropertyValue("display"), "none");

await chrome.storage.local.set({ [STORAGE_SITES]: { [ORIGIN]: { active: false, settings: {} } } });
await flush();

for (const [name, wrapper] of page.wrappers) {
  assert.equal(wrapper.style.getPropertyValue("display"), "", `${name} restored on deactivate`);
  assert.equal(wrapper.style.getPropertyValue("padding-top"), "");
  assert.equal(wrapper.style.getPropertyValue("margin-top"), "");
}
assert.deepEqual(orderOf(page.rows.get("web")), [1, 2]);
assert.equal(env.document.querySelectorAll(".ctfd-top-cat").length, 0);

console.log("ok - flat sort spacing");
