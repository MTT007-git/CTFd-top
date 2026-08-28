import { MAX_CACHE_AGE_MS, NAME_CACHE_MS } from "../shared/constants.js";
import { playerColor } from "../shared/colors.js";
import {
  clampTopN,
  focusKeyOf,
  getCache,
  normalizeName,
  setCache,
  watchKeyOf,
} from "../shared/storage.js";
import type {
  CacheKeyParts,
  CachedPayload,
  LeaderboardEntry,
  LeaderboardSource,
  SiteSettings,
  TrackedPlayer,
} from "../shared/types.js";
import { ApiError, CtfdApiClient } from "./api.js";

function toTracked(entry: LeaderboardEntry): TrackedPlayer {
  return { ...entry, color: playerColor(entry.name, entry.id) };
}

function toNumberMap<T>(record: Record<string, T> | undefined): Map<number, T> {
  const map = new Map<number, T>();
  if (!record || typeof record !== "object") return map;
  for (const [key, value] of Object.entries(record)) {
    const id = Number(key);
    if (Number.isFinite(id)) map.set(id, value);
  }
  return map;
}

function fromNumberMap<T>(map: Map<number, T>): Record<string, T> {
  const record: Record<string, T> = {};
  for (const [key, value] of map) record[String(key)] = value;
  return record;
}

/**
 * Owns the leaderboard data for one origin: which endpoints to use, what to
 * cache, and which players to badge.
 */
export class ScoreTracker {
  readonly origin: string;
  private readonly api: CtfdApiClient;
  private settings: SiteSettings;

  players: TrackedPlayer[] = [];
  /** challenge id -> tracked account ids. A missing key means "not resolved yet". */
  solvedByChallenge = new Map<number, Set<number>>();
  solvesPerChallenge = new Map<number, number>();
  categoriesPerChallenge = new Map<number, string>();
  solvedByMe = new Map<number, boolean>();
  valuesPerChallenge = new Map<number, number>();
  source: LeaderboardSource = "scoreboard-top";
  generatedAt = 0;
  /** True on the fast path, where one request already told us every solve. */
  private resolvedAll = false;
  /** Full leaderboard, only fetched on the fallback path. */
  private leaderboard: LeaderboardEntry[] = [];
  private names: { at: number; values: string[] } | null = null;

  constructor(origin: string, apiRoot: string, settings: SiteSettings) {
    this.origin = origin;
    this.api = new CtfdApiClient(apiRoot);
    this.settings = settings;
  }

  setSettings(settings: SiteSettings): void {
    this.settings = settings;
  }

  private cacheKey(): CacheKeyParts {
    return {
      origin: this.origin,
      topN: clampTopN(this.settings.topN),
      watchKey: watchKeyOf(this.settings.watchUsers),
      showTopUsers: this.settings.showTopUsers === true,
      focusKey: focusKeyOf(this.settings),
    };
  }

  /**
   * Watching users, focus mode and "hide top users" all need the full
   * leaderboard to locate a player by name, so they skip the fast path.
   */
  private needsFullLeaderboard(): boolean {
    if (this.settings.focusMode) return true;
    if (!this.settings.showTopUsers) return true;
    return watchKeyOf(this.settings.watchUsers).length > 0;
  }

  /** Load from cache when possible, otherwise fetch. Throws only if the leaderboard fails. */
  async load(force: boolean): Promise<void> {
    const key = this.cacheKey();
    if (!force) {
      const cached = await getCache(this.origin);
      if (cached && this.cacheUsable(cached, key)) {
        this.restore(cached);
        return;
      }
    }

    this.reset();
    if (this.needsFullLeaderboard()) {
      await this.loadFallback();
    } else {
      try {
        await this.loadFast(key.topN);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        console.debug("[ctfd-top] scoreboard/top unavailable, falling back:", error.message);
        await this.loadFallback();
      }
    }

    // Solve counts, categories, point values and "solved by me" all come from
    // this single call. Losing it costs those overlays and nothing else.
    try {
      const challenges = await this.api.challenges();
      for (const challenge of challenges) {
        if (challenge.solves !== null) this.solvesPerChallenge.set(challenge.id, challenge.solves);
        if (challenge.category) this.categoriesPerChallenge.set(challenge.id, challenge.category);
        this.solvedByMe.set(challenge.id, challenge.solvedByMe);
        if (challenge.value !== null) this.valuesPerChallenge.set(challenge.id, challenge.value);
      }
    } catch (error) {
      console.debug("[ctfd-top] challenge metadata unavailable:", String(error));
    }

    this.generatedAt = Date.now();
    await this.persist();
  }

