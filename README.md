# CTFd Top Tracker

A cross-browser (Chrome + Firefox) **Manifest V3** extension that annotates a CTFd
`/challenges` page with **which of the top leaderboard players solved each challenge**,
plus a set of solve-analytics overlays: solve-count bubbles, sorting, a solved/unsolved
filter, and a personal progress bar.

It runs **only on sites you explicitly activate**, talks **only** to the CTFd instance you
are already logged into, and never asks for a password or an API token.

---

## What it looks like

Each challenge card gets a row of colored pills — one per tracked player who solved it,
sorted by rank — using the *same* colors CTFd gives those players on its own score graph:

```
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ ⑦                      web  │      │ ①                      pwn  │
│                             │      │                             │
│         Login Form          │      │        Heap Feng Shui       │
│            100              │      │            500              │
│                             │      │                             │
│  (#1 alpha) (#2 bravo)      │      │  (#1 alpha)                 │
└─────────────────────────────┘      └─────────────────────────────┘
   ▲                      ▲             ▲
   │                      │             └─ solve-count bubble: red (fewest solves)
   │                      └─ category label (shown when sorting across categories)
   └─ 7 solves total, greener the more solved
```

Plus, on the challenges page:

- a **sort** button cycling `default → most solved ▾ → least solved ▴`, either within each
  category or across all of them,
- a **filter** button cycling `all → solved only ✓ → unsolved only ✕`,
- a **compare** button, while focusing on one player, showing only the challenges exactly
  one of you has solved,
- a **progress bar** — `12 / 40 tasks solved (30%)` or `2400 / 9000 points earned (26%)`;
  click it (or focus it and press Enter/Space) to switch between the two, which is
  remembered for that site,
- **automatic refresh when you solve something** — the moment CTFd marks one of your
  challenges solved, the badges, solve counts and progress bar catch up on their own,
  without reloading the page,
- a small status pill in the corner reporting what is being tracked, or why it could not
  load.

The four bar buttons — sort, group, filter and compare — are **view state**: they last as
long as the page and reset on reload. The progress bar's metric is the one on-page control
that *is* remembered, being a preference rather than a temporary view.

On a `/users/<id>` or `/teams/<id>` page you also get **Watch** and **Focus** buttons for
that player.

---

## Quick start

```bash
npm install      # dev-only: esbuild, typescript, @types/chrome, web-ext
npm run build    # emits dist/ (Chrome) and dist-firefox/ (Firefox)
```

### Load it in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder

### Load it in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…**
3. Select `dist-firefox/manifest.json`

Then open your CTF, click the toolbar icon, and press **Activate for this site**. The
current tab is instrumented immediately — no reload needed. Activated sites show a red
**CT** badge on the toolbar icon.

### Signing for Firefox

