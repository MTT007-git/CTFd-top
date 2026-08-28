import type { SiteSettings } from "./types.js";

export const STORAGE_SITES = "ctfdTop:sites";
export const STORAGE_EXCEPTIONS = "ctfdTop:exceptions";
export const STORAGE_CACHE_PREFIX = "ctfdTop:cache:";

/** CTFd's own cap on `/api/v1/scoreboard/top/{count}`. */
export const MAX_TOP_N = 50;
export const MIN_TOP_N = 1;
export const MIN_CACHE_SEC = 15;
export const MAX_CACHE_SEC = 3600;
/** However long the user asks for, data older than this is never reused. */
export const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS: SiteSettings = {
  topN: 3,
  cacheDurationSec: 3600,
  showRank: true,
  showName: true,
  compact: false,
  showIndicator: true,
  watchUsers: [],
  showTopUsers: true,
  focusMode: false,
  focusUser: "",
  showSolveCount: false,
  showSolveFilter: false,
  showSolveProgress: false,
  solveProgressMetric: "tasks",
  autoRefreshOnSolve: true,
};

/**
 * The one selector that ties us to CTFd's core theme. Adapting the extension to a
 * custom theme should be a one-line change here.
 */
export const CHALLENGE_BUTTON_SELECTOR = "button.challenge-button";
/** Where badges go inside a challenge button, with the button itself as fallback. */
export const CHALLENGE_INNER_SELECTOR = ".challenge-inner";
/** CTFd's native per-category heading rows. */
export const CATEGORY_HEADER_SELECTOR = ".category-header";
/**
 * How a theme marks a challenge the current account has solved. CTFd's core and
 * core-beta themes both use `solved-challenge`; the pattern also covers `solved`
 * and `challenge-solved` without matching `unsolved`.
 */
export const SOLVED_CLASS_PATTERN = /(^|-)solved(-|$)/i;
/** Ancestor that acts as the sortable "card" around a challenge button. */
export const CARD_COLUMN_PATTERN = /\bcol-(xs|sm|md|lg)-\d/;

export const SCRIPT_ID_PREFIX = "ctfd-top_";
export const BADGE_TEXT = "CT";
export const BADGE_COLOR = "#e63946";

/** How long the content script remembers leaderboard names for popup autocomplete. */
export const NAME_CACHE_MS = 5 * 60 * 1000;
/** MutationObserver debounce. */
export const RENDER_DEBOUNCE_MS = 150;
/**
 * How long to wait after spotting a solve before refetching. CTFd updates the
 * scoreboard and the challenge list a moment after the submission lands, so
 * asking immediately would fetch the pre-solve numbers.
 */
export const SOLVE_REFRESH_DELAY_MS = 1500;
/** Never auto-refresh more often than this, however many solves land. */
export const SOLVE_REFRESH_COOLDOWN_MS = 8000;
/** Grace period before complaining that the page has no challenges. */
export const EMPTY_PAGE_NOTICE_MS = 800;

export const INDICATOR_TIMEOUTS = {
  loading: 15000,
  ready: 6000,
  error: 20000,
} as const;

/** Profile pages we decorate with Watch / Focus buttons. */
export const PROFILE_PATH_PATTERN = /^\/(users|teams)\/(\d+)\/?$/;
