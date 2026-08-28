import type { ChallengeMeta, LeaderboardEntry } from "../shared/types.js";

/** Any failure that means "the API did not give us usable data". */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * 403/404 — the endpoint is absent on this CTFd version, or scores/accounts are
 * hidden, or we are logged out. Callers use this to switch to the fallback path.
 */
export class EndpointUnavailableError extends ApiError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "EndpointUnavailableError";
  }
}

/** One top-N entry: the account plus the challenge ids it solved. */
export interface TopEntry extends LeaderboardEntry {
  solves: number[];
}

/** One row of `/api/v1/challenges/{id}/solves`. */
export interface ChallengeSolver {
  accountId: number;
  name: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toId(raw: Record<string, unknown>): number {
  const id = Number(raw.id ?? raw.account_id);
  return Number.isFinite(id) ? id : NaN;
}

function toName(raw: Record<string, unknown>, rank: number): string {
  const name = raw.name;
  if (typeof name === "string" && name.trim()) return name;
  return `player-${rank}`;
}

function toScore(raw: Record<string, unknown>): number {
  const score = Number(raw.score);
  return Number.isFinite(score) ? score : 0;
}

function toBracket(raw: Record<string, unknown>): string {
  const bracket = raw.bracket_name;
  return typeof bracket === "string" ? bracket : "";
}

/**
 * Same-origin CTFd v1 API client. Every call is a GET made with the user's
 * existing session cookie, so no API key and no CSRF token are involved and no
 * credential is ever read, stored or transmitted by the extension.
 */
export class CtfdApiClient {
  /** URL prefix before `/api/...`: "" for a root install, e.g. "/ctf" for a sub-path one. */
  private readonly root: string;

  constructor(root: string) {
    this.root = root.replace(/\/$/, "");
  }

  private async getJSON(path: string): Promise<unknown> {
    const url = `${this.root}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      throw new ApiError(`network error for ${path}: ${String(error)}`);
    }

    if (response.status === 403 || response.status === 404) {
      throw new EndpointUnavailableError(
        `${path} unavailable (${response.status})`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new ApiError(`${path} failed (${response.status})`, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new ApiError(`${path} returned invalid JSON: ${String(error)}`, response.status);
    }

    const envelope = asRecord(body);
    if (!envelope) {
      throw new ApiError(`${path} returned a non-object body`, response.status);
    }
    if (envelope.success !== true) {
      throw new ApiError(`${path} reported success=false`, response.status);
    }
    return envelope.data;
  }

  /**
   * The fast path: top-N accounts *with* their solves, i.e. the whole question
   * answered in a single request.
   */
  async scoreboardTop(count: number): Promise<TopEntry[]> {
    const data = await this.getJSON(`/api/v1/scoreboard/top/${count}`);
    const record = asRecord(data);
    if (!record) throw new ApiError("scoreboard/top returned a non-object payload");

    const entries: TopEntry[] = [];
    let index = 0;
    for (const [key, value] of Object.entries(record)) {
      index += 1;
      const raw = asRecord(value);
      if (!raw) continue;
      const parsedRank = Number(key);
      const rank = Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : index;
      const id = toId(raw);
      if (!Number.isFinite(id)) continue;
      const solves: number[] = [];
      if (Array.isArray(raw.solves)) {
        for (const solve of raw.solves) {
          const solveRecord = asRecord(solve);
          if (!solveRecord) continue;
          const challengeId = Number(solveRecord.challenge_id ?? solveRecord.challengeId);
          if (Number.isFinite(challengeId)) solves.push(challengeId);
        }
      }
      entries.push({
        id,
        name: toName(raw, rank),
        rank,
        score: toScore(raw),
        bracket: toBracket(raw),
        solves,
      });
    }
    entries.sort((a, b) => a.rank - b.rank);
    return entries;
  }

  /** The full leaderboard: fallback ranking source, and the name pool for autocomplete. */
  async scoreboard(): Promise<LeaderboardEntry[]> {
    const data = await this.getJSON("/api/v1/scoreboard");
    if (!Array.isArray(data)) throw new ApiError("scoreboard returned a non-array payload");

    const entries: LeaderboardEntry[] = [];
    data.forEach((value, index) => {
      const raw = asRecord(value);
      if (!raw) return;
      const parsedRank = Number(raw.pos);
      const rank = Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : index + 1;
      const id = toId(raw);
      if (!Number.isFinite(id)) return;
      entries.push({
        id,
        name: toName(raw, rank),
        rank,
        score: toScore(raw),
        bracket: toBracket(raw),
      });
    });
    entries.sort((a, b) => a.rank - b.rank);
    return entries;
  }

  /** Fallback only: who solved one specific challenge. */
  async challengeSolves(challengeId: number): Promise<ChallengeSolver[]> {
    const data = await this.getJSON(`/api/v1/challenges/${challengeId}/solves`);
    if (!Array.isArray(data)) throw new ApiError("challenge solves returned a non-array payload");

    const solvers: ChallengeSolver[] = [];
    for (const value of data) {
      const raw = asRecord(value);
      if (!raw) continue;
      const accountId = Number(raw.account_id ?? raw.id);
      if (!Number.isFinite(accountId)) continue;
      solvers.push({ accountId, name: typeof raw.name === "string" ? raw.name : "" });
    }
    return solvers;
  }

  /**
   * One request covering every challenge on the site: total solve count,
   * category, whether the logged-in user solved it, and its point value.
   */
  async challenges(): Promise<ChallengeMeta[]> {
    const data = await this.getJSON("/api/v1/challenges");
    if (!Array.isArray(data)) throw new ApiError("challenges returned a non-array payload");

    const items: ChallengeMeta[] = [];
    for (const value of data) {
      const raw = asRecord(value);
      if (!raw) continue;
      const id = Number(raw.id);
      if (!Number.isFinite(id)) continue;
      const solves = Number(raw.solves);
      const points = Number(raw.value);
      items.push({
        id,
        solves: Number.isFinite(solves) ? solves : null,
        category: typeof raw.category === "string" ? raw.category : "",
        solvedByMe: raw.solved_by_me === true,
        value: Number.isFinite(points) ? points : null,
      });
    }
    return items;
  }
}
