import "./shared/polyfill.js";
import {
  CHALLENGE_BUTTON_SELECTOR,
  EMPTY_PAGE_NOTICE_MS,
  PROFILE_PATH_PATTERN,
  RENDER_DEBOUNCE_MS,
  SOLVE_REFRESH_COOLDOWN_MS,
  SOLVE_REFRESH_DELAY_MS,
  STORAGE_SITES,
} from "./shared/constants.js";
import {
  clampTopN,
  clearCache,
  getExceptions,
  getSiteConfig,
  mergeSettings,
  normalizeName,
  updateSiteSettings,
  watchKeyOf,
} from "./shared/storage.js";
import type {
  ExtensionMessage,
  SiteSettings,
  SitesMap,
  TrackedPlayer,
} from "./shared/types.js";
import { ApiError } from "./content/api.js";
import { OverlayBar } from "./content/bar.js";
import {
  ensureSpacer,
  removeAllInjected,
  removeBubble,
  renderBadges,
  renderBubble,
} from "./content/badges.js";
import type { ChallengeEntry } from "./content/cards.js";
import { challengeButtons, challengeIdOf, columnOf } from "./content/cards.js";
import { FilterController } from "./content/filter.js";
import { StatusIndicator } from "./content/indicator.js";
import { ProgressBar } from "./content/progress.js";
import { SolveWatcher } from "./content/solve-watch.js";
import { SortController } from "./content/sorter.js";
import { ScoreTracker } from "./content/tracker.js";

declare global {
  interface Window {
    __ctfdTopRan?: boolean;
  }
}

const ORIGIN = location.origin;

/**
 * `attributes` is what lets us notice a solve on themes that only add a class to
 * the button instead of re-rendering the board.
 */
const OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class"],
};

/**
 * Derive the API root from the DOM rather than guessing: the theme asset URL
 * tells us whether CTFd lives at `/` or under a sub-path such as `/ctf`.
 */
function detectApiRoot(): string {
  const link =
    document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ??
    document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
  const href = link?.getAttribute("href");
  if (!href) return "";
  let pathname = href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    try {
      pathname = new URL(href, location.href).pathname;
    } catch {
      return "";
    }
  }
  const index = pathname.indexOf("/themes/");
  return index > 0 ? pathname.slice(0, index) : "";
}

/** The standard "Powered by CTFd" footer link. */
function hasCtfdFooterLink(): boolean {
  return (
    document.querySelector('a[href="https://ctfd.io"], a[href^="https://ctfd.io"]') !== null
  );
}

async function isCtfdSite(): Promise<boolean> {
  if (hasCtfdFooterLink()) return true;
  // Some deployments strip the footer link; the user vouches for those.
  return (await getExceptions()).includes(ORIGIN);
}

function relativePath(apiRoot: string): string {
  const path = location.pathname;
  if (apiRoot && path.startsWith(apiRoot)) return path.slice(apiRoot.length) || "/";
  return path;
}

function isChallengesPage(apiRoot: string): boolean {
  if (/^\/challenges\/?$/.test(relativePath(apiRoot))) return true;
  // Custom routes still work as long as the theme renders challenge buttons.
  return document.querySelector(CHALLENGE_BUTTON_SELECTOR) !== null;
}