  private reset(): void {
    this.players = [];
    this.solvedByChallenge = new Map();
    this.solvesPerChallenge = new Map();
    this.categoriesPerChallenge = new Map();
    this.solvedByMe = new Map();
    this.valuesPerChallenge = new Map();
    this.leaderboard = [];
    this.resolvedAll = false;
  }

  /** One request: top-N accounts and all of their solves. */
  private async loadFast(topN: number): Promise<void> {
    const entries = await this.api.scoreboardTop(topN);
    const tracked = entries.slice(0, topN);
    this.players = tracked.map(toTracked);
    for (const entry of tracked) {
      for (const challengeId of entry.solves) {
        let solvers = this.solvedByChallenge.get(challengeId);
        if (!solvers) {
          solvers = new Set<number>();
          this.solvedByChallenge.set(challengeId, solvers);
        }
        solvers.add(entry.id);
      }
    }
    this.source = "scoreboard-top";
    this.resolvedAll = true;
  }

  /** Full leaderboard now; per-challenge solves later, lazily and only for what is on screen. */
  private async loadFallback(): Promise<void> {
    this.leaderboard = await this.api.scoreboard();
    this.rememberNames(this.leaderboard);
    this.players = selectPlayers(this.leaderboard, this.settings).map(toTracked);
    this.source = "scoreboard+solves";
    this.resolvedAll = false;
  }

  /**
   * Fallback mode only: resolve the challenges actually visible on the page,
   * memoizing each result (including failures) so a re-render never refetches.
   */
  async ensureSolves(challengeIds: readonly number[]): Promise<void> {
    if (this.resolvedAll || this.players.length === 0) return;
    const missing = challengeIds.filter((id) => !this.solvedByChallenge.has(id));
    if (missing.length === 0) return;

    const trackedIds = new Set(this.players.map((player) => player.id));
    await Promise.all(
      missing.map(async (challengeId) => {
        const solvers = new Set<number>();
        try {
          for (const solver of await this.api.challengeSolves(challengeId)) {
            if (trackedIds.has(solver.accountId)) solvers.add(solver.accountId);
          }
        } catch (error) {
          console.debug(`[ctfd-top] solves for ${challengeId} unavailable:`, String(error));
        }
        this.solvedByChallenge.set(challengeId, solvers);
      }),
    );
    await this.persist();
  }

  /**
   * The single player focus mode selected, or null when focus mode is off or
   * the name matched nobody on the leaderboard.
   */
  focusedPlayer(): TrackedPlayer | null {
    if (!this.settings.focusMode || !normalizeName(this.settings.focusUser)) return null;
    return this.players[0] ?? null;
  }

  /**
   * Whether one tracked player solved one challenge. `null` means "not looked
   * up yet" — callers must treat that as unknown rather than as a no.
   */
  solvedBy(challengeId: number, accountId: number): boolean | null {
    const solvers = this.solvedByChallenge.get(challengeId);
    if (solvers) return solvers.has(accountId);
    // On the fast path a single request told us every solve, so a challenge
    // with no entry really is one nobody tracked solved.
    return this.resolvedAll ? false : null;
  }

  /** Players who solved a challenge, in rank order. */
  solversOf(challengeId: number): TrackedPlayer[] {
    const solvers = this.solvedByChallenge.get(challengeId);
    if (!solvers || solvers.size === 0) return [];
    return this.players.filter((player) => solvers.has(player.id));
  }

