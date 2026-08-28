/** Per-origin user settings. Every stored copy is read through `mergeSettings`. */
export interface SiteSettings {
  /** How many leaderboard leaders to track (1..MAX_TOP_N). */
  topN: number;
  /** Seconds a cached leaderboard stays fresh (15..3600). */
  cacheDurationSec: number;
  showRank: boolean;
  showName: boolean;
  /** Rank-only badges; the name moves into the tooltip. */
  compact: boolean;
  showIndicator: boolean;
  /** Extra players to track by name, regardless of rank. */
  watchUsers: string[];
  /** When false, only watched users are tracked. */
  showTopUsers: boolean;
  /** Track exactly one player, overriding top-N and the watch list. */
  focusMode: boolean;
  focusUser: string;
  /** Solve-count bubbles; also gates the sort/group widget. */
  showSolveCount: boolean;
  showSolveFilter: boolean;
  showSolveProgress: boolean;
  solveProgressMetric: ProgressMetric;
  /** Refetch automatically when the page shows that you just solved something. */
  autoRefreshOnSolve: boolean;
}

export type ProgressMetric = "tasks" | "points";

export interface SiteConfig {
  active: boolean;
  settings: SiteSettings;
}

/** `ctfdTop:sites` — keyed by origin, e.g. `https://ctf.example.com`. */
export type SitesMap = Record<string, SiteConfig>;

/** Which endpoint combination produced the current data. */
export type LeaderboardSource = "scoreboard-top" | "scoreboard+solves";

/** One leaderboard entry, whether or not we end up tracking it. */
export interface LeaderboardEntry {
  id: number;
  name: string;
  rank: number;
  score: number;
  bracket: string;
}

/** A leaderboard entry we are actually rendering badges for. */
export interface TrackedPlayer extends LeaderboardEntry {
  /** CTFd-compatible `colorHash(name + id)` result. */
  color: string;
}

/** Per-challenge metadata from a single `/api/v1/challenges` call. */
export interface ChallengeMeta {
  id: number;
  solves: number | null;
  category: string;
  solvedByMe: boolean;
  value: number | null;
}

/** Cache payload stored under `ctfdTop:cache:<origin>`. Maps are plain objects here. */
export interface CachedPayload {
  origin: string;
  topN: number;
  watchKey: string;
  showTopUsers: boolean;
  focusKey: string;
  generatedAt: number;
  source: LeaderboardSource;
  players: TrackedPlayer[];
  /** challenge id -> tracked account ids that solved it */
  solvedByChallenge: Record<string, number[]>;
  solvesPerChallenge: Record<string, number>;
  categoriesPerChallenge: Record<string, string>;
  solvedByMe: Record<string, boolean>;
  valuesPerChallenge: Record<string, number>;
}

/** The parts of a request that invalidate the cache when they change. */
export interface CacheKeyParts {
  origin: string;
  topN: number;
  watchKey: string;
  showTopUsers: boolean;
  focusKey: string;
}

export type SortMode = "default" | "desc" | "asc";
export type FilterMode = "all" | "solved" | "unsolved";
export type IndicatorState = "loading" | "ready" | "error";

export interface ReconcileMessage {
  type: "ctfd-top-reconcile";
}
export interface ForceReloadMessage {
  type: "ctfd-top-force-reload";
}
export interface GetUsersMessage {
  type: "ctfd-top-get-users";
}
export type ExtensionMessage = ReconcileMessage | ForceReloadMessage | GetUsersMessage;
