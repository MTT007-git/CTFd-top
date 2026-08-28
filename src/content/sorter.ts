import { CATEGORY_HEADER_SELECTOR } from "../shared/constants.js";
import type { SortMode } from "../shared/types.js";
import { setCategoryLabel } from "./badges.js";
import type { ChallengeEntry } from "./cards.js";
import { countChallengeButtons } from "./cards.js";

const HIDDEN_ATTR = "data-ctfd-top-hidden";
const PADDED_ATTR = "data-ctfd-top-padded";

interface Snapshot {
  /** Identifies the DOM generation the snapshot was taken from. */
  key: string;
  containers: Map<HTMLElement, Element[]>;
  cards: Set<HTMLElement>;
}

/** Unknown counts sort last in both directions. */
function compare(a: ChallengeEntry, b: ChallengeEntry, mode: SortMode): number {
  if (a.count === null && b.count === null) return 0;
  if (a.count === null) return 1;
  if (b.count === null) return -1;
  return mode === "asc" ? a.count - b.count : b.count - a.count;
}

function sortEntries(entries: readonly ChallengeEntry[], mode: SortMode): ChallengeEntry[] {
  // Array#sort is stable, so ties keep their original relative order.
  return entries.slice().sort((a, b) => compare(a, b, mode));
}

/** Ancestor chain, nearest first. */
function ancestry(element: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let node: HTMLElement | null = element;
  while (node) {
    chain.push(node);
    node = node.parentElement;
  }
  return chain;
}

/** The deepest element containing all of `elements`; itself, for a single one. */
function lowestCommonAncestor(elements: readonly HTMLElement[]): HTMLElement | null {
  if (elements.length === 0) return null;
  let common = ancestry(elements[0]);
  for (const element of elements.slice(1)) {
    const chain = new Set(ancestry(element));
    common = common.filter((node) => chain.has(node));
  }
  return common[0] ?? null;
}

/**
 * Climb from an emptied container as far as the branch stays free of challenge
 * buttons, stopping below `boundary` so a shared container is never hidden.
 */
function highestEmptyAncestor(container: HTMLElement, boundary: HTMLElement | null): HTMLElement {
  let node = container;
  while (
    node.parentElement &&
    node.parentElement !== boundary &&
    node.parentElement !== document.body &&
    countChallengeButtons(node.parentElement) === 0
  ) {
    node = node.parentElement;
  }
  return node;
}

/**
 * Reorders challenge cards using the already-cached solve counts. Never issues a
 * request, and can always put the page back exactly as it was found.
 */
export class SortController {
  private mode: SortMode = "default";
  private grouped = true;
  private snapshot: Snapshot | null = null;
  private hidden: HTMLElement[] = [];
  private padded: HTMLElement[] = [];
  private labeled: HTMLElement[] = [];

  getMode(): SortMode {
    return this.mode;
  }

  setMode(mode: SortMode): void {
    this.mode = mode;
  }

  /** default -> most solved -> least solved -> default */
  cycleMode(): SortMode {
    this.mode = this.mode === "default" ? "desc" : this.mode === "desc" ? "asc" : "default";
    return this.mode;
  }

  isGrouped(): boolean {
    return this.grouped;
  }

  setGrouped(grouped: boolean): void {
    this.grouped = grouped;
  }

  apply(entries: readonly ChallengeEntry[]): void {
    if (entries.length === 0) return;
    this.ensureSnapshot(entries);

    if (this.mode === "default") {
      this.restoreOrder();
      this.clearDecorations();
      return;
    }
    if (this.grouped) this.applyGrouped(entries);
    else this.applyFlat(entries);
  }

  /** Put every card back where it started and undo every visual change. */
  destroy(): void {
    this.restoreOrder();
    this.clearDecorations();
    this.snapshot = null;
    this.mode = "default";
  }

  /**
   * Snapshot the original child order once per DOM generation, so "default"
   * restores the page exactly — including cards a flat sort moved between rows.
   */
  private ensureSnapshot(entries: readonly ChallengeEntry[]): void {
    const key = entries
      .map((entry) => entry.id)
      .slice()
      .sort((a, b) => a - b)
      .join(",");
    if (this.snapshot && this.snapshot.key === key && this.snapshotIsLive(entries)) return;

    const containers = new Map<HTMLElement, Element[]>();
    for (const entry of entries) {
      const parent = entry.card.parentElement;
      if (!parent || containers.has(parent)) continue;
      containers.set(parent, Array.from(parent.children));
    }
    this.snapshot = {
      key,
      containers,
      cards: new Set(entries.map((entry) => entry.card)),
    };
  }

  /** A snapshot is stale once CTFd re-renders the list with fresh elements. */
  private snapshotIsLive(entries: readonly ChallengeEntry[]): boolean {
    const snapshot = this.snapshot;
    if (!snapshot) return false;
    for (const entry of entries) {
      if (!snapshot.cards.has(entry.card)) return false;
      if (!entry.card.parentElement) return false;
    }
    return true;
  }

