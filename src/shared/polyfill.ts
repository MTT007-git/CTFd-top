/**
 * Cross-browser shim, imported first by every entry point.
 *
 * The whole codebase calls `chrome.*` in promise style. Chrome MV3 supports that
 * natively; on Firefox the promise-based namespace is `browser.*` (its `chrome.*`
 * is callback-only). Aliasing once here means every `await chrome.*` call in the
 * rest of the codebase works unchanged on both browsers. On Chrome, where
 * `globalThis.browser` does not exist, this is a no-op.
 */
const scope = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };

if (scope.browser && scope.browser !== scope.chrome) {
  scope.chrome = scope.browser;
}

export {};
