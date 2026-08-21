/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  browserIdleStopDeadline,
  browserIdleTimeoutSeconds,
} from "./browser-runtime";

describe("browser runtime idle policy", () => {
  it("only recognizes the explicit browser idle quota", () => {
    expect(browserIdleTimeoutSeconds({ idle_timeout: 1800 })).toBe(0);
    expect(browserIdleTimeoutSeconds({ browser_idle_timeout: 1800 })).toBe(
      1800,
    );
    expect(browserIdleTimeoutSeconds({ browser_idle_timeout: -1 })).toBe(0);
  });

  it("uses the newest runtime or browser activity", () => {
    expect(
      browserIdleStopDeadline({
        project: {
          project_id: "project-1",
          state: "running",
          state_updated_at: 1_000,
          run_quota: { browser_idle_timeout: 30 },
        },
        stopState: {
          project_id: "project-1",
          last_started_ms: 2_000,
          last_browser_activity_ms: 3_000,
        },
      }),
    ).toBe(33_000);
  });

  it("does not stop paid, stopped, or exam projects", () => {
    expect(
      browserIdleStopDeadline({
        project: {
          project_id: "project-1",
          state: "running",
          state_updated_at: 1_000,
          run_quota: { browser_idle_timeout: 0 },
        },
      }),
    ).toBeUndefined();
    expect(
      browserIdleStopDeadline({
        project: {
          project_id: "project-1",
          state: "opened",
          state_updated_at: 1_000,
          run_quota: { browser_idle_timeout: 30 },
        },
      }),
    ).toBeUndefined();
    expect(
      browserIdleStopDeadline({
        project: {
          project_id: "project-1",
          state: "running",
          state_updated_at: 1_000,
          exam_run_id: "exam-1",
          run_quota: { browser_idle_timeout: 30 },
        },
      }),
    ).toBeUndefined();
  });
});
