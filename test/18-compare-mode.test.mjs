/**
 * Compare mode: while focusing on one player, show only the challenges exactly
 * one of you has solved. It composes with the solved/unsolved filter, costs no
 * extra requests, and restores the page in full when switched off.
 */
import assert from "node:assert/strict";
import {
  barButton,
  buildChallengesPage,
  createEnv,
  documentOrder,
  flush,
  indicatorText,
  makeApi,
  makeChrome,
  runContent,
  seedSite,
  STORAGE_SITES,
  ORIGIN,
} from "./harness.mjs";

// bravo solved 3 and 4; I solved 1, 2 and 3.
//   only me    -> 1, 2      both -> 3      only bravo -> 4      neither -> 5, 6
const players = [
  { id: 11, name: "alpha", score: 500, solves: [1, 2, 3, 4, 5] },
  { id: 22, name: "bravo", score: 400, solves: [3, 4] },
];

const challenges = [
  { id: 1, name: "A", category: "web", value: 100, solves: 5, solved_by_me: true },
  { id: 2, name: "B", category: "web", value: 100, solves: 5, solved_by_me: true },
  { id: 3, name: "C", category: "web", value: 100, solves: 5, solved_by_me: true },
  { id: 4, name: "D", category: "pwn", value: 100, solves: 5, solved_by_me: false },
  { id: 5, name: "E", category: "pwn", value: 100, solves: 5, solved_by_me: false },
  { id: 6, name: "F", category: "pwn", value: 100, solves: 5, solved_by_me: false },
];

const categories = [
  { name: "web", challenges: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }] },
  { name: "pwn", challenges: [{ id: 4, name: "D" }, { id: 5, name: "E" }, { id: 6, name: "F" }] },
];

async function scenario(settings, existing = null) {
  const chrome = existing ?? makeChrome();
  if (!existing) await seedSite(chrome, { topN: 3, ...settings });
  const api = makeApi({ players, challenges });
  const env = createEnv({ chrome, fetch: api.fetch });
  const page = buildChallengesPage(env.document, categories);
  runContent(env);
  await flush();
  return { chrome, api, env, page };
}

/** A page refresh: same stored settings, brand-new document and script run. */
const refresh = (chrome) => scenario(null, chrome);

/* ------------------------------------------------- compare, and the filter */

{
  const { chrome, api, env, page } = await scenario({
    focusMode: true,
    focusUser: "bravo",
    showSolveFilter: true,
  });

  const compare = barButton(env.document, "ctfd-top-compare");
  assert.ok(compare, "focus mode offers the compare button");
  assert.equal(compare.getAttribute("data-active"), "false");
  assert.equal(compare.querySelector(".ctfd-top-btn-text").textContent, "Compare with bravo");
  assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6], "nothing hidden until asked");
  assert.match(indicatorText(env.document), /Focusing on bravo/);

  // Every solve lookup the compare needs is already paid for by the load.
  const solveCalls = api.count(/\/challenges\/\d+\/solves$/);
  assert.equal(solveCalls, 6);

  // ------------------------------------------------------------ compare on
  compare.click();
  await flush();
  assert.equal(compare.getAttribute("data-active"), "true");
  assert.deepEqual(documentOrder(env.document), [1, 2, 4], "only the challenges one of us solved");
  assert.equal(page.cards.get(3).parentElement, null, "the one we both solved is detached");
  assert.equal(page.cards.get(5).parentElement, null, "so is the one neither of us solved");
  assert.equal(compare.querySelector(".ctfd-top-btn-text").textContent, "Only you or bravo");
  assert.equal(
    indicatorText(env.document),
    "Comparing with bravo — 2 only you, 1 only them · scoreboard + per-challenge solves",
  );

  // ------------------------------------------ composed with solved/unsolved
  const filter = barButton(env.document, "ctfd-top-filter");
  filter.click();
  await flush();
  assert.equal(filter.getAttribute("data-mode"), "solved");
  assert.deepEqual(documentOrder(env.document), [1, 2], "solved + compare = mine alone");

  filter.click();
  await flush();
  assert.equal(filter.getAttribute("data-mode"), "unsolved");
  assert.deepEqual(documentOrder(env.document), [4], "unsolved + compare = theirs alone");

  filter.click();
  await flush();
  assert.deepEqual(documentOrder(env.document), [1, 2, 4], "back to the full difference");

  // ----------------------------------------------------------- compare off
  compare.click();
  await flush();
  assert.equal(compare.getAttribute("data-active"), "false");
  assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6], "every card restored in order");
  assert.match(indicatorText(env.document), /Focusing on bravo/);

  assert.equal(
    api.count(/\/challenges\/\d+\/solves$/),
    solveCalls,
    "toggling compare re-reads what we already fetched",
  );
  assert.equal(api.count(/\/api\/v1\/scoreboard$/), 1, "and asks for the leaderboard once");

  // Compare is view state: none of that clicking touched stored settings.
  assert.deepEqual(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings, {
    topN: 3,
    focusMode: true,
    focusUser: "bravo",
    showSolveFilter: true,
  });
}

/* ------------------------------------------- compare alone owns the bar */

{
  const { env } = await scenario({ focusMode: true, focusUser: "bravo" });
  assert.ok(barButton(env.document, "ctfd-top-compare"), "the bar appears for compare alone");
  assert.equal(barButton(env.document, "ctfd-top-sort"), null);
  assert.equal(barButton(env.document, "ctfd-top-group"), null);
  assert.equal(barButton(env.document, "ctfd-top-filter"), null);
}

/* ------------------------------------------------ nobody to compare with */

{
  // There is no focused player, so there is nothing to compare against.
  const { env } = await scenario({ showSolveFilter: true });
  assert.equal(barButton(env.document, "ctfd-top-compare"), null, "no compare outside focus mode");
  assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6]);
}

{
  // Focusing a name nobody on the leaderboard has must not hide anything.
  const { env } = await scenario({ focusMode: true, focusUser: "nobody" });
  assert.equal(barButton(env.document, "ctfd-top-compare"), null, "nobody found, nothing to compare");
  assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6]);
  assert.match(indicatorText(env.document), /No player named "nobody" found/);
}

/* ---------------------------------------- neither toggle survives a reload */

{
  const first = await scenario({
    focusMode: true,
    focusUser: "bravo",
    showSolveCount: true,
  });

  first.env.document.querySelector(".ctfd-top-compare").click();
  first.env.document.querySelector(".ctfd-top-group").click();
  await flush();
  assert.deepEqual(documentOrder(first.env.document), [1, 2, 4], "comparing before the reload");
  assert.equal(barButton(first.env.document, "ctfd-top-group").getAttribute("data-active"), "false");

  // Same storage, fresh document: the board comes back plain and grouped.
  const { env } = await refresh(first.chrome);
  assert.deepEqual(documentOrder(env.document), [1, 2, 3, 4, 5, 6], "compare did not persist");
  assert.equal(barButton(env.document, "ctfd-top-compare").getAttribute("data-active"), "false");
  assert.equal(
    barButton(env.document, "ctfd-top-group").getAttribute("data-active"),
    "true",
    "grouping did not persist either",
  );
  assert.match(indicatorText(env.document), /Focusing on bravo/);
}

console.log("ok - compare mode");
