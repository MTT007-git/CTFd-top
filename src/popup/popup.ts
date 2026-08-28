import "../shared/polyfill.js";
import { DEFAULT_SETTINGS } from "../shared/constants.js";
import {
  clampCacheDuration,
  clampTopN,
  clearCache,
  getExceptions,
  getSiteConfig,
  mergeSettings,
  normalizeName,
  removeSiteConfig,
  setExceptions,
  setSiteConfig,
  updateSiteSettings,
} from "../shared/storage.js";
import type { ProgressMetric, SiteSettings } from "../shared/types.js";

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
};

let tabId: number | null = null;
let origin = "";
/** Whether the page looks like CTFd (footer link) or is an exception. */
let isCtfd = false;
let active = false;
let settings: SiteSettings = { ...DEFAULT_SETTINGS };
/** Leaderboard names, memoized for the lifetime of the popup. */
let names: string[] | null = null;

function originOf(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function reconcile(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "ctfd-top-reconcile" });
  } catch (error) {
    console.debug("[ctfd-top] reconcile message failed:", String(error));
  }
}

/** Look for the "Powered by CTFd" footer link in the active tab. */
async function detectCtfdPage(): Promise<boolean> {
  if (tabId === null) return false;
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        document.querySelector('a[href="https://ctfd.io"], a[href^="https://ctfd.io"]') !== null,
    });
    return injected?.result === true;
  } catch {
    // Restricted pages (chrome://, the add-ons manager, …) simply are not CTFd.
    return false;
  }
}

/** Start tracking the current tab immediately, without waiting for a reload. */
async function injectNow(): Promise<void> {
  if (tabId === null) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["badges.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (error) {
    console.debug("[ctfd-top] injection skipped:", String(error));
  }
}

async function loadNames(): Promise<string[]> {
  if (names) return names;
  let found: string[] = [];

  if (tabId !== null) {
    try {
      // The content script has the site's session cookie, so ask it first.
      const response = (await chrome.tabs.sendMessage(tabId, { type: "ctfd-top-get-users" })) as
        | { ok?: boolean; users?: unknown }
        | undefined;
      if (response?.ok && Array.isArray(response.users)) {
        found = response.users.filter((name): name is string => typeof name === "string");
      }
    } catch {
      // No content script in this tab: normal, not an error.
    }
  }

  if (found.length === 0 && origin) {
    try {
      const response = await fetch(`${origin}/api/v1/scoreboard`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (response.ok) {
        const body = (await response.json()) as { success?: boolean; data?: unknown };
        if (body?.success === true && Array.isArray(body.data)) {
          found = body.data
            .map((entry) => (entry as { name?: unknown } | null)?.name)
            .filter((name): name is string => typeof name === "string");
        }
      }
    } catch (error) {
      console.debug("[ctfd-top] scoreboard fetch for autocomplete failed:", String(error));
    }
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of found) {
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  names = unique;
  return unique;
}

/** Debounced prefix-then-substring autocomplete, shared by the watch and focus inputs. */
function attachAutocomplete(
  input: HTMLInputElement,
  box: HTMLElement,
  onPick: (name: string) => void,
): void {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;

  const hide = (): void => {
    box.hidden = true;
    box.textContent = "";
  };

  const show = (matches: string[]): void => {
    box.textContent = "";
    if (matches.length === 0) {
      hide();
      return;
    }
    for (const name of matches) {
      const item = document.createElement("div");
      item.className = "ac-item";
      item.textContent = name;
      // Fire before blur steals the click.
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
        input.value = name;
        hide();
        onPick(name);
      });
      box.appendChild(item);
    }
    box.hidden = false;
  };

  input.addEventListener("input", () => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void (async () => {
        const query = normalizeName(input.value);
        if (!query) {
          hide();
          return;
        }
        const pool = await loadNames();
        let matches = pool.filter((name) => normalizeName(name).startsWith(query));
        if (matches.length === 0) {
          matches = pool.filter((name) => normalizeName(name).includes(query));
        }
        show(matches.slice(0, 8));
      })();
    }, 200);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    hide();
    // Enter accepts exactly what was typed.
    onPick(input.value.trim());
  });

  input.addEventListener("blur", () => {
    if (blurTimer !== null) clearTimeout(blurTimer);
    blurTimer = setTimeout(hide, 150);
  });
}

