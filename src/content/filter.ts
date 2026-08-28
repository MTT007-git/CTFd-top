import type { FilterMode } from "../shared/types.js";
import type { ChallengeEntry } from "./cards.js";
import { filterUnitOf, isChallengeCard } from "./cards.js";

interface RemovedCard {
  id: number;
  card: HTMLElement;
  parent: HTMLElement;
  next: ChildNode | null;
}

/**
 * Compare pass: challenge id -> whether the compared player solved it. A
 * challenge missing from the map is one whose solvers are not resolved yet.
 */
export type ComparedSolves = ReadonlyMap<number, boolean>;

/**
 * Solved / unsolved filter, plus the optional compare pass.
 *
 * Cards are physically removed rather than hidden with `display: none`, which
 * would leave empty tracks in CTFd's CSS grid. Each removal remembers where the
 * card came from so "All" restores the page faithfully.
 */
export class FilterController {
  private mode: FilterMode = "all";
  private removed: RemovedCard[] = [];

  getMode(): FilterMode {
    return this.mode;
  }

  setMode(mode: FilterMode): void {
    this.mode = mode;
  }

  /** All -> solved only -> unsolved only -> All */
  cycleMode(): FilterMode {
    this.mode = this.mode === "all" ? "solved" : this.mode === "solved" ? "unsolved" : "all";
    return this.mode;
  }

  /**
   * Always restores first, so a switch straight from "solved" to "unsolved"
   * still considers the cards the previous pass removed.
   *
   * `compared`, when given, additionally drops every challenge the two of you
   * agree on — both solved or neither did — leaving only the difference. It
   * composes with the mode, so "solved" then means yours alone and "unsolved"
   * theirs alone.
   */
  apply(
    entries: readonly ChallengeEntry[],
    solvedByMe: ReadonlyMap<number, boolean>,
    compared: ComparedSolves | null = null,
  ): void {
    this.restoreAll();
    if (this.mode === "all" && !compared) return;

    const touched = new Set<HTMLElement>();
    for (const entry of entries) {
      const card = filterUnitOf(entry.button);
      const parent = card.parentElement;
      if (!parent) continue;
      const solved = solvedByMe.get(entry.id) === true;
      const theirs = compared?.get(entry.id);
      // An unresolved challenge is never grounds for hiding a card.
      const differs = theirs === undefined || theirs !== solved;
      const keep =
        differs && (this.mode === "all" ? true : this.mode === "solved" ? solved : !solved);
      if (keep) {
        touched.add(parent);
        continue;
      }
      this.removed.push({ id: entry.id, card, parent, next: card.nextSibling });
      card.remove();
    }

    // Re-append the survivors so each row reflows from its start.
    for (const parent of touched) {
      for (const child of Array.from(parent.children)) {
        if (isChallengeCard(child)) parent.appendChild(child);
      }
    }
  }

  /**
   * Challenge ids currently filtered out of the DOM. The fallback path still
   * needs their solvers, so they are not forgotten while hidden.
   */
  removedIds(): number[] {
    return this.removed.map((entry) => entry.id);
  }

  restoreAll(): void {
    // Reverse order: a card's recorded next sibling may itself have been
    // removed later, and by then it is back in place.
    for (let i = this.removed.length - 1; i >= 0; i--) {
      const { card, parent, next } = this.removed[i];
      if (next && next.parentNode === parent) parent.insertBefore(card, next);
      else parent.appendChild(card);
    }
    this.removed = [];
  }

  destroy(): void {
    this.restoreAll();
    this.mode = "all";
  }
}
