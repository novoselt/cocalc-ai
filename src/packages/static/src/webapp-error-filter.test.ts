import {
  isIgnorableBrowserError,
  isIgnorableUnhandledRejection,
  isOpaqueCrossOriginScriptError,
} from "./webapp-error-filter";

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

describe("isIgnorableUnhandledRejection", () => {
  test.each([
    new Error(
      "rootfs is not mounted; cannot access absolute path '/home'. Start the project and try again.",
    ),
    new Error(
      "unable to route 'ProjectActions.fs' to project-host for project 00000000-0000-4000-8000-000000000000; host routing info unavailable",
    ),
    new Error('once: timeout of 4000ms waiting for "info"'),
    new Error(
      'COCALC_RUNTIME_SPONSOR_DENIAL:{"code":"runtime_sponsor_slots_exhausted","sponsor_account_id":"00000000-0000-4000-8000-000000000001","limit":1,"current":1,"active_projects":[]}',
    ),
  ])("ignores an expected non-actionable rejection", (reason) => {
    expect(isIgnorableUnhandledRejection(reason)).toBe(true);
  });

  test.each([
    new Error("permission denied"),
    new Error("unable to route billing request"),
    new Error('once: timeout of 4000ms waiting for "ready"'),
    new Error("COCALC_RUNTIME_SPONSOR_DENIAL:not-json"),
    "rootfs is not mounted",
    undefined,
  ])("preserves an actionable rejection %p", (reason) => {
    expect(isIgnorableUnhandledRejection(reason)).toBe(false);
  });
});

describe("isOpaqueCrossOriginScriptError", () => {
  it("ignores Safari's detail-free cross-origin script error", () => {
    expect(
      isOpaqueCrossOriginScriptError({
        message: "Script error.",
        error: null,
        filename: "",
        lineNumber: 0,
      }),
    ).toBe(true);
  });

  test.each([
    {
      message: "Script error.",
      error: new Error("Script error."),
      filename: "",
      lineNumber: 0,
    },
    {
      message: "Script error.",
      error: null,
      filename: "https://cocalc.ai/app.js",
      lineNumber: 0,
    },
    {
      message: "Script error.",
      error: null,
      filename: "",
      lineNumber: 42,
    },
    {
      message: "TypeError: script failed",
      error: null,
      filename: "",
      lineNumber: 0,
    },
  ])("preserves an error with actionable details: %p", (event) => {
    expect(isOpaqueCrossOriginScriptError(event)).toBe(false);
  });
});
