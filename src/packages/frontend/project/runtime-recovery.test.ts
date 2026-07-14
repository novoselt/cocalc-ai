/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Map as ImmutableMap } from "immutable";

import {
  ProjectRuntimeTracker,
  projectRuntimeExitReason,
  projectRuntimeId,
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
});
