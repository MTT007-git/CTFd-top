import { INDICATOR_TIMEOUTS } from "../shared/constants.js";
import type { IndicatorState } from "../shared/types.js";

/**
 * Small floating pill in the bottom-left corner: what the extension is doing,
 * a refresh button, and a close button. It is the only place errors surface —
 * when the API fails, the CTFd DOM itself is left untouched.
 */
export class StatusIndicator {
  private readonly onRefresh: () => void;
  private root: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enabled: boolean;

  constructor(onRefresh: () => void, enabled: boolean) {
    this.onRefresh = onRefresh;
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.destroy();
  }

  show(state: IndicatorState, message: string): void {
    if (!this.enabled) return;
    const root = this.ensureRoot();
    root.setAttribute("data-state", state);
    root.classList.remove("ctfd-top-hidden");
    if (this.message) this.message.textContent = message;

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), INDICATOR_TIMEOUTS[state]);
  }

  hide(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.root?.classList.add("ctfd-top-hidden");
  }

  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.root?.remove();
    this.root = null;
    this.message = null;
  }

  private ensureRoot(): HTMLElement {
    // Rebuild if a page re-render tore our node out from under us.
    if (this.root && this.root.parentElement) return this.root;

    const root = document.createElement("div");
    root.className = "ctfd-top-indicator";

    const message = document.createElement("span");
    message.className = "ctfd-top-indicator-msg";
    root.appendChild(message);

    const refresh = document.createElement("button");
    refresh.className = "ctfd-top-indicator-btn";
    refresh.setAttribute("type", "button");
    refresh.setAttribute("title", "Refresh leaderboard data");
    refresh.textContent = "↻";
    refresh.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onRefresh();
    });
    root.appendChild(refresh);

    const close = document.createElement("button");
    close.className = "ctfd-top-indicator-close";
    close.setAttribute("type", "button");
    close.setAttribute("title", "Hide");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hide();
    });
    root.appendChild(close);

    document.body.appendChild(root);
    this.root = root;
    this.message = message;
    return root;
  }
}
