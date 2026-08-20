/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { updateMountedProjectIds } from "./mounted-projects";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

describe("updateMountedProjectIds", () => {
  it("does not mount persisted projects until they are activated", () => {
    const mounted = new Set<string>();

    updateMountedProjectIds(mounted, "projects", [PROJECT_A, PROJECT_B]);

    expect([...mounted]).toEqual([]);
  });

  it("retains activated projects until their tabs close", () => {
    const mounted = new Set<string>();

    updateMountedProjectIds(mounted, PROJECT_A, [PROJECT_A, PROJECT_B]);
    updateMountedProjectIds(mounted, "projects", [PROJECT_A, PROJECT_B]);
    expect([...mounted]).toEqual([PROJECT_A]);

    updateMountedProjectIds(mounted, PROJECT_B, [PROJECT_A, PROJECT_B]);
    expect([...mounted]).toEqual([PROJECT_A, PROJECT_B]);

    updateMountedProjectIds(mounted, PROJECT_B, [PROJECT_B]);
    expect([...mounted]).toEqual([PROJECT_B]);
  });

  it("rejects malformed project ids from persisted tab state", () => {
    const mounted = new Set(["undefined", PROJECT_A]);

    updateMountedProjectIds(mounted, "undefined", ["undefined", PROJECT_A]);

    expect([...mounted]).toEqual([PROJECT_A]);
  });
});
