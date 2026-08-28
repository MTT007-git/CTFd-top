import "./shared/polyfill.js";
import { BADGE_COLOR, BADGE_TEXT, SCRIPT_ID_PREFIX, STORAGE_SITES } from "./shared/constants.js";
import { getSites } from "./shared/storage.js";
import type { ExtensionMessage } from "./shared/types.js";

function scriptIdFor(origin: string): string {
  return SCRIPT_ID_PREFIX + origin.replace(/[^A-Za-z0-9_-]/g, "_");
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Diff the registered dynamic content scripts against the stored activation
 * state. This is the only thing that decides where the extension runs — a site
 * the user has not activated never gets a content script, so it never sees a
 * single request from us.
 */
async function reconcile(): Promise<void> {
  const sites = await getSites();
  const active = Object.entries(sites)
    .filter(([, config]) => config?.active === true)
    .map(([origin]) => origin);

  let registered: chrome.scripting.RegisteredContentScript[] = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts();
  } catch (error) {
    console.warn("[ctfd-top] could not list registered scripts:", error);
  }

  const ours = registered.filter((script) => script.id.startsWith(SCRIPT_ID_PREFIX));
  const wanted = new Map(active.map((origin) => [scriptIdFor(origin), origin]));

  const stale = ours.filter((script) => !wanted.has(script.id)).map((script) => script.id);
  if (stale.length > 0) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: stale });
    } catch (error) {
      console.warn("[ctfd-top] could not unregister scripts:", error);
    }
  }

  const existing = new Set(ours.map((script) => script.id));
  for (const [id, origin] of wanted) {
    if (existing.has(id)) continue;
    try {
      await chrome.scripting.registerContentScripts([
        {
          id,
          matches: [`${origin}/*`],
          js: ["content.js"],
          css: ["badges.css"],
          runAt: "document_idle",
          allFrames: false,
        },
      ]);
    } catch (error) {
      // One bad origin must not stop the others from registering.
      console.warn(`[ctfd-top] could not register ${origin}:`, error);
    }
  }
}

/** "CT" on the toolbar icon whenever the tab's origin is activated. */
async function updateBadge(tabId?: number): Promise<void> {
  try {
    let tab: chrome.tabs.Tab | undefined;
    if (tabId === undefined) {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } else {
      tab = await chrome.tabs.get(tabId);
    }
    if (!tab?.id) return;

    const origin = originOf(tab.url);
    const sites = await getSites();
    const active = origin !== null && sites[origin]?.active === true;

    await chrome.action.setBadgeText({ tabId: tab.id, text: active ? BADGE_TEXT : "" });
    if (active) {
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: BADGE_COLOR });
    }
  } catch (error) {
    console.debug("[ctfd-top] badge update skipped:", String(error));
  }
}

async function refreshAllBadges(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => (tab.id ? updateBadge(tab.id) : Promise.resolve())));
  } catch (error) {
    console.debug("[ctfd-top] badge refresh skipped:", String(error));
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void reconcile().then(() => refreshAllBadges());
});

chrome.runtime.onStartup.addListener(() => {
  void reconcile().then(() => refreshAllBadges());
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as ExtensionMessage | undefined)?.type;
  if (type !== "ctfd-top-reconcile") return undefined;
  void (async () => {
    try {
      await reconcile();
      await refreshAllBadges();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  })();
  return true;
});

chrome.tabs.onActivated.addListener((info) => {
  void updateBadge(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") void updateBadge(tabId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_SITES]) return;
  void refreshAllBadges();
});