`dist-firefox/` must be signed by Mozilla before it can be installed as anything other
than a temporary add-on (`web-ext sign`, or an upload through
[addons.mozilla.org](https://addons.mozilla.org) for self-distribution). `npm run
lint:firefox` runs the same validator (`addons-linter`, via `web-ext lint`) that signing
runs, against a fresh build, so a clean run here means signing won't bounce the package
back:

```bash
npm run lint:firefox   # rebuilds, then: web-ext lint --source-dir dist-firefox --self-hosted
```

`browser_specific_settings.gecko` also carries `data_collection_permissions: { required:
["none"] }` — a manifest key Firefox now requires from every extension to disclose what
it collects. `"none"` is accurate here: nothing the extension reads or stores ever leaves
`storage.local` or the CTFd origin's own API responses.

**`.github/workflows/sign-firefox.yml`** runs this automatically. On every published
GitHub Release it stamps the release's tag (`v1.2.0` → `1.2.0`) into both manifests,
type-checks, builds, runs the test suite, lints, signs `dist-firefox/` with Mozilla
(`--channel unlisted`, i.e. self-distribution — no AMO listing/review involved), zips
`dist/` for Chrome, and attaches both files to the release. It needs two repository
secrets:

1. Go to [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/en-US/developers/addon/api/key/)
   (sign in with the Firefox Account that should own this extension's signing identity)
   and generate a new API key pair.
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository
   secret**, and add:
   - `AMO_JWT_ISSUER` — the "JWT issuer" shown on that page
   - `AMO_JWT_SECRET` — the paired "JWT secret" (shown once, at generation time)

The manifests in the repo keep whatever version they already have — the workflow's
version stamp is local to that CI run and is never committed back.

---

## How activation works

The extension ships with **no `content_scripts` block at all**. Nothing runs anywhere until
you activate a site; the background worker then registers a dynamic content script scoped to
that one origin.

**Site detection.** A page counts as CTFd if it carries the standard
`Powered by CTFd` footer link (`a[href^="https://ctfd.io"]`), or if its origin is in your
exceptions list. If neither holds, the **Activate** button is disabled — and if that origin
somehow was active, its config is removed and its content script unregistered automatically.

**Exceptions.** Some deployments strip the footer link. The popup's **Add current site**
button adds the origin to the exceptions list *and* activates it in one action.

**API root detection.** The URL prefix is read out of the DOM — the `href` of
`link[rel~="icon"]` (or any stylesheet), truncated at `/themes/`. A root install yields
`""`; an install under `https://example.com/ctf` yields `"/ctf"`. Reading it from the DOM
means it works regardless of the site's CSP, and regardless of where CTFd is mounted.

**Deactivating** removes the site config, unregisters the content script, and restores the
page exactly as it was found: badges, bubbles, labels, the progress bar and the sort bar are
removed, reordered cards go back to their original positions, and filtered-out cards return.

---

## The API it uses

Everything comes from CTFd's own read-only v1 JSON API, same-origin, from the content
script. The DOM is **never** scraped for solve data.

| Endpoint | Role | Defined in CTFd |
|---|---|---|
| `GET /api/v1/scoreboard/top/{N}` | **Primary.** Top-N accounts *with each one's solves* — the whole question answered in **one** request. | `CTFd/api/v1/scoreboard.py` |
| `GET /api/v1/scoreboard` | **Fallback** leaderboard, and the name pool for the popup's autocomplete. | `CTFd/api/v1/scoreboard.py` |
| `GET /api/v1/challenges/{id}/solves` | **Fallback only**, lazily, for visible challenges, memoized. | `CTFd/api/v1/challenges.py` |
| `GET /api/v1/challenges` | **One** request giving every challenge's solve count, category, point value and `solved_by_me`. | `CTFd/api/v1/challenges.py` |

### Cost

The happy path is **two GETs per cache window**, for the whole page:

- one `/api/v1/scoreboard/top/{N}`,
- one `/api/v1/challenges`.

An auto-refresh after your own solve repeats exactly that pair (see
[Refreshing after your own solves](#refreshing-after-your-own-solves)).

There is **no per-player and no per-challenge fan-out**. Solve counts, categories, point
values and "solved by me" all come from that single `/api/v1/challenges` response — never
one call per challenge. The per-challenge `/solves` endpoint is only ever used in fallback
mode, only for challenges actually on screen, and each result is memoized (and cached).

### Fallback chain

1. Plain top-N tracking (no watched users, "show top users" on, focus mode off) tries
   `/api/v1/scoreboard/top/{N}`, with N clamped to `[1, 50]` — CTFd's own cap.
   Source: `scoreboard-top`.
2. If that fails with 403/404 or any other API error — endpoint absent on an older CTFd,
   scores or accounts hidden, logged out, rate-limited — it falls back to
   `/api/v1/scoreboard` plus lazy per-challenge `/solves`. Source: `scoreboard+solves`.
3. Watching users, focus mode, or turning off "show top users" **require** the full
   leaderboard to find a player by name, so those go straight to the fallback path.
4. If everything fails, the error is reported in the status pill and **the CTFd DOM is left
   completely untouched**. The page is never broken.
5. A failing `/api/v1/challenges` degrades silently: no bubbles, no categories, no progress
   bar — everything else keeps working.

### Authentication, CSRF and rate limits

Every request is a **GET** issued with `credentials: "include"`, so your existing CTFd
session cookie is attached automatically.

- **No API key and no CSRF token are needed.** CTFd requires its CSRF nonce for
  state-changing requests; these are all read-only.
- The extension **never asks for, stores, or transmits your password or API token.**
- CTFd's submission rate limiting targets flag attempts (`POST .../attempt`), not these
  read-only GETs. Even so, the caching below keeps the extension to two requests per cache
  window. (A deployment behind its own reverse-proxy rate limiter may still push back — that
  simply produces a status-pill error and an untouched page.)

---

## Caching

The leaderboard and solve batch are cached in `chrome.storage.local` under
`ctfdTop:cache:<origin>` (Maps are serialized to plain objects and rehydrated on restore).

An entry is **discarded** when any of these differ from the current request:

- `origin`
- `topN`
- `watchKey` — watched names, trimmed, lowercased, non-empty, **sorted**, joined with `,`
  (so reordering the watch list does not invalidate anything)
- `showTopUsers`
- `focusKey` — `on:<lowercased name>` while focus mode is on, otherwise `""`

…or when it is older than `cacheDurationSec`, or older than the hard cap of **24 hours** —
whichever comes first, so very stale data can never linger.

Two ways to force a refresh: the **↻** button on the on-page status pill (which preserves
your current sort, group and filter state across the reload), and **Force reload cache** in
the popup.

---

## Refreshing after your own solves

A cache built before you solved a challenge is stale for the one page you care most about,
so the extension notices the solve and refetches by itself (`autoRefreshOnSolve`, on by
default).

**The trigger is the page; the data is always the API.** CTFd marks a challenge you have
solved by putting a `solved-challenge` class on its button — core and core-beta both do,
either by re-rendering the board or by toggling the class in place. The extension watches
for a challenge that *was not* marked a moment ago and *is* now, and treats that purely as a
signal that the API has something new to say. Nothing on screen is ever read off the DOM:
the badges, counts, point values and progress all come from a fresh `/api/v1` round trip.
That means a theme that marks solves optimistically can make the extension refetch early,
but it can never make it display something the server did not confirm.

Because it is only ever a hint, it is deliberately cheap and hard to abuse:

- a challenge that is **already** marked solved when the page loads is history, not news —
  only a genuine unsolved → solved transition counts;
- the refetch waits **1.5 s** so CTFd's own scoreboard and challenge list have settled
  (asking immediately would return the pre-solve numbers);
- solves that land together are **coalesced into one** refetch, and no two auto-refreshes
  happen less than **8 s** apart;
- the cache for the origin is dropped first, so this is a true refetch — the same two GETs
  as a manual **↻** (or, in fallback mode, the same lazy per-challenge pattern);
- the status pill says `Solve detected — refreshing…` before any request goes out.

Turning the setting off in the popup stops the requests but keeps the baseline up to date,
so switching it back on later does not fire for solves that already happened.

---

## Comparing yourself with the focused player

Focus mode already narrows the badges to one player. The **⇄ Compare** button turns that
into a head-to-head: the board keeps only the challenges **exactly one of you has solved**,
hiding both the ones you have each already got and the ones neither of you has touched — so
what is left on screen is precisely the gap between you.

It is a symmetric difference, not a to-do list. Combined with the solved/unsolved filter it
splits into the two halves:

| Compare | Filter | What is left on screen |
| --- | --- | --- |
| on | `all` | everything exactly one of you solved |
| on | `solved ✓` | what **you** solved and they have not |
| on | `unsolved ✕` | what **they** solved and you have not |
| off | any | the ordinary solved/unsolved filter |

The tally goes in the status pill: `Comparing with bravo — 2 only you, 1 only them`.

The button appears in the on-page bar whenever focus mode has actually found its player —
there is nothing to compare against otherwise, so outside focus mode it does not exist. Like
the sort, group and filter buttons it is **view state, not a setting**: it lives as long as
the page does, is never written to storage, and every reload starts from the plain board.

**It costs nothing extra.** Both halves of the comparison are already on hand: your own
solves come from the single `/api/v1/challenges` call, and the focused player's come from
the solve data focus mode fetched anyway. Toggling compare fires **zero** requests. Cards
are removed through the same mechanism as the filter — physically detached, each remembering
where it came from — so switching compare off restores the page exactly, and hidden
challenges stay resolved rather than being refetched when they come back.

A challenge whose solvers are not resolved yet is **never** hidden: an unknown is not
treated as a no.

---

## Settings

All settings are stored **per origin** and applied **live** to any open challenges page.

| Setting | Default | Meaning |
|---|---|---|
| `topN` | `3` | How many leaderboard leaders to track (1–50). |
| `cacheDurationSec` | `3600` | How long cached data stays fresh (15–3600). |
| `showRank` | `true` | Show `#N` on badges. |
| `showName` | `true` | Show the player name on badges. |
| `compact` | `false` | Rank-only badges; the name moves into the tooltip. |
| `showIndicator` | `true` | Show the floating status pill. |
| `watchUsers` | `[]` | Extra players to track by name, whatever their rank. |
| `showTopUsers` | `true` | When off, only watched users are tracked. |
| `focusMode` | `false` | Track exactly one player, overriding top-N and the watch list. |
| `focusUser` | `""` | The focused player's name (matched case-insensitively). |
| `showSolveCount` | `false` | Solve-count bubbles; also enables the sort/group widget. |
| `showSolveFilter` | `false` | Show the solved/unsolved filter button. |
| `showSolveProgress` | `false` | Show the personal progress bar. |
| `solveProgressMetric` | `"tasks"` | `"tasks"` or `"points"`; also toggled by clicking the bar itself. |
| `autoRefreshOnSolve` | `true` | Refetch shortly after CTFd marks one of your challenges solved. |

Settings written by an older version always load with sane values for keys added later:
every read is spread over the current defaults.

**Player selection**, in priority order:

1. **Focus mode** with a name: track only the player whose name matches exactly
   (case-insensitive, trimmed). If nobody matches, nothing is tracked and the pill says so,
   and the compare button — which needs a player to compare against — does not appear.
2. Otherwise the top `topN` players — unless `showTopUsers` is off, which starts from an
   empty set.
3. Then any **watched users** found on the leaderboard that are not already tracked,
   deduplicated by account id and sorted by rank.

---

## Known CTFd version compatibility issues

- **The `color` field is gone.** CTFd 3.5 removed `color` from the scoreboard API. Badge
  colors are therefore computed locally with a faithful reimplementation of `colorHash` from
  `@ctfdio/ctfd-js` — the same function CTFd uses for its Top-10 score graph, keyed on
  `name + id`. Colors match the site's own, and stay stable across pages and sessions.
- **`/api/v1/scoreboard/top/{N}` may not exist** on older CTFd versions. A 404 transparently
  switches to the `scoreboard + per-challenge solves` path; the badges are identical, at the
  cost of one request per visible challenge (memoized and cached).
- **Hidden scores or accounts return 403**, as does being logged out. Same fallback, and if
  the fallback fails too you get an explanatory status pill and an untouched page.
- **Category wrappers.** CTFd wraps each category's header and row in a spacing
  container. When sorting across all categories, the extension hides each emptied branch in
  full — not just its row — and zeroes the lead-in above the surviving one, so collapsed
  categories cannot leave stacked blank space behind. The bounds are computed from the DOM
  (the shared board is never touched), so themes that nest categories differently still work.
- **Custom themes.** The extension targets CTFd's core theme:
  `button.challenge-button[value="<id>"]` with an inner `.challenge-inner`, category rows
  marked `.category-header`, and Bootstrap `col-*` wrappers as the sortable card. That
  selector lives in a single exported constant (`CHALLENGE_BUTTON_SELECTOR` in
  `src/shared/constants.ts`) — adapting to a custom theme is a one-line change. On a theme
  that does not match, the extension simply does nothing rather than misbehaving.
- **Read-only endpoints are outside CTFd's submission rate limits**, which apply to flag
  attempts. The extension is a well-behaved client regardless: two GETs per cache window.
- **Solved markers.** Auto-refresh keys off a class matching `solved` (but not `unsolved`)
  on the challenge button or its card — `solved-challenge` in core and core-beta. A theme
  that signals solves some other way simply never auto-refreshes; the **↻** button and the
  cache window still apply, and nothing else changes.
- **Alpine re-renders.** CTFd rebuilds the challenge list whenever a challenge is solved or
  unsolved. Rendering is driven by a `MutationObserver` debounced at 150 ms, every render
  pass is idempotent and signature-guarded, and the observer is detached while the extension
  writes, so its own changes can never feed back into it. It also watches `class` attributes
  (and only `class`), so a theme that marks a solve in place instead of rebuilding the board
  is noticed too.

---

## Project layout

```
src/
  background.ts            reconcile dynamic content scripts + toolbar badge
  content.ts               detection, activation, observer, Controller, profile buttons
  content/
    api.ts                 CtfdApiClient, ApiError, EndpointUnavailableError
    tracker.ts             ScoreTracker: endpoint choice, player selection, cache
    badges.ts              badge / bubble / spacer / category label rendering
    cards.ts               challenge, card and filter-unit geometry
    sorter.ts              sort + grouping, with original-order restore
    filter.ts              solved/unsolved filtering, plus the compare pass
    bar.ts                 the fixed sort/group/filter/compare bar
    indicator.ts           floating status pill
    progress.ts            personal progress bar
    solve-watch.ts         spots your own new solves and triggers a refetch
  popup/popup.html|.css|.ts
  shared/
    types.ts constants.ts storage.ts colors.ts polyfill.ts
  css/badges.css
  icons/icon.svg + icon16|32|48|128.png
test/                      Node integration tests against the built bundle
manifest.json              Chrome
manifest.firefox.json      Firefox (background.scripts + gecko settings)
build.mjs                  esbuild bundling into dist/ and dist-firefox/
```

**Firefox support** is a five-line shim (`src/shared/polyfill.ts`) imported first by every
entry point: the codebase calls `chrome.*` in promise style, which Chrome MV3 provides
natively and Firefox exposes as `browser.*`, so `globalThis.chrome = browser` on Firefox
makes every `await chrome.*` call work unchanged. On Chrome it is a no-op.

---

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Bundle into `dist/` and `dist-firefox/`. |
| `npm run watch` | Same, rebuilding on change. |
| `npm run typecheck` | `tsc --noEmit` under `strict`. |
| `npm test` | Build, then run every integration test in sequence. |
| `npm run clean` | Remove both output directories. |

`build.mjs` degrades gracefully: if esbuild is not installed but `dist/` already contains
prebuilt JavaScript, it copies the static assets and prints a notice instead of failing. If
neither is available, it exits non-zero with a clear message.

### Tests

The tests `eval` the **actually-built `dist/content.js`** (and `popup.js`, `background.js`)
inside a hand-rolled mock browser — a small DOM with real selector matching, plus mocked
`chrome.storage`, `chrome.runtime`, `chrome.tabs`, `MutationObserver` and `fetch`. They
assert both on rendered output *and* on **how many requests of which kind** were made:

| Test | Covers |
|---|---|
| `01-fast-path` | One `/scoreboard/top/3` call; zero fallback, zero per-challenge calls. |
| `02-fallback-path` | 403 → `/scoreboard` + per-challenge `/solves`, same badges, memoized. |
| `03-watch-user` | A player outside the top N is badged. |
| `04-watch-only` | `showTopUsers: false` badges watched users exclusively. |
| `05-autocomplete` | `ctfd-top-get-users` returns leaderboard names. |
| `06-focus-mode` | Only the focused player is tracked; unknown name reported. |
| `07-profile-buttons` | Watch/Focus buttons appear and toggle settings. |
| `08-solve-counts` | Bubbles, counts and red→green coloring from one request. |
| `09-sort-widget` | Three-state cycle, grouped and flat, default restores exactly. |
| `10-filter-widget` | Three-state solved/unsolved cycle removes and restores cards. |
| `11-progress-bar` | Percentages and labels in both modes; click/Enter/Space toggles and persists. |
| `12-lifecycle` | No requests when inactive; API failure leaves the page untouched; deactivation restores it. |
| `13-cache` | Zero requests within the cache window; ↻ preserves widget state. |
| `14-popup` | Activation, live settings, exceptions, auto-deactivate guard. |
| `15-background` | Registers per active origin, unregisters stale scripts, badges tabs. |
| `16-flat-spacing` | A flat sort collapses emptied category branches whole, leaving no gaps. |
| `17-auto-refresh` | A new solve refetches once (class toggle or re-render); bursts coalesce; the setting and the cooldown both hold it back. |
| `18-compare-mode` | Compare keeps only the difference, composes with the filter, restores the page, costs no extra requests, and does not outlive a reload. |

---

## Privacy

- **All traffic is same-origin.** The content script only ever calls the CTFd instance you
  are already on, using your existing session cookie.
- **Nothing leaves the CTFd site.** There is no telemetry, no analytics, and no third-party
  server of any kind.
- **No credentials are stored.** The extension never asks for, stores, or transmits a
  password or an API token.
- **Nothing runs on sites you have not activated.** A site you have not activated has no
  content script registered for it, so it never sees a single request from the extension.
- Everything the extension keeps — your per-site settings and the cached leaderboard — lives
  in `chrome.storage.local` on your own machine, and is deleted when you deactivate the site.
