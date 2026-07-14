/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ProjectRuntimeTracker, projectRuntimeId } from "./runtime-recovery";

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
  });
});