function failureReason(error: unknown): string {
  if (error instanceof ApiError && error.status) return `HTTP ${error.status}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Drives everything on a challenges page. */
class Controller {
  private settings: SiteSettings;
  private readonly tracker: ScoreTracker;
  private readonly indicator: StatusIndicator;
  private readonly sorter = new SortController();
  private readonly filter = new FilterController();
  private readonly progress = new ProgressBar(() => this.toggleProgressMetric());
  private readonly bar: OverlayBar;
  private readonly solveWatch = new SolveWatcher();
  private observer: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  private solveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAutoRefresh = 0;
  private lastPipelineSig = "";
  /**
   * Compare is view state, like the sort mode and the filter: it lives for as
   * long as the page does and is never written to storage, so a reload always
   * starts from the plain board.
   */
  private comparing = false;
  /** Last compare tally, for the status pill. Null whenever compare is off. */
  private compareStats: { mine: number; theirs: number } | null = null;
  private stopped = false;

  constructor(apiRoot: string, settings: SiteSettings) {
    this.settings = settings;
    this.tracker = new ScoreTracker(ORIGIN, apiRoot, settings);
    this.indicator = new StatusIndicator(() => void this.forceRefresh(), settings.showIndicator);
    this.bar = new OverlayBar({
      onSort: () => {
        this.sorter.cycleMode();
        this.repaint();
      },
      onGroup: () => {
        this.sorter.setGrouped(!this.sorter.isGrouped());
        this.repaint();
      },
      onFilter: () => {
        this.filter.cycleMode();
        this.repaint();
      },
      onCompare: () => {
        this.comparing = !this.comparing;
        this.repaint();
        // Compare changes what the board means, so say so rather than leaving
        // the pill claiming we are merely focusing.
        this.indicator.show("ready", this.readyMessage());
      },
    });
  }

  async start(): Promise<void> {
    this.indicator.show("loading", "Loading leaderboard…");
    this.observe();
    await this.reload(false);
    this.scheduleEmptyNotice();
  }

  async reload(force: boolean): Promise<void> {
    if (this.stopped) return;
    this.indicator.show("loading", "Loading leaderboard…");
    try {
      await this.tracker.load(force);
      if (this.stopped) return;
      await this.render();
      this.indicator.show("ready", this.readyMessage());
    } catch (error) {
      // The page itself is left exactly as we found it.
      console.debug("[ctfd-top] load failed:", error);
      this.indicator.show(
        "error",
        `Unable to load leaderboard (${failureReason(error)}). Scores/accounts may be hidden, or you may be logged out.`,
      );
    }
  }

  /** The indicator's ↻ button: drop the cache but keep sort/group/filter state. */
  private async forceRefresh(): Promise<void> {
    await clearCache(ORIGIN);
    await this.reload(true);
  }

  updateSettings(next: SiteSettings): void {
    const previous = this.settings;
    this.settings = next;
    this.tracker.setSettings(next);
    this.indicator.setEnabled(next.showIndicator);

    // Widgets that are switched off must not leave the page reordered or filtered.
    if (!next.showSolveCount && this.sorter.getMode() !== "default") this.sorter.destroy();
    if (!next.showSolveFilter && this.filter.getMode() !== "all") this.filter.destroy();
    // Leaving focus mode takes the compare button away with it, so the state
    // behind it must not survive to surprise the next player focused.
    if (!next.focusMode) this.comparing = false;
    if (!next.autoRefreshOnSolve) this.cancelSolveRefresh();

    const dataChanged =
      previous.topN !== next.topN ||
      previous.cacheDurationSec !== next.cacheDurationSec ||
      previous.showTopUsers !== next.showTopUsers ||
      previous.focusMode !== next.focusMode ||
      normalizeName(previous.focusUser) !== normalizeName(next.focusUser) ||
      watchKeyOf(previous.watchUsers) !== watchKeyOf(next.watchUsers);

    this.lastPipelineSig = "";
    if (dataChanged) void this.reload(false);
    else this.paint();
  }

  names(): Promise<string[]> {
    return this.tracker.allNames();
  }

  stop(): void {
    this.stopped = true;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    if (this.emptyTimer !== null) clearTimeout(this.emptyTimer);
    this.debounceTimer = null;
    this.emptyTimer = null;
    this.cancelSolveRefresh();
    this.solveWatch.forget();
    this.observer?.disconnect();
    this.observer = null;
    this.filter.destroy();
    this.sorter.destroy();
    this.bar.destroy();
    this.progress.remove();
    this.indicator.destroy();
    removeAllInjected(document);
  }

  private observe(): void {
    // CTFd (Alpine) re-renders the whole list whenever a solve lands.
    this.observer = new MutationObserver(() => {
      if (this.stopped) return;
      if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.render();
      }, RENDER_DEBOUNCE_MS);
    });
    this.observer.observe(document.body, OBSERVE_OPTIONS);
  }

  private scheduleEmptyNotice(): void {
    this.emptyTimer = setTimeout(() => {
      this.emptyTimer = null;
      if (this.stopped) return;
      if (challengeButtons().length === 0) {
        this.indicator.show("error", "No challenges on this page yet — log in to CTFd if required.");
      }
    }, EMPTY_PAGE_NOTICE_MS);
  }

  private repaint(): void {
    this.lastPipelineSig = "";
    this.paint();
  }

  /** Async half: make sure we know the solvers for everything on screen. */
  private async render(): Promise<void> {
    if (this.stopped) return;
    if (this.tracker.source === "scoreboard+solves") {
      const ids = [
        ...challengeButtons().map(challengeIdOf),
        ...this.filter.removedIds(),
      ].filter((id): id is number => id !== null);
      await this.tracker.ensureSolves(ids);
      if (this.stopped) return;
    }
    this.paint();
  }

  /** Sync half: every DOM write happens here, with the observer detached. */
  private paint(): void {
    const observer = this.observer;
    observer?.disconnect();
    try {
      const visible = this.collect();
      this.noticeSolves(visible);
      const signature = this.pipelineSignature(visible);
      if (signature === this.lastPipelineSig) {
        // Nothing structural changed; the signature guards below make this free.
        this.renderCards(visible);
      } else {
        this.filter.restoreAll();
        const all = this.collect();
        const compared = this.comparedSolves(all);
        this.renderCards(all);
        this.updateProgress(all);
        this.sorter.apply(all);
        this.filter.apply(all, this.tracker.solvedByMe, compared);
        this.lastPipelineSig = this.pipelineSignature(this.collect());
      }
      const rival = this.compareTarget();
      this.bar.sync({
        showSort: this.settings.showSolveCount,
        showFilter: this.settings.showSolveFilter,
        showCompare: rival !== null,
        mode: this.sorter.getMode(),
        grouped: this.sorter.isGrouped(),
        filter: this.filter.getMode(),
        comparing: this.comparing,
        compareName: rival?.name ?? "",
      });
    } finally {
      if (observer && !this.stopped) {
        observer.observe(document.body, OBSERVE_OPTIONS);
      }
    }
  }

  private collect(): ChallengeEntry[] {
    const entries: ChallengeEntry[] = [];
    for (const button of challengeButtons()) {
      const id = challengeIdOf(button);
      if (id === null) continue;
      entries.push({
        button,
        id,
        card: columnOf(button),
        count: this.tracker.solvesPerChallenge.get(id) ?? null,
        category: this.tracker.categoriesPerChallenge.get(id) ?? "",
      });
    }
    return entries;
  }

  private pipelineSignature(entries: readonly ChallengeEntry[]): string {
    return [
      this.sorter.getMode(),
      this.sorter.isGrouped() ? 1 : 0,
      this.filter.getMode(),
      this.comparing ? (this.compareTarget()?.id ?? 0) : "",
      this.tracker.generatedAt,
      entries.map((entry) => entry.id).join(","),
    ].join("|");
  }

  private renderCards(entries: readonly ChallengeEntry[]): void {
    const bubbles = this.settings.showSolveCount;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    if (bubbles) {
      for (const entry of entries) {
        if (entry.count === null) continue;
        if (entry.count < min) min = entry.count;
        if (entry.count > max) max = entry.count;
      }
    }
    // The flat sort replaces CTFd's category headers with per-card labels.
    const flat = bubbles && !this.sorter.isGrouped() && this.sorter.getMode() !== "default";

    for (const entry of entries) {
      renderBadges(entry.button, this.tracker.solversOf(entry.id), this.settings);
      if (bubbles) renderBubble(entry.button, entry.count ?? undefined, min, max);
      else removeBubble(entry.button);
      ensureSpacer(entry.button, bubbles || flat);
    }
  }

  /**
   * Who "compare" is against: the focused player, once focus mode has actually
   * found them. Null everywhere else, which is what keeps the button off the
   * bar outside focus mode.
   */
  private compareTarget(): TrackedPlayer | null {
    return this.tracker.focusedPlayer();
  }

  /**
   * Challenge id -> whether the focused player solved it, plus the tally the
   * status pill reports. Challenges whose solvers are not resolved yet are
   * left out of the map entirely, so the filter keeps them on screen.
   */
  private comparedSolves(entries: readonly ChallengeEntry[]): Map<number, boolean> | null {
    const rival = this.comparing ? this.compareTarget() : null;
    if (!rival) {
      this.compareStats = null;
      return null;
    }
    const compared = new Map<number, boolean>();
    let mine = 0;
    let theirs = 0;
    for (const entry of entries) {
      const solved = this.tracker.solvedBy(entry.id, rival.id);
      if (solved === null) continue;
      compared.set(entry.id, solved);
      const own = this.tracker.solvedByMe.get(entry.id) === true;
      if (own && !solved) mine += 1;
      else if (solved && !own) theirs += 1;
    }
    this.compareStats = { mine, theirs };
    return compared;
  }

  /**
   * The page marking a challenge solved is our cue that the API has something
   * new to say. The numbers themselves are always refetched, never read off the
   * page — so a theme that marks solves early cannot put wrong data on screen.
   */
  private noticeSolves(entries: readonly ChallengeEntry[]): void {
    // Always fold the DOM into the baseline, even when the feature is off, so
    // switching it on later does not fire for solves that already happened.
    const fresh = this.solveWatch.check(entries);
    if (fresh.length === 0 || !this.settings.autoRefreshOnSolve) return;
    this.scheduleSolveRefresh(fresh.length);
  }

  /** Coalesce a burst of solves into one refetch, and never exceed the cooldown. */
  private scheduleSolveRefresh(count: number): void {
    if (this.stopped || this.solveTimer !== null) return;
    const since = Date.now() - this.lastAutoRefresh;
    const wait = Math.max(SOLVE_REFRESH_DELAY_MS, SOLVE_REFRESH_COOLDOWN_MS - since);
    this.indicator.show(
      "loading",
      count > 1 ? `${count} new solves — refreshing…` : "Solve detected — refreshing…",
    );
    this.solveTimer = setTimeout(() => {
      this.solveTimer = null;
      void this.autoRefresh();
    }, wait);
  }

  private cancelSolveRefresh(): void {
    if (this.solveTimer === null) return;
    clearTimeout(this.solveTimer);
    this.solveTimer = null;
  }

  private async autoRefresh(): Promise<void> {
    if (this.stopped) return;
    this.lastAutoRefresh = Date.now();
    await clearCache(ORIGIN);
    await this.reload(true);
  }

  /** Clicking the progress bar flips between tasks and points, and remembers it. */
  private toggleProgressMetric(): void {
    const metric = this.settings.solveProgressMetric === "points" ? "tasks" : "points";
    this.settings = { ...this.settings, solveProgressMetric: metric };
    // Repaint straight away, then let storage confirm it.
    this.repaint();
    void updateSiteSettings(ORIGIN, { solveProgressMetric: metric });
  }

  private updateProgress(entries: readonly ChallengeEntry[]): void {
    if (!this.settings.showSolveProgress) {
      this.progress.remove();
      return;
    }
    let solvedTasks = 0;
    let solvedPoints = 0;
    let totalPoints = 0;
    for (const entry of entries) {
      const value = this.tracker.valuesPerChallenge.get(entry.id) ?? 0;
      totalPoints += value;
      if (this.tracker.solvedByMe.get(entry.id) === true) {
        solvedTasks += 1;
        solvedPoints += value;
      }
    }
    this.progress.update({
      solvedTasks,
      totalTasks: entries.length,
      solvedPoints,
      totalPoints,
      metric: this.settings.solveProgressMetric,
    });
  }

  private readyMessage(): string {
    const source =
      this.tracker.source === "scoreboard-top" ? "scoreboard/top" : "scoreboard + per-challenge solves";
    const players = this.tracker.players;

    if (this.settings.focusMode && this.settings.focusUser.trim()) {
      if (players.length === 0) {
        return `No player named "${this.settings.focusUser.trim()}" found · ${source}`;
      }
      const name = players[0].name;
      const stats = this.comparing ? this.compareStats : null;
      if (stats) {
        return `Comparing with ${name} — ${stats.mine} only you, ${stats.theirs} only them · ${source}`;
      }
      return `Focusing on ${name} · ${source}`;
    }

    const topLimit = clampTopN(this.settings.topN);
    const inTop = this.settings.showTopUsers
      ? players.filter((player) => player.rank <= topLimit).length
      : 0;
    const watched = players.length - inTop;

    if (players.length === 0) return `No players tracked (add watched users first) · ${source}`;
    if (!this.settings.showTopUsers) return `Tracking ${watched} watched · ${source}`;
    if (watched > 0) return `Tracking top ${inTop} + ${watched} watched · ${source}`;
    return `Tracking top ${inTop} · ${source}`;
  }
}

/** Watch / Focus toggles on a `/users/<id>` or `/teams/<id>` page. */
class ProfileButtons {
  private readonly name: string;
  private readonly watchButton: HTMLElement;
  private readonly focusButton: HTMLElement;

  constructor(name: string, container: HTMLElement) {
    this.name = name;

    this.watchButton = document.createElement("button");
    this.watchButton.className = "ctfd-top-profile-btn";
    this.watchButton.setAttribute("type", "button");
    this.watchButton.addEventListener("click", () => void this.toggleWatch());

    this.focusButton = document.createElement("button");
    this.focusButton.className = "ctfd-top-profile-btn ctfd-top-profile-focus";
    this.focusButton.setAttribute("type", "button");
    this.focusButton.addEventListener("click", () => void this.toggleFocus());

    container.appendChild(this.watchButton);
    container.appendChild(this.focusButton);
  }

  async refresh(): Promise<void> {
    const config = await getSiteConfig(ORIGIN);
    const active = config?.active === true;
    const settings = config?.settings ?? mergeSettings(null);
    const key = normalizeName(this.name);
    const watching =
      active && settings.watchUsers.some((entry) => normalizeName(entry) === key);
    const focusing = active && settings.focusMode && normalizeName(settings.focusUser) === key;
    this.setState(watching, focusing);
  }

  private setState(watching: boolean, focusing: boolean): void {
    this.watchButton.textContent = watching ? `✓ Watching ${this.name}` : `Watch ${this.name}`;
    this.watchButton.setAttribute("data-active", watching ? "true" : "false");
    this.focusButton.textContent = focusing
      ? `✓ Focusing on ${this.name}`
      : `Focus ${this.name}`;
    this.focusButton.setAttribute("data-active", focusing ? "true" : "false");
  }

  private async toggleWatch(): Promise<void> {
    const config = await getSiteConfig(ORIGIN);
    const settings = config?.settings ?? mergeSettings(null);
    const key = normalizeName(this.name);
    const watching = settings.watchUsers.some((entry) => normalizeName(entry) === key);
    const watchUsers = watching
      ? settings.watchUsers.filter((entry) => normalizeName(entry) !== key)
      : [...settings.watchUsers, this.name];
    // Reflect the click immediately, then let storage confirm it.
    this.setState(!watching, this.focusButton.getAttribute("data-active") === "true");
    await updateSiteSettings(ORIGIN, { watchUsers });
    await this.refresh();
  }

  private async toggleFocus(): Promise<void> {
    const config = await getSiteConfig(ORIGIN);
    const settings = config?.settings ?? mergeSettings(null);
    const key = normalizeName(this.name);
    const focusing = settings.focusMode && normalizeName(settings.focusUser) === key;
    this.setState(this.watchButton.getAttribute("data-active") === "true", !focusing);
    await updateSiteSettings(
      ORIGIN,
      focusing ? { focusMode: false, focusUser: "" } : { focusMode: true, focusUser: this.name },
    );
    await this.refresh();
  }
}

let controller: Controller | null = null;
/** Guards against two storage events racing a pair of boots into existence. */
let booting = false;
let profileButtons: ProfileButtons | null = null;
let standaloneTracker: ScoreTracker | null = null;
let messagesBound = false;

async function namesForPopup(): Promise<string[]> {
  if (controller) return controller.names();
  standaloneTracker ??= new ScoreTracker(ORIGIN, detectApiRoot(), mergeSettings(null));
  return standaloneTracker.allNames();
}

function bindMessages(): void {
  if (messagesBound) return;
  messagesBound = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as ExtensionMessage | undefined)?.type;
    if (type === "ctfd-top-force-reload") {
      void (async () => {
        try {
          await clearCache(ORIGIN);
          if (controller) await controller.reload(true);
          sendResponse({ ok: controller !== null });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
      })();
      return true;
    }
    if (type === "ctfd-top-get-users") {
      void (async () => {
        try {
          sendResponse({ ok: true, users: await namesForPopup() });
        } catch (error) {
          sendResponse({ ok: false, users: [], error: String(error) });
        }
      })();
      return true;
    }
    return undefined;
  });
}

async function setupProfile(name: string): Promise<void> {
  if (profileButtons) {
    await profileButtons.refresh();
    return;
  }
  const container = document.querySelector<HTMLElement>(".jumbotron .container");
  if (!container) return;
  profileButtons = new ProfileButtons(name, container);
  await profileButtons.refresh();
}

function profileName(): string | null {
  const heading = document.querySelector<HTMLElement>(".jumbotron h1");
  const name = (heading?.textContent ?? "").trim();
  return name || null;
}

async function boot(): Promise<void> {
  if (booting || controller) return;
  booting = true;
  try {
    const config = await getSiteConfig(ORIGIN);
    if (!config?.active) return;
    if (!(await isCtfdSite())) return;

    const apiRoot = detectApiRoot();
    if (PROFILE_PATH_PATTERN.test(relativePath(apiRoot))) {
      // On a profile page we add the two buttons and nothing else.
      const name = profileName();
      if (name) await setupProfile(name);
      return;
    }
    if (!isChallengesPage(apiRoot)) return;

    const started = new Controller(apiRoot, config.settings);
    controller = started;
    await started.start();
  } finally {
    booting = false;
  }
}

function watchStorage(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const change = changes[STORAGE_SITES];
    if (!change) return;
    const config = (change.newValue as SitesMap | undefined)?.[ORIGIN];
    if (!config || config.active !== true) {
      controller?.stop();
      controller = null;
      void profileButtons?.refresh();
      return;
    }
    const settings = mergeSettings(config.settings);
    if (controller) controller.updateSettings(settings);
    else void boot();
    void profileButtons?.refresh();
  });
}

function init(): void {
  bindMessages();
  watchStorage();
  void boot();
}

if (window.__ctfdTopRan) {
  // Registered content script plus a programmatic injection: only run once.
  console.debug("[ctfd-top] content script already ran in this document");
} else {
  window.__ctfdTopRan = true;
  init();
}
