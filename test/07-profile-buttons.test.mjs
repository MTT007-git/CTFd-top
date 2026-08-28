/** Watch / Focus toggles on a profile page write the same per-origin settings. */
import assert from "node:assert/strict";
import {
  buildProfilePage,
  createEnv,
  flush,
  makeApi,
  makeChrome,
  runContent,
  seedSite,
  STORAGE_SITES,
  ORIGIN,
} from "./harness.mjs";

const chrome = makeChrome();
await seedSite(chrome, { topN: 3 });
const api = makeApi({ players: [], challenges: [] });
const env = createEnv({ chrome, fetch: api.fetch, pathname: "/users/42" });

buildProfilePage(env.document, "charlie");

runContent(env);
await flush();

const buttons = env.document.querySelectorAll(".ctfd-top-profile-btn");
assert.equal(buttons.length, 2, "two buttons are added");
const [watch, focus] = buttons;
assert.equal(watch.textContent, "Watch charlie");
assert.equal(focus.textContent, "Focus charlie");

// A profile page must not trigger any leaderboard traffic.
assert.equal(api.calls.length, 0, "no requests on a profile page");
assert.equal(env.document.querySelectorAll(".ctfd-top-badges").length, 0);

watch.click();
await flush();
assert.equal(watch.textContent, "✓ Watching charlie");
assert.deepEqual(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.watchUsers, ["charlie"]);

watch.click();
await flush();
assert.equal(watch.textContent, "Watch charlie");
assert.deepEqual(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.watchUsers, []);

focus.click();
await flush();
assert.equal(focus.textContent, "✓ Focusing on charlie");
const settings = chrome.__store.get(STORAGE_SITES)[ORIGIN].settings;
assert.equal(settings.focusMode, true);
assert.equal(settings.focusUser, "charlie");

focus.click();
await flush();
assert.equal(focus.textContent, "Focus charlie");
assert.equal(chrome.__store.get(STORAGE_SITES)[ORIGIN].settings.focusMode, false);

console.log("ok - profile buttons");
