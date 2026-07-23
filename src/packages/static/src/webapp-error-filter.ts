const IGNORED_BROWSER_ERROR_MESSAGES = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

export function isIgnorableBrowserError(message: unknown): boolean {
  return (
    typeof message === "string" &&
    IGNORED_BROWSER_ERROR_MESSAGES.has(message.trim())
  );
}