function renderList(
  list: HTMLElement,
  values: readonly string[],
  emptyText: string,
  onRemove: (value: string) => void,
): void {
  list.textContent = "";
  if (values.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = emptyText;
    list.appendChild(empty);
    return;
  }
  for (const value of values) {
    const item = document.createElement("li");
    item.className = "list-item";
    const label = document.createElement("span");
    label.textContent = value;
    item.appendChild(label);
    const remove = document.createElement("button");
    remove.className = "list-remove";
    remove.type = "button";
    remove.title = "Remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => onRemove(value));
    item.appendChild(remove);
    list.appendChild(item);
  }
}

async function save(patch: Partial<SiteSettings>): Promise<void> {
  if (!origin) return;
  settings = await updateSiteSettings(origin, patch);
  paintSettings();
}

function paintSettings(): void {
  $<HTMLInputElement>("topN").value = String(settings.topN);
  $<HTMLInputElement>("cacheDurationSec").value = String(settings.cacheDurationSec);
  for (const key of [
    "autoRefreshOnSolve",
    "showRank",
    "showName",
    "compact",
    "showIndicator",
    "showTopUsers",
    "showSolveCount",
    "showSolveFilter",
    "showSolveProgress",
    "focusMode",
  ] as const) {
    $<HTMLInputElement>(key).checked = settings[key] === true;
  }

  $("metric-row").hidden = !settings.showSolveProgress;
  $<HTMLInputElement>("metric-tasks").checked = settings.solveProgressMetric === "tasks";
  $<HTMLInputElement>("metric-points").checked = settings.solveProgressMetric === "points";

  $("focus-row").hidden = !settings.focusMode;
  const focusInput = $<HTMLInputElement>("focus-input");
  if (document.activeElement !== focusInput) focusInput.value = settings.focusUser;
  renderList(
    $("focus-list"),
    settings.focusUser ? [settings.focusUser] : [],
    "No player focused yet.",
    () => void save({ focusUser: "" }),
  );

  renderList($("watch-list"), settings.watchUsers, "No watched users yet.", (value) => {
    void save({
      watchUsers: settings.watchUsers.filter((entry) => normalizeName(entry) !== normalizeName(value)),
    });
  });
}

function paintActivation(): void {
  $("activate").hidden = active;
  $("activate-hint").hidden = active;
  $("settings-section").hidden = !active;
  $("footer").hidden = !active;

  const warn = $("warn");
  const activate = $<HTMLButtonElement>("activate");
  if (!isCtfd) {
    activate.disabled = true;
    warn.hidden = false;
    warn.textContent =
      "This page has no “Powered by CTFd” link, so it does not look like a CTFd site. If it really is one, add it as an exception below.";
  } else {
    activate.disabled = false;
    warn.hidden = true;
    warn.textContent = "";
  }
}

async function paintExceptions(): Promise<void> {
  const exceptions = await getExceptions();
  renderList($("exception-list"), exceptions, "No exceptions added.", (value) => {
    void (async () => {
      await setExceptions(exceptions.filter((entry) => entry !== value));
      await reconcile();
      await paintExceptions();
    })();
  });
}

async function activateSite(): Promise<void> {
  if (!origin) return;
  // Second guard: the page may have changed since the popup opened.
  const exceptions = await getExceptions();
  if (!exceptions.includes(origin) && !(await detectCtfdPage())) {
    isCtfd = false;
    paintActivation();
    return;
  }
  const existing = await getSiteConfig(origin);
  await setSiteConfig(origin, { active: true, settings: existing?.settings ?? settings });
  active = true;
  settings = mergeSettings(existing?.settings ?? settings);
  await reconcile();
  await injectNow();
  paintActivation();
  paintSettings();
}

