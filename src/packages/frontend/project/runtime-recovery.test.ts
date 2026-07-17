/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Map as ImmutableMap } from "immutable";

import {
  ProjectRuntimeExitTracker,
  ProjectRuntimeTracker,
  projectRuntimeExitKey,
  projectRuntimeExitReason,
  projectRuntimeId,
  shouldDismissRuntimeRecoveryNotice,
  shouldRecoverFromProjectRuntimeExit,
} from "./runtime-recovery";

describe("project runtime recovery", () => {
  it("reads valid runtime ids", () => {
    expect(projectRuntimeId({ runtime_id: "runtime-a" })).toBe("runtime-a");
    expect(projectRuntimeId({ runtime_id: "" })).toBeUndefined();
    expect(projectRuntimeId({ runtime_id: 10 })).toBeUndefined();
    expect(projectRuntimeId(undefined)).toBeUndefined();
  });

  it("reports only replacements after observing an initial runtime", () => {
    const tracker = new ProjectRuntimeTracker();
    expect(tracker.observe({ runtime_id: "runtime-a" })).toBeUndefined();
    expect(tracker.observe({ runtime_id: "runtime-a" })).toBeUndefined();
    expect(tracker.observe({})).toBeUndefined();
    expect(tracker.observe({ runtime_id: "runtime-b" })).toBe("runtime-b");
    expect(tracker.observe({ runtime_id: "runtime-b" })).toBeUndefined();
    tracker.reset();
    expect(tracker.observe({ runtime_id: "runtime-c" })).toBeUndefined();
  });

  it("reads runtime exit reasons from plain and immutable project state", () => {
    expect(
      projectRuntimeExitReason({
        state: { runtime_exit_reason: "container_missing" },
      }),
    ).toBe("container_missing");
    expect(
      projectRuntimeExitReason(
        ImmutableMap({
          state: ImmutableMap({ runtime_exit_reason: "container_missing" }),
        }),
      ),
    ).toBe("container_missing");
    expect(projectRuntimeExitReason({ state: {} })).toBeUndefined();
  });

  it("recovers only from runtime-loss stop reasons", () => {
    expect(
      shouldRecoverFromProjectRuntimeExit({
        state: { runtime_exit_reason: "container_missing" },
      }),
    ).toBe(true);
    expect(
      shouldRecoverFromProjectRuntimeExit({
        state: { runtime_exit_reason: "host_pressure" },
      }),
    ).toBe(true);
    expect(
      shouldRecoverFromProjectRuntimeExit({
        state: { runtime_exit_reason: "user_stop" },
      }),
    ).toBe(false);
    expect(shouldRecoverFromProjectRuntimeExit({ state: {} })).toBe(false);
  });

  it("dismisses a pending recovery notice once the runtime is running", () => {
    const notice = {
      id: "recovery-1",
      reason: "project_runtime_lost" as const,
      occurred_at: Date.now(),
    };
    expect(
      shouldDismissRuntimeRecoveryNotice({
        projectState: "running",
        notice,
      }),
    ).toBe(true);
    expect(
      shouldDismissRuntimeRecoveryNotice({
        projectState: "opened",
        notice,
      }),
    ).toBe(false);
    expect(
      shouldDismissRuntimeRecoveryNotice({
        projectState: "running",
        notice: undefined,
      }),
    ).toBe(false);
  });

  it("deduplicates explicit runtime exits without requiring a running transition", () => {
    const tracker = new ProjectRuntimeExitTracker();
    const firstExit = {
      state: {
        state: "opened",
        time: "2026-07-14T16:52:32.779Z",
        runtime_exit_reason: "host_pressure",
      },
    };
    expect(projectRuntimeExitKey(firstExit)).toBe(
      "host_pressure:2026-07-14T16:52:32.779Z",
    );
    expect(tracker.observe(firstExit)).toBe("host_pressure");
    expect(tracker.observe(firstExit)).toBeUndefined();
    expect(
      tracker.observe({
        state: {
          ...firstExit.state,
          time: "2026-07-14T17:00:00.000Z",
        },
      }),
    ).toBe("host_pressure");
    expect(
      tracker.observe({
        state: {
          state: "opened",
          time: "2026-07-14T17:01:00.000Z",
          runtime_exit_reason: "user_stop",
        },
      }),
    ).toBeUndefined();
  });
});