  /** Every leaderboard name, for the popup's autocomplete. Memoized for 5 minutes. */
  async allNames(): Promise<string[]> {
    if (this.names && Date.now() - this.names.at < NAME_CACHE_MS) return this.names.values;
    const board = await this.api.scoreboard();
    this.rememberNames(board);
    return this.names ? this.names.values : [];
  }

  private rememberNames(board: readonly LeaderboardEntry[]): void {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const entry of board) {
      const key = normalizeName(entry.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      values.push(entry.name);
    }
    this.names = { at: Date.now(), values };
  }

  private cacheUsable(cached: CachedPayload, key: CacheKeyParts): boolean {
    if (cached.origin !== key.origin) return false;
    if (cached.topN !== key.topN) return false;
    if (cached.watchKey !== key.watchKey) return false;
    if (cached.showTopUsers !== key.showTopUsers) return false;
    if (cached.focusKey !== key.focusKey) return false;
    const age = Date.now() - Number(cached.generatedAt);
    if (!Number.isFinite(age) || age < 0) return false;
    if (age > this.settings.cacheDurationSec * 1000) return false;
    return age <= MAX_CACHE_AGE_MS;
  }

  private restore(cached: CachedPayload): void {
    this.players = Array.isArray(cached.players) ? cached.players : [];
    this.solvedByChallenge = new Map(
      Object.entries(cached.solvedByChallenge ?? {})
        .map(([key, ids]) => [Number(key), new Set(Array.isArray(ids) ? ids : [])] as const)
        .filter(([id]) => Number.isFinite(id)),
    );
    this.solvesPerChallenge = toNumberMap(cached.solvesPerChallenge);
    this.categoriesPerChallenge = toNumberMap(cached.categoriesPerChallenge);
    this.solvedByMe = toNumberMap(cached.solvedByMe);
    this.valuesPerChallenge = toNumberMap(cached.valuesPerChallenge);
    this.source = cached.source === "scoreboard+solves" ? "scoreboard+solves" : "scoreboard-top";
    this.generatedAt = Number(cached.generatedAt) || 0;
    this.resolvedAll = this.source === "scoreboard-top";
  }

  private async persist(): Promise<void> {
    const key = this.cacheKey();
    const solved: Record<string, number[]> = {};
    for (const [challengeId, solvers] of this.solvedByChallenge) {
      solved[String(challengeId)] = [...solvers];
    }
    const payload: CachedPayload = {
      ...key,
      generatedAt: this.generatedAt || Date.now(),
      source: this.source,
      players: this.players,
      solvedByChallenge: solved,
      solvesPerChallenge: fromNumberMap(this.solvesPerChallenge),
      categoriesPerChallenge: fromNumberMap(this.categoriesPerChallenge),
      solvedByMe: fromNumberMap(this.solvedByMe),
      valuesPerChallenge: fromNumberMap(this.valuesPerChallenge),
    };
    try {
      await setCache(payload);
    } catch (error) {
      console.debug("[ctfd-top] could not write cache:", String(error));
    }
  }
}

/**
 * Focus mode wins outright; otherwise the top N (unless hidden) plus any watched
 * users found on the leaderboard, deduplicated by account and sorted by rank.
 */
export function selectPlayers(
  board: readonly LeaderboardEntry[],
  settings: SiteSettings,
): LeaderboardEntry[] {
  const focusName = normalizeName(settings.focusUser);
  if (settings.focusMode && focusName) {
    const found = board.find((entry) => normalizeName(entry.name) === focusName);
    return found ? [found] : [];
  }

  const chosen = new Map<number, LeaderboardEntry>();
  if (settings.showTopUsers) {
    for (const entry of board.slice(0, clampTopN(settings.topN))) chosen.set(entry.id, entry);
  }
  for (const watched of settings.watchUsers) {
    const name = normalizeName(watched);
    if (!name) continue;
    const found = board.find((entry) => normalizeName(entry.name) === name);
    if (found && !chosen.has(found.id)) chosen.set(found.id, found);
  }
  return [...chosen.values()].sort((a, b) => a.rank - b.rank);
}
