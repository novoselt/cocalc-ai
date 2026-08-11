/** @jest-environment jsdom */

import {
  markStartupPhase,
  markStartupPhaseOnce,
  resetStartupPhaseMarksForTests,
} from "./startup-phase";

describe("startup phase marker", () => {
  const mark = jest.fn();

  beforeEach(() => {
    mark.mockReset();
    resetStartupPhaseMarksForTests();
    (globalThis as any).__COCALC_STARTUP_TRACE__ = { mark };
  });

  afterEach(() => {
    delete (globalThis as any).__COCALC_STARTUP_TRACE__;
  });

  it("passes privacy-safe phase details to the pre-app trace", () => {
    markStartupPhase("account_snapshot_ready", { field_count: 4 });
    expect(mark).toHaveBeenCalledWith("account_snapshot_ready", {
      field_count: 4,
    });
  });

  it("can preserve the first occurrence of a startup phase", () => {
    markStartupPhaseOnce("customize_requested");
    markStartupPhaseOnce("customize_requested");
    expect(mark).toHaveBeenCalledTimes(1);
  });
});
