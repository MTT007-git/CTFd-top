import type { ProgressMetric } from "../shared/types.js";

export interface ProgressStats {
  solvedTasks: number;
  totalTasks: number;
  solvedPoints: number;
  totalPoints: number;
  metric: ProgressMetric;
}

const CLASS = "ctfd-top-progress";

/**
 * Personal progress bar, inserted after the challenges page header. Created
 * once and updated in place on later render passes. Clicking (or pressing
 * Enter/Space on) the bar switches between tasks and points.
 */
export class ProgressBar {
  private readonly onToggleMetric: () => void;
  private root: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private fill: HTMLElement | null = null;

  constructor(onToggleMetric: () => void) {
    this.onToggleMetric = onToggleMetric;
  }

  update(stats: ProgressStats): void {
    const done = stats.metric === "points" ? stats.solvedPoints : stats.solvedTasks;
    const total = stats.metric === "points" ? stats.totalPoints : stats.totalTasks;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const noun = stats.metric === "points" ? "points earned" : "tasks solved";
    const other = stats.metric === "points" ? "tasks solved" : "points earned";

    const root = this.ensureRoot();
    if (!root) return;
    const text = `${done} / ${total} ${noun} (${percent}%)`;
    if (this.label) this.label.textContent = text;
    if (this.fill) this.fill.style.setProperty("width", `${percent}%`);
    root.setAttribute("title", `${done} of ${total} ${noun} — click to show ${other}`);
    root.setAttribute("aria-label", `${text}. Click to show ${other}.`);
    root.setAttribute("data-metric", stats.metric);
  }

  remove(): void {
    this.root?.remove();
    this.root = null;
    this.label = null;
    this.fill = null;
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root && this.root.parentElement) return this.root;

    // Sits directly under the page header and above the cards.
    const header =
      document.querySelector<HTMLElement>("div.jumbotron") ??
      document.querySelector<HTMLElement>(".pb-5");
    const parent = header?.parentElement;
    if (!header || !parent) return null;

    const root = document.createElement("div");
    root.className = CLASS;
    // A div rather than a <button>, because the bar's contents are block-level;
    // the role, tab stop and key handling make it behave like one anyway.
    root.setAttribute("role", "button");
    root.setAttribute("tabindex", "0");
    root.addEventListener("click", (event) => {
      event.preventDefault();
      this.onToggleMetric();
    });
    root.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
      event.preventDefault();
      this.onToggleMetric();
    });

    const label = document.createElement("div");
    label.className = "ctfd-top-progress-label";
    root.appendChild(label);

    const track = document.createElement("div");
    track.className = "ctfd-top-progress-track";
    const fill = document.createElement("div");
    fill.className = "ctfd-top-progress-fill";
    track.appendChild(fill);
    root.appendChild(track);

    parent.insertBefore(root, header.nextSibling);
    this.root = root;
    this.label = label;
    this.fill = fill;
    return root;
  }
}
