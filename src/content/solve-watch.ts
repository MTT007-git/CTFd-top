import { SOLVED_CLASS_PATTERN } from "../shared/constants.js";
import type { ChallengeEntry } from "./cards.js";

/** True when the theme has marked this element as solved by the current account. */
function looksSolved(element: HTMLElement | null): boolean {
  const className = typeof element?.className === "string" ? element.className : "";
  if (!className) return false;
  return className.split(/\s+/).some((token) => token !== "" && SOLVED_CLASS_PATTERN.test(token));
}

/**
 * Notices when the page starts calling a challenge "solved" that it did not call
 * solved a moment ago.
 *
 * This is the one place the extension reads solve state out of the DOM, and it
 * never uses it as data: it is a trigger telling us the API now has something
 * new to say. Everything actually rendered still comes from `/api/v1`.
 */
export class SolveWatcher {
  private readonly state = new Map<number, boolean>();

  /**
   * Fold the current DOM into the baseline and report the challenges that just
   * flipped to solved. A challenge seen for the first time is only recorded —
   * a card that arrives already solved is history, not a fresh solve.
   */
  check(entries: readonly ChallengeEntry[]): number[] {
    const fresh: number[] = [];
    for (const entry of entries) {
      const solved = looksSolved(entry.button) || looksSolved(entry.card);
      if (this.state.get(entry.id) === false && solved) fresh.push(entry.id);
      this.state.set(entry.id, solved);
    }
    return fresh;
  }

  forget(): void {
    this.state.clear();
  }
}
