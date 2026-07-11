/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { finishedAutomationRunFromJob } from "../active-automation-run";

describe("ACP automation active-run helpers", () => {
  it("recovers automation completion from a terminal job", () => {
    expect(
      finishedAutomationRunFromJob({ state: "completed", error: null }),
    ).toEqual({ terminalState: "completed" });
    expect(
      finishedAutomationRunFromJob({ state: "error", error: "agent failed" }),
    ).toEqual({ terminalState: "error", error: "agent failed" });
    expect(
      finishedAutomationRunFromJob({
        state: "interrupted",
        error: "worker restarted",
      }),
    ).toEqual({ terminalState: "interrupted", error: "worker restarted" });
  });

  it("does not finalize queued or running jobs", () => {
    expect(
      finishedAutomationRunFromJob({ state: "queued", error: null }),
    ).toBeUndefined();
    expect(
      finishedAutomationRunFromJob({ state: "running", error: null }),
    ).toBeUndefined();
  });
});
