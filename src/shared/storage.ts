import {
  DEFAULT_SETTINGS,
  MAX_CACHE_SEC,
  MAX_TOP_N,
  MIN_CACHE_SEC,
  MIN_TOP_N,
  STORAGE_CACHE_PREFIX,
  STORAGE_EXCEPTIONS,
  STORAGE_SITES,
} from "./constants.js";
import type { CachedPayload, SiteConfig, SiteSettings, SitesMap } from "./types.js";

/**
 * Spread stored settings over the current defaults, so a config written by an
 * older version always loads with sane values for keys added since. Every read
 * of a stored config goes through this.
 */
export function mergeSettings(partial: Partial<SiteSettings> | null | undefined): SiteSettings {
  const merged: SiteSettings = { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
  merged.topN = clampTopN(merged.topN);
  merged.cacheDurationSec = clampCacheDuration(merged.cacheDurationSec);
  merged.watchUsers = Array.isArray(merged.watchUsers)
    ? merged.watchUsers.filter((name): name is string => typeof name === "string")
    : [];
  merged.focusUser = typeof merged.focusUser === "string" ? merged.focusUser : "";
  merged.solveProgressMetric = merged.solveProgressMetric === "points" ? "points" : "tasks";
  return merged;
}

export function clampTopN(value: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_TOP_N;
  return Math.min(MAX_TOP_N, Math.max(MIN_TOP_N, n));
}

export function clampCacheDuration(value: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return MIN_CACHE_SEC;
  return Math.min(MAX_CACHE_SEC, Math.max(MIN_CACHE_SEC, n));
}

/** Order-independent, case-insensitive key for the watch list. */
export function watchKeyOf(watchUsers: readonly string[]): string {
  return watchUsers
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0)
    .sort()
    .join(",");
}

export function focusKeyOf(settings: SiteSettings): string {
  const name = settings.focusUser.trim().toLowerCase();
  return settings.focusMode && name ? `on:${name}` : "";
}

/** Trimmed, case-insensitive name comparison, used everywhere names are matched. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function readLocal<T>(key: string): Promise<T | undefined> {
  const bag = await chrome.storage.local.get(key);
  return bag[key] as T | undefined;
}

export async function getSites(): Promise<SitesMap> {
  const raw = await readLocal<SitesMap>(STORAGE_SITES);
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

export async function setSites(sites: SitesMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_SITES]: sites });
}

export async function getSiteConfig(origin: string): Promise<SiteConfig | null> {
  const sites = await getSites();
  const config = sites[origin];
  if (!config) return null;
  return { active: config.active === true, settings: mergeSettings(config.settings) };
}

export async function setSiteConfig(origin: string, config: SiteConfig): Promise<void> {
  const sites = await getSites();
  sites[origin] = { active: config.active, settings: mergeSettings(config.settings) };
  await setSites(sites);
}

export async function updateSiteSettings(
  origin: string,
  patch: Partial<SiteSettings>,
): Promise<SiteSettings> {
  const sites = await getSites();
  const current = sites[origin];
  const settings = mergeSettings({ ...mergeSettings(current?.settings), ...patch });
  sites[origin] = { active: current?.active === true, settings };
  await setSites(sites);
  return settings;
}

export async function removeSiteConfig(origin: string): Promise<void> {
  const sites = await getSites();
  if (!(origin in sites)) return;
  delete sites[origin];
  await setSites(sites);
}

export async function getExceptions(): Promise<string[]> {
  const raw = await readLocal<string[]>(STORAGE_EXCEPTIONS);
  if (!Array.isArray(raw)) return [];
  return raw.filter((origin): origin is string => typeof origin === "string");
}

export async function setExceptions(origins: readonly string[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_EXCEPTIONS]: [...new Set(origins)] });
}

export function cacheKeyFor(origin: string): string {
  return `${STORAGE_CACHE_PREFIX}${origin}`;
}

export async function getCache(origin: string): Promise<CachedPayload | null> {
  const raw = await readLocal<CachedPayload>(cacheKeyFor(origin));
  if (!raw || typeof raw !== "object") return null;
  return raw;
}

export async function setCache(payload: CachedPayload): Promise<void> {
  await chrome.storage.local.set({ [cacheKeyFor(payload.origin)]: payload });
}

export async function clearCache(origin: string): Promise<void> {
  await chrome.storage.local.remove(cacheKeyFor(origin));
}
