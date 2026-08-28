import type { FilterMode, SortMode } from "../shared/types.js";

export interface BarHandlers {
  onSort: () => void;
  onGroup: () => void;
  onFilter: () => void;
  onCompare: () => void;
}

export interface BarState {
  showSort: boolean;
  showFilter: boolean;
  /** Only in focus mode, and only once the focused player has been found. */
  showCompare: boolean;
  mode: SortMode;
  grouped: boolean;
  filter: FilterMode;
  comparing: boolean;
  /** Who the compare button names; empty when there is nobody to compare with. */
  compareName: string;
}

const SORT_LABELS: Record<SortMode, { icon: string; text: string; title: string }> = {
  default: { icon: "⇅", text: "Sort by solves", title: "Sort challenges by solve count" },
  desc: { icon: "↓", text: "Most solved", title: "Most solved first — click for least solved" },
  asc: { icon: "↑", text: "Least solved", title: "Least solved first — click to reset" },
};

const FILTER_LABELS: Record<FilterMode, { icon: string; text: string; title: string }> = {
  all: { icon: "", text: "All challenges", title: "Showing all challenges" },
  solved: { icon: "✓", text: "Solved only", title: "Showing only challenges you solved" },
  unsolved: { icon: "✕", text: "Unsolved only", title: "Showing only challenges you have not solved" },
};

/** Keep a long player name from stretching the bar across the viewport. */
function short(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

function makeButton(className: string): HTMLElement {
  const button = document.createElement("button");
  button.className = `ctfd-top-bar-btn ${className}`;
  button.setAttribute("type", "button");
  const icon = document.createElement("span");
  icon.className = "ctfd-top-btn-icon";
  button.appendChild(icon);
  const text = document.createElement("span");
  text.className = "ctfd-top-btn-text";
  button.appendChild(text);
  return button;
}

function setLabel(button: HTMLElement, icon: string, text: string, title: string): void {
  const iconNode = button.querySelector<HTMLElement>(".ctfd-top-btn-icon");
  const textNode = button.querySelector<HTMLElement>(".ctfd-top-btn-text");
  if (iconNode && iconNode.textContent !== icon) iconNode.textContent = icon;
  if (textNode && textNode.textContent !== text) textNode.textContent = text;
  if (button.getAttribute("title") !== title) button.setAttribute("title", title);
}

/**
 * The fixed top-right bar. The sort/group pair, the filter button and the
 * compare button are independent: any of them can be present on its own.
 */
export class OverlayBar {
  private readonly handlers: BarHandlers;
  private root: HTMLElement | null = null;
  private sortButton: HTMLElement | null = null;
  private groupButton: HTMLElement | null = null;
  private filterButton: HTMLElement | null = null;
  private compareButton: HTMLElement | null = null;

  constructor(handlers: BarHandlers) {
    this.handlers = handlers;
  }

  sync(state: BarState): void {
    if (!state.showSort && !state.showFilter && !state.showCompare) {
      this.destroy();
      return;
    }
    const root = this.ensureRoot();

    if (state.showSort) {
      if (!this.sortButton) {
        this.sortButton = makeButton("ctfd-top-sort");
        this.sortButton.addEventListener("click", () => this.handlers.onSort());
        root.appendChild(this.sortButton);
      }
      if (!this.groupButton) {
        this.groupButton = makeButton("ctfd-top-group");
        this.groupButton.addEventListener("click", () => this.handlers.onGroup());
        root.appendChild(this.groupButton);
      }
      const sortLabel = SORT_LABELS[state.mode];
      this.sortButton.setAttribute("data-mode", state.mode);
      setLabel(this.sortButton, sortLabel.icon, sortLabel.text, sortLabel.title);

      this.groupButton.setAttribute("data-active", state.grouped ? "true" : "false");
      setLabel(
        this.groupButton,
        state.grouped ? "✓" : "⊞",
        state.grouped ? "Grouped by category" : "Group by category",
        state.grouped
          ? "Sorting inside each category — click to sort across all categories"
          : "Sorting across all categories — click to group by category",
      );
    } else {
      this.sortButton?.remove();
      this.sortButton = null;
      this.groupButton?.remove();
      this.groupButton = null;
    }

    if (state.showFilter) {
      if (!this.filterButton) {
        this.filterButton = makeButton("ctfd-top-filter");
        this.filterButton.addEventListener("click", () => this.handlers.onFilter());
      }
      // Keep the filter last in the bar even when sort appears after it.
      root.appendChild(this.filterButton);
      const label = FILTER_LABELS[state.filter];
      this.filterButton.setAttribute("data-mode", state.filter);
      setLabel(this.filterButton, label.icon, label.text, label.title);
    } else {
      this.filterButton?.remove();
      this.filterButton = null;
    }

    if (state.showCompare) {
      if (!this.compareButton) {
        this.compareButton = makeButton("ctfd-top-compare");
        this.compareButton.addEventListener("click", () => this.handlers.onCompare());
      }
      // Compare is the widest change to what is on screen, so it sits last.
      root.appendChild(this.compareButton);
      const name = short(state.compareName);
      this.compareButton.setAttribute("data-active", state.comparing ? "true" : "false");
      setLabel(
        this.compareButton,
        "⇄",
        state.comparing ? `Only you or ${name}` : `Compare with ${name}`,
        state.comparing
          ? `Showing only challenges exactly one of you and ${state.compareName} solved — click to show all`
          : `Show only challenges exactly one of you and ${state.compareName} solved`,
      );
    } else {
      this.compareButton?.remove();
      this.compareButton = null;
    }
  }

  destroy(): void {
    this.root?.remove();
    this.root = null;
    this.sortButton = null;
    this.groupButton = null;
    this.filterButton = null;
    this.compareButton = null;
  }

  private ensureRoot(): HTMLElement {
    if (this.root && this.root.parentElement) return this.root;
    const root = document.createElement("div");
    root.className = "ctfd-top-bar";
    document.body.appendChild(root);
    this.root = root;
    return root;
  }
}
