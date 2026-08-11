/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  markSignedInSurfaceReady,
  onSignedInSurfaceReady,
  signedInSurfaceReadySegment,
} from "./surface-ready-state";

describe("signed-in surface ready state", () => {
  it("notifies current and late subscribers exactly once", () => {
    const first = jest.fn();
    const late = jest.fn();
    const unsubscribe = onSignedInSurfaceReady(first);

    markSignedInSurfaceReady("projects");
    markSignedInSurfaceReady("project");
    onSignedInSurfaceReady(late);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith("projects");
    expect(late).toHaveBeenCalledWith("projects");
    expect(signedInSurfaceReadySegment()).toBe("projects");
    unsubscribe();
  });
});