async function deactivateSite(): Promise<void> {
  if (!origin) return;
  await removeSiteConfig(origin);
  // Nothing about a site we no longer track should linger in storage.
  await clearCache(origin);
  await reconcile();
  active = false;
  settings = { ...DEFAULT_SETTINGS };
  paintActivation();
  paintSettings();
}

function flash(button: HTMLButtonElement, text: string): void {
  const original = button.textContent ?? "";
  button.textContent = text;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 2000);
}

function bindEvents(): void {
  $("activate").addEventListener("click", () => void activateSite());
  $("deactivate").addEventListener("click", () => void deactivateSite());

  $("add-exception").addEventListener("click", () => {
    void (async () => {
      if (!origin) return;
      const exceptions = await getExceptions();
      if (!exceptions.includes(origin)) await setExceptions([...exceptions, origin]);
      isCtfd = true;
      await paintExceptions();
      // Adding an exception activates the site in the same action.
      await activateSite();
    })();
  });

  $<HTMLInputElement>("topN").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    void save({ topN: clampTopN(Number(input.value)) });
  });

  $<HTMLInputElement>("cacheDurationSec").addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    void save({ cacheDurationSec: clampCacheDuration(Number(input.value)) });
  });

  for (const key of [
    "autoRefreshOnSolve",
    "showRank",
    "showName",
    "compact",
    "showIndicator",
    "showTopUsers",
    "showSolveCount",
    "showSolveFilter",
    "showSolveProgress",
    "focusMode",
  ] as const) {
    $<HTMLInputElement>(key).addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      void save({ [key]: input.checked } as Partial<SiteSettings>);
    });
  }

  for (const metric of ["tasks", "points"] as const) {
    $<HTMLInputElement>(`metric-${metric}`).addEventListener("change", () => {
      void save({ solveProgressMetric: metric as ProgressMetric });
    });
  }

  const focusInput = $<HTMLInputElement>("focus-input");
  focusInput.addEventListener("change", () => void save({ focusUser: focusInput.value.trim() }));
  attachAutocomplete(focusInput, $("focus-ac"), (name) => {
    void save({ focusUser: name.trim() });
  });

  const watchInput = $<HTMLInputElement>("watch-input");
  const addWatch = (raw: string): void => {
    const name = raw.trim();
    if (!name) return;
    const key = normalizeName(name);
    if (settings.watchUsers.some((entry) => normalizeName(entry) === key)) {
      watchInput.value = "";
      return;
    }
    watchInput.value = "";
    void save({ watchUsers: [...settings.watchUsers, name] });
  };
  $("watch-add").addEventListener("click", () => addWatch(watchInput.value));
  attachAutocomplete(watchInput, $("watch-ac"), addWatch);

  $("force-reload").addEventListener("click", () => {
    void (async () => {
      const button = $<HTMLButtonElement>("force-reload");
      if (origin) await clearCache(origin);
      if (tabId !== null) {
        try {
          await chrome.tabs.sendMessage(tabId, { type: "ctfd-top-force-reload" });
        } catch {
          // No content script in this tab: expected on non-CTFd pages.
        }
      }
      flash(button, "Cache cleared ✓");
    })();
  });
}

async function init(): Promise<void> {
  const tab = await currentTab();
  tabId = tab?.id ?? null;
  origin = originOf(tab?.url);
  $("host").textContent = origin ? origin.replace(/^https?:\/\//, "") : "unsupported page";

  const exceptions = await getExceptions();
  isCtfd = exceptions.includes(origin) || (await detectCtfdPage());

  let config = origin ? await getSiteConfig(origin) : null;
  if (config && !isCtfd) {
    // Auto-deactivate: this origin is no longer a CTFd site.
    await removeSiteConfig(origin);
    await reconcile();
    config = null;
  }

  active = config?.active === true;
  settings = config?.settings ?? { ...DEFAULT_SETTINGS };

  bindEvents();
  paintActivation();
  paintSettings();
  await paintExceptions();
}

void init();
