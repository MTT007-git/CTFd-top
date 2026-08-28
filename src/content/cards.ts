import {
  CARD_COLUMN_PATTERN,
  CHALLENGE_BUTTON_SELECTOR,
} from "../shared/constants.js";

/** One challenge as it appears on the page. */
export interface ChallengeEntry {
  button: HTMLElement;
  id: number;
  /** The sortable unit: the Bootstrap column wrapping the button. */
  card: HTMLElement;
  count: number | null;
  category: string;
}

export function challengeIdOf(button: HTMLElement): number | null {
  const raw = button.getAttribute("value");
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function challengeButtons(root: Document | HTMLElement = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CHALLENGE_BUTTON_SELECTOR));
}

export function countChallengeButtons(root: HTMLElement): number {
  return root.querySelectorAll(CHALLENGE_BUTTON_SELECTOR).length;
}

/** The nearest `col-*` ancestor, falling back to the button's parent. */
export function columnOf(button: HTMLElement): HTMLElement {
  let node: HTMLElement | null = button.parentElement;
  while (node) {
    const className = typeof node.className === "string" ? node.className : "";
    if (CARD_COLUMN_PATTERN.test(className)) return node;
    node = node.parentElement;
  }
  return button.parentElement ?? button;
}

/**
 * The unit the filter adds and removes: the outermost ancestor that still wraps
 * exactly one challenge button.
 */
export function filterUnitOf(button: HTMLElement): HTMLElement {
  let node: HTMLElement = button;
  let parent: HTMLElement | null = node.parentElement;
  while (parent && parent !== document.body && countChallengeButtons(parent) === 1) {
    node = parent;
    parent = node.parentElement;
  }
  return node;
}

export function isChallengeCard(node: Element): boolean {
  const element = node as HTMLElement;
  if (typeof element.querySelector !== "function") return false;
  return element.querySelector(CHALLENGE_BUTTON_SELECTOR) !== null;
}
