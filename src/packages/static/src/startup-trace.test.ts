/** @jest-environment jsdom */

import { initializeStartupTrace, startupRouteSegment } from "./startup-trace";

const originalPerformanceObserver = globalThis.PerformanceObserver;
const originalSendBeacon = Object.getOwnPropertyDescriptor(
  navigator,
  "sendBeacon",
);

beforeEach(() => {
  jest.useFakeTimers();
  document.body.dataset.cocalcEntry = "app";
  delete globalThis.__COCALC_STARTUP_TRACE__;
  Object.defineProperty(globalThis, "PerformanceObserver", {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: jest.fn(() => true),
  });
});

afterEach(() => {
  jest.useRealTimers();
  delete globalThis.__COCALC_STARTUP_TRACE__;
  Object.defineProperty(globalThis, "PerformanceObserver", {
    configurable: true,
    value: originalPerformanceObserver,
  });
  if (originalSendBeacon == null) {
    delete (navigator as any).sendBeacon;
  } else {
    Object.defineProperty(navigator, "sendBeacon", originalSendBeacon);
  }
  jest.restoreAllMocks();
});

test("classifies startup routes without including project identifiers", () => {
  expect(startupRouteSegment("/projects")).toBe("projects");
  expect(
    startupRouteSegment(
      "/projects/af027aca-e308-41c2-b528-a3e73de50996/files/home/user/private",
    ),
  ).toBe("project");
  expect(startupRouteSegment("/settings/billing")).toBe("account");
});

test("completion suppresses the incomplete-start beacon", () => {
  const sendBeacon = navigator.sendBeacon as jest.Mock;
  const trace = initializeStartupTrace();
  trace?.mark("test_phase");
  trace?.complete();
  jest.advanceTimersByTime(31_000);

  expect(trace?.snapshot().marks.test_phase).toBeGreaterThanOrEqual(0);
  expect(sendBeacon).not.toHaveBeenCalled();
});

test("records privacy-safe details with startup phases", () => {
  const trace = initializeStartupTrace();
  trace?.mark("account_snapshot_applied", { field_count: 4 });

  expect(trace?.snapshot().details.phase_details).toEqual({
    account_snapshot_applied: { field_count: 4 },
  });
});

test("reports a startup that remains incomplete", () => {
  const sendBeacon = navigator.sendBeacon as jest.Mock;
  initializeStartupTrace();
  jest.advanceTimersByTime(30_000);

  expect(sendBeacon).toHaveBeenCalledTimes(1);
  const [, body] = sendBeacon.mock.calls[0];
  expect(body).toBeInstanceOf(Blob);
});
