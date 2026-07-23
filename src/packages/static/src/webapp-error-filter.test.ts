import { isIgnorableBrowserError } from "./webapp-error-filter";

describe("isIgnorableBrowserError", () => {
  test.each([
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ])("ignores the browser-generated delivery warning %p", (message) => {
    expect(isIgnorableBrowserError(message)).toBe(true);
  });

  test.each([
    "TypeError: ResizeObserver callback failed",
    "ResizeObserver loop completed with undelivered notifications: callback failed",
    new Error("ResizeObserver loop limit exceeded"),
    undefined,
  ])("preserves real or malformed errors %p", (message) => {
    expect(isIgnorableBrowserError(message)).toBe(false);
  });
});
