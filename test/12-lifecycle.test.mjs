/**
 * The guarantees that matter most:
 *   - a site the user has not activated sees zero requests
 *   - an API failure leaves the CTFd DOM untouched
 *   - deactivating restores the page exactly
 */
import assert from "node:assert/strict";
import {
  badgeTexts,
  barButton,
  buildChallengesPage,
  createEnv,
  documentOrder,
  flush,
  indicatorText,
  makeApi,
  makeChrome,
  ORIGIN,
  orderOf,
  runContent,
  seedSite,
  STORAGE_SITES,
} from "./harness.mjs";

const players = [{ id: 11, name: "alpha", score: 500, solves: [1, 2] }];
const challenges = [
  { id: 1, name: "A", category: "web", value: 100, solves: 7, solved_by_me: true },
  { id: 2, name: "B", category: "web", value: 200, solves: 3, solved_by_me: false },
];
const layout = [
  { name: "web", challenges: [{ id: 1, name: "A" }, { id: 2, name: "B" }] },
];

/* ------------------------------------- 1. an inactive site is never touched */
{
  const chrome = makeChrome();
  const api = makeApi({ players, challenges });
  const env = createEnv({ chrome, fetch: api.fetch });
  const page = buildChallengesPage(env.document, layout);

  runContent(env);
  await flush();

  assert.equal(api.calls.length, 0, "no requests on a site that was never activated");
  assert.deepEqual(badgeTexts(page.buttons.get(1)), []);
  assert.equal(env.document.querySelector(".ctfd-top-indicator"), null);
  assert.equal(env.document.querySelector(".ctfd-top-bar"), null);
}

/* ------------------- 2. an activated page without the CTFd footer is skipped */
{
  const chrome = makeChrome();
  await seedSite(chrome, { topN: 1 });
  const api = makeApi({ players, challenges });
  const env = createEnv({ chrome, fetch: api.fetch });
  const page = buildChallengesPage(env.document, layout, { footer: false });

  runContent(env);
  await flush();

  assert.equal(api.calls.length, 0, "no requests without a CTFd marker or an exception");
  assert.deepEqual(badgeTexts(page.buttons.get(1)), []);
}

/* ---------------------------- 3. a total API failure leaves the page as-is */
{
  const chrome = makeChrome();
  await seedSite(chrome, { topN: 1, showSolveCount: true });
  const api = makeApi({
    players,
    challenges,
    topStatus: 403,
    scoreboardStatus: 403,
    challengesStatus: 403,
  });
  const env = createEnv({ chrome, fetch: api.fetch });
  const page = buildChallengesPage(env.document, layout);

  runContent(env);
  await flush();

  assert.deepEqual(badgeTexts(page.buttons.get(1)), [], "no badges");
  assert.equal(page.buttons.get(1).querySelector(".ctfd-top-bubble"), null, "no bubbles");
  assert.equal(env.document.querySelector(".ctfd-top-bar"), null, "no sort bar");
  assert.deepEqual(documentOrder(env.document), [1, 2], "order untouched");
  assert.match(indicatorText(env.document), /Unable to load leaderboard \(HTTP 403\)/);
  assert.match(indicatorText(env.document), /may be hidden, or you may be logged out/);
}

/* --------------------------------- 4. deactivating restores the page fully */
{
  const chrome = makeChrome();
  await seedSite(chrome, {
    topN: 1,
    showSolveCount: true,
    showSolveFilter: true,
    showSolveProgress: true,
  });
  const api = makeApi({ players, challenges });
  const env = createEnv({ chrome, fetch: api.fetch });
  const page = buildChallengesPage(env.document, layout);

  runContent(env);
  await flush();

  // Put the page into a thoroughly modified state first: flat sort (which adds
  // per-card category labels), then filtered.
  barButton(env.document, "ctfd-top-group").click();
  await flush();
  barButton(env.document, "ctfd-top-sort").click();
  await flush();
  barButton(env.document, "ctfd-top-filter").click();
  await flush();
  assert.deepEqual(documentOrder(env.document), [1], "sorted and filtered down to the solved one");
  assert.ok(env.document.querySelector(".ctfd-top-progress"));
  assert.ok(env.document.querySelector(".ctfd-top-badges"));

  await chrome.storage.local.set({ [STORAGE_SITES]: { [ORIGIN]: { active: false, settings: {} } } });
  await flush();

  for (const selector of [
    ".ctfd-top-badges",
    ".ctfd-top-bubble",
    ".ctfd-top-space",
    ".ctfd-top-cat",
    ".ctfd-top-bar",
    ".ctfd-top-progress",
    ".ctfd-top-indicator",
  ]) {
    assert.equal(env.document.querySelectorAll(selector).length, 0, `${selector} removed`);
  }
  assert.deepEqual(orderOf(page.rows.get("web")), [1, 2], "cards back in their original order");
  assert.equal(page.rows.get("web").style.getPropertyValue("padding-top"), "");
  for (const button of env.document.querySelectorAll("button.challenge-button")) {
    assert.equal(button.getAttribute("data-ctfd-top-sig"), null);
    assert.equal(button.getAttribute("data-ctfd-top-solves-sig"), null);
  }
  for (const header of env.document.querySelectorAll(".category-header")) {
    assert.equal(header.style.getPropertyValue("display"), "");
  }
}

/* ------------- 5. a page with no challenges says so, without breaking */
{
  const chrome = makeChrome();
  await seedSite(chrome, { topN: 1 });
  const api = makeApi({ players, challenges });
  const env = createEnv({ chrome, fetch: api.fetch });
  buildChallengesPage(env.document, []);

  runContent(env);
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 900));
  await flush();

  assert.equal(
    indicatorText(env.document),
    "No challenges on this page yet — log in to CTFd if required.",
  );
}

console.log("ok - lifecycle");
