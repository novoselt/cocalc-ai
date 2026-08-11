/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { updateMountedProjectIds } from "./mounted-projects";

describe("updateMountedProjectIds", () => {
  it("does not mount persisted projects until they are activated", () => {
    const mounted = new Set<string>();

    updateMountedProjectIds(mounted, "projects", ["project-a", "project-b"]);

    expect([...mounted]).toEqual([]);
  });

  it("retains activated projects until their tabs close", () => {
    const mounted = new Set<string>();

    updateMountedProjectIds(mounted, "project-a", ["project-a", "project-b"]);
    updateMountedProjectIds(mounted, "projects", ["project-a", "project-b"]);
    expect([...mounted]).toEqual(["project-a"]);

    updateMountedProjectIds(mounted, "project-b", ["project-a", "project-b"]);
    expect([...mounted]).toEqual(["project-a", "project-b"]);

    updateMountedProjectIds(mounted, "project-b", ["project-b"]);
    expect([...mounted]).toEqual(["project-b"]);
  });
});