  private restoreOrder(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    for (const [container, children] of snapshot.containers) {
      for (const child of children) {
        // Detached nodes are either gone from the page or currently filtered
        // out; re-appending them here would resurrect them.
        if (!child.parentElement) continue;
        container.appendChild(child);
      }
    }
  }

  private applyGrouped(entries: readonly ChallengeEntry[]): void {
    // Start from the original layout so a previous flat sort is undone first.
    this.restoreOrder();
    this.clearDecorations();

    const byContainer = new Map<HTMLElement, ChallengeEntry[]>();
    for (const entry of entries) {
      const parent = entry.card.parentElement;
      if (!parent) continue;
      const list = byContainer.get(parent);
      if (list) list.push(entry);
      else byContainer.set(parent, [entry]);
    }

    for (const [container, list] of byContainer) {
      // Categories keep their original first-appearance order; only the cards
      // inside each category are reordered.
      const order: string[] = [];
      const buckets = new Map<string, ChallengeEntry[]>();
      for (const entry of list) {
        const bucket = buckets.get(entry.category);
        if (bucket) bucket.push(entry);
        else {
          buckets.set(entry.category, [entry]);
          order.push(entry.category);
        }
      }
      const sorted: ChallengeEntry[] = [];
      for (const category of order) {
        sorted.push(...sortEntries(buckets.get(category) ?? [], this.mode));
      }
      this.reorderWithin(container, list, sorted);
    }
  }

  private applyFlat(entries: readonly ChallengeEntry[]): void {
    this.restoreOrder();
    this.clearDecorations();

    const target = entries[0]?.card.parentElement;
    if (!target) return;

    for (const entry of sortEntries(entries, this.mode)) {
      target.appendChild(entry.card);
    }

    // CTFd's own category rows would be meaningless now.
    for (const header of Array.from(
      document.querySelectorAll<HTMLElement>(CATEGORY_HEADER_SELECTOR),
    )) {
      this.hide(header);
    }

    // CTFd wraps each category's header and row in a spacing container. Hiding
    // only the emptied row leaves that wrapper's vertical padding behind, which
    // stacks up into large gaps above and below the surviving row — so hide the
    // whole emptied branch, up to but never including the shared board.
    const containers = this.snapshot ? [...this.snapshot.containers.keys()] : [target];
    const shared = lowestCommonAncestor(containers);
    const boundary = !shared || shared === target ? target.parentElement : shared;

    for (const container of containers) {
      if (container === target || countChallengeButtons(container) > 0) continue;
      this.hide(highestEmptyAncestor(container, boundary));
    }

    // No leading gap above the surviving row, wherever the theme puts it.
    for (
      let node: HTMLElement | null = target;
      node && node !== boundary && node !== document.body;
      node = node.parentElement
    ) {
      this.pad(node);
    }

    // Each card carries its own category now that the headers are gone.
    for (const entry of entries) {
      if (!entry.category) continue;
      setCategoryLabel(entry.button, entry.category);
      this.labeled.push(entry.button);
    }
  }

  /**
   * Move `sorted` into the slot the cards currently occupy, leaving any other
   * children of the container (such as an inline category header) in place.
   */
  private reorderWithin(
    container: HTMLElement,
    current: readonly ChallengeEntry[],
    sorted: readonly ChallengeEntry[],
  ): void {
    const cards = new Set(current.map((entry) => entry.card));
    const children = Array.from(container.children);
    const firstIndex = children.findIndex((child) => cards.has(child as HTMLElement));
    let anchor: Element | null = null;
    for (let i = firstIndex + 1; i < children.length; i++) {
      if (!cards.has(children[i] as HTMLElement)) {
        anchor = children[i];
        break;
      }
    }
    for (const entry of sorted) container.insertBefore(entry.card, anchor);
  }

  /** Zero the vertical lead-in a theme puts on the surviving branch. */
  private pad(element: HTMLElement): void {
    if (element.getAttribute(PADDED_ATTR) === "1") return;
    element.setAttribute(PADDED_ATTR, "1");
    element.style.setProperty("padding-top", "0");
    element.style.setProperty("margin-top", "0");
    this.padded.push(element);
  }

  private hide(element: HTMLElement): void {
    if (element.getAttribute(HIDDEN_ATTR) === "1") return;
    element.setAttribute(HIDDEN_ATTR, "1");
    element.style.setProperty("display", "none");
    this.hidden.push(element);
  }

  private clearDecorations(): void {
    for (const element of this.hidden) {
      element.removeAttribute(HIDDEN_ATTR);
      element.style.removeProperty("display");
    }
    this.hidden = [];
    for (const element of this.padded) {
      element.style.removeProperty("padding-top");
      element.style.removeProperty("margin-top");
      element.removeAttribute(PADDED_ATTR);
    }
    this.padded = [];
    for (const button of this.labeled) setCategoryLabel(button, null);
    this.labeled = [];
  }
}
