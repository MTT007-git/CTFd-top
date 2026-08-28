import { CHALLENGE_INNER_SELECTOR } from "../shared/constants.js";
import { contrastColor, solveCountColor } from "../shared/colors.js";
import type { SiteSettings, TrackedPlayer } from "../shared/types.js";

export const CLASS = {
  badges: "ctfd-top-badges",
  badge: "ctfd-top-badge",
  bubble: "ctfd-top-bubble",
  space: "ctfd-top-space",
  category: "ctfd-top-cat",
} as const;

const SIG_BADGES = "data-ctfd-top-sig";
const SIG_BUBBLE = "data-ctfd-top-solves-sig";

/** Badges live inside `.challenge-inner`, or on the button itself if the theme lacks it. */
function badgeHost(button: HTMLElement): HTMLElement {
  return button.querySelector<HTMLElement>(CHALLENGE_INNER_SELECTOR) ?? button;
}

function firstChildOf(host: HTMLElement): ChildNode | null {
  return host.firstChild ?? null;
}

function badgeLabel(player: TrackedPlayer, settings: SiteSettings): string {
  if (settings.compact) return `#${player.rank}`;
  const parts: string[] = [];
  if (settings.showRank) parts.push(`#${player.rank}`);
  if (settings.showName) parts.push(player.name);
  // Never render an empty pill.
  return parts.length > 0 ? parts.join(" ") : `#${player.rank}`;
}

function badgeTooltip(player: TrackedPlayer): string {
  const parts = [`Rank #${player.rank}`];
  if (player.name) parts.push(player.name);
  if (Number.isFinite(player.score)) parts.push(`${player.score} pts`);
  if (player.bracket) parts.push(`bracket: ${player.bracket}`);
  return parts.join(" · ");
}

/**
 * Render one pill per tracked solver. Guarded by a signature so repeated render
 * passes over an unchanged card do no DOM work at all.
 */
export function renderBadges(
  button: HTMLElement,
  players: readonly TrackedPlayer[],
  settings: SiteSettings,
): void {
  const ids = players
    .map((player) => player.id)
    .slice()
    .sort((a, b) => a - b)
    .join(",");
  const signature = `${settings.compact ? 1 : 0}${settings.showRank ? 1 : 0}${
    settings.showName ? 1 : 0
  }:${ids}`;
  if (button.getAttribute(SIG_BADGES) === signature) return;
  button.setAttribute(SIG_BADGES, signature);

  const host = badgeHost(button);
  host.querySelector<HTMLElement>(`.${CLASS.badges}`)?.remove();
  if (players.length === 0) return;

  const container = document.createElement("div");
  container.className = CLASS.badges;
  for (const player of players) {
    const pill = document.createElement("span");
    pill.className = CLASS.badge;
    // Inline custom properties: the stylesheet never has to know the palette,
    // and light/dark CTFd themes both stay readable.
    pill.style.setProperty("--ct-bg", player.color);
    pill.style.setProperty("--ct-fg", contrastColor(player.color));
    pill.setAttribute("title", badgeTooltip(player));
    pill.textContent = badgeLabel(player, settings);
    container.appendChild(pill);
  }
  host.appendChild(container);
}

/**
 * Solve-count bubble, pinned to the top-left of the card. `count` of `undefined`
 * means the count is unknown, in which case no bubble is drawn.
 */
export function renderBubble(
  button: HTMLElement,
  count: number | undefined,
  min: number,
  max: number,
): void {
  if (count === undefined) {
    if (button.getAttribute(SIG_BUBBLE) !== null) {
      button.removeAttribute(SIG_BUBBLE);
      button.querySelector<HTMLElement>(`.${CLASS.bubble}`)?.remove();
    }
    return;
  }

  const color = solveCountColor(count, min, max);
  const signature = `${count}:${color}`;
  if (button.getAttribute(SIG_BUBBLE) === signature) return;
  button.setAttribute(SIG_BUBBLE, signature);

  let bubble = button.querySelector<HTMLElement>(`.${CLASS.bubble}`);
  if (!bubble) {
    bubble = document.createElement("span");
    bubble.className = CLASS.bubble;
    button.appendChild(bubble);
  }
  bubble.style.setProperty("--ct-bg", color);
  bubble.style.setProperty("--ct-fg", contrastColor(color));
  bubble.textContent = String(count);
  bubble.setAttribute("title", count === 1 ? "1 solve" : `${count} solves`);
}

export function removeBubble(button: HTMLElement): void {
  button.removeAttribute(SIG_BUBBLE);
  button.querySelector<HTMLElement>(`.${CLASS.bubble}`)?.remove();
}

/**
 * Per-card category label, used when the flat sort hides CTFd's own category
 * headers so categories stay recognizable.
 */
export function setCategoryLabel(button: HTMLElement, category: string | null): void {
  const host = badgeHost(button);
  const existing = host.querySelector<HTMLElement>(`.${CLASS.category}`);
  if (!category) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.textContent !== category) existing.textContent = category;
    return;
  }
  const label = document.createElement("span");
  label.className = CLASS.category;
  label.textContent = category;
  host.insertBefore(label, firstChildOf(host));
}

/**
 * Reserve a strip at the top of the card so the bubble and the category label
 * never overlap the challenge name.
 */
export function ensureSpacer(button: HTMLElement, needed: boolean): void {
  const host = badgeHost(button);
  const existing = host.querySelector<HTMLElement>(`.${CLASS.space}`);
  if (!needed) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const spacer = document.createElement("div");
  spacer.className = CLASS.space;
  const label = host.querySelector<HTMLElement>(`.${CLASS.category}`);
  host.insertBefore(spacer, label ? label.nextSibling : firstChildOf(host));
}

/** Remove every injected node and signature, leaving the page as we found it. */
export function removeAllInjected(root: Document | HTMLElement): void {
  for (const selector of [CLASS.badges, CLASS.bubble, CLASS.space, CLASS.category]) {
    for (const node of Array.from(root.querySelectorAll<HTMLElement>(`.${selector}`))) {
      node.remove();
    }
  }
  for (const attribute of [SIG_BADGES, SIG_BUBBLE]) {
    for (const node of Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`))) {
      node.removeAttribute(attribute);
    }
  }
}
