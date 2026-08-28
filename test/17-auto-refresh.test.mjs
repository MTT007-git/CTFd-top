/** Auto-refresh when CTFd marks one of your own challenges solved. */
import assert from "node:assert/strict";
import {
  buildChallengesPage,
  bubbleText,
  createEnv,
  flush,
  indicatorText,
  makeApi,
  makeChrome,
  runContent,
  seedSite,
  sleep,
} from "./harness.mjs";

const TOP = /\/scoreboard\/top\//;
const META = /\/api\/v1\/challenges$/;

const cards = [
  { id: 1, name: "A", value: 100 },
  { id: 2, name: "B", value: 200 },
  { id: 3, name: "C", value: 300 },
  { id: 4, name: "D", value: 400 },
];

function meta(overrides = {}) {
  return cards.map((card) => ({
    id: card.id,
    name: card.name,
    category: "web",
    value: card.value,
    solves: 2,
    solved_by_me: false,
    ...(overrides[card.id] ?? {}),
  }));
}

/** A page whose challenge 1 already carries CTFd's solved marker. */
async function scenario(settings) {
  const chrome = makeChrome();
  await seedSite(chrome, { topN: 1, showSolveProgress: true, showSolveCount: true, ...settings });

  const config = {
    players: [{ id: 11, name: "alpha", score: 500, solves: [1] }],
    challenges: meta({ 1: { solves: 5, solved_by_me: true } }),
  };
  const api = makeApi(config);
  const env = createEnv({ chrome, fetch: api.fetch });
  const page = buildChallengesPage(env.document, [{ name: "web", challenges: cards }]);
  page.buttons.get(1).classList.add("solved-challenge");

  runContent(env);
  await flush();

  const label = () => env.document.querySelector(".ctfd-top-progress-label").textContent;
  return { api, config, env, page, label };
}

/** Mark a challenge solved on the page and in the API, the way a real solve does. */
function solve(page, config, id, solves) {
  config.challenges = config.challenges.map((challenge) =>
    challenge.id === id ? { ...challenge, solved_by_me: true, solves } : challenge,
  );
  page.buttons.get(id).classList.add("solved-challenge");
}

/* --------------------------------------------------- one solve, one refetch */
{
  const { api, config, env, page, label } = await scenario({});

  assert.equal(label(), "1 / 4 tasks solved (25%)");
  assert.equal(api.count(TOP), 1, "the happy path is still exactly one leaderboard request");
  assert.equal(api.count(META), 1);
  assert.equal(bubbleText(page.buttons.get(2)), "2");

  // A card that was already marked solved when we arrived is history, not news.
  await sleep(400);
  await flush();
  assert.equal(api.count(META), 1, "no refetch for a challenge that arrived solved");
  assert.match(indicatorText(env.document), /Tracking top 1/);

  solve(page, config, 2, 3);
  await sleep(400);
  await flush();
  assert.equal(
    indicatorText(env.document),
    "Solve detected — refreshing…",
    "the pill announces the refresh before making it",
  );
  assert.equal(api.count(META), 1, "the refetch waits for CTFd to catch up");

  await sleep(1600);
  await flush();
  assert.equal(api.count(TOP), 2, "the leaderboard is refetched once");
  assert.equal(api.count(META), 2, "the challenge metadata is refetched once");
  assert.equal(label(), "2 / 4 tasks solved (50%)", "the progress bar reflects the new solve");
  assert.equal(bubbleText(page.buttons.get(2)), "3", "the solve count is repainted");
  assert.match(indicatorText(env.document), /Tracking top 1/);

  // The cooldown holds the next one back well past the normal settle delay.
  solve(page, config, 3, 4);
  await sleep(1800);
  await flush();
  assert.equal(api.count(META), 2, "a second solve is rate-limited, not fetched immediately");
}

/* ------------------------------------------- a burst collapses into one pass */
{
  const { api, config, page, env, label } = await scenario({});

  solve(page, config, 2, 3);
  solve(page, config, 3, 4);
  await sleep(400);
  await flush();
  assert.equal(
    indicatorText(env.document),
    "2 new solves — refreshing…",
    "both solves are reported together",
  );

  await sleep(1600);
  await flush();
  assert.equal(api.count(TOP), 2, "two solves at once still cost one refetch");
  assert.equal(api.count(META), 2);
  assert.equal(label(), "3 / 4 tasks solved (75%)");
}

/* ----------------------------------------------------- the setting turns off */
{
  const { api, config, page, label } = await scenario({ autoRefreshOnSolve: false });

  solve(page, config, 2, 3);
  await sleep(1900);
  await flush();
  assert.equal(api.count(TOP), 1, "no leaderboard request when auto-refresh is off");
  assert.equal(api.count(META), 1, "no metadata request when auto-refresh is off");
  assert.equal(label(), "1 / 4 tasks solved (25%)", "the page is left as it was");
}

/* ------------------------------- a board re-render is spotted just the same */
{
  const { api, config, env, page, label } = await scenario({});

  // CTFd's core theme rebuilds the board after a solve, so the button we
  // remembered is thrown away and a new one takes its place.
  config.challenges = config.challenges.map((challenge) =>
    challenge.id === 2 ? { ...challenge, solved_by_me: true, solves: 3 } : challenge,
  );
  const stale = page.cards.get(2);
  const card = env.document.createElement("div");
  card.className = "col-md-3 mb-2";
  const button = env.document.createElement("button");
  button.className = "btn btn-dark challenge-button solved-challenge";
  button.setAttribute("value", "2");
  const inner = env.document.createElement("div");
  inner.className = "challenge-inner";
  button.appendChild(inner);
  card.appendChild(button);
  stale.parentElement.insertBefore(card, stale);
  stale.remove();

  await sleep(2000);
  await flush();
  assert.equal(api.count(META), 2, "a replaced card counts as a solve too");
  assert.equal(label(), "2 / 4 tasks solved (50%)");
}

console.log("ok - auto refresh on solve");
