/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  __test__,
  beginProjectRuntimeMaintenance,
  endProjectRuntimeMaintenance,
  getProjectRuntimeMaintenanceState,
} from "./runtime-maintenance";

describe("project runtime maintenance admission state", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-maintenance-"));
    process.env.COCALC_DATA = dataDir;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.COCALC_DATA;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("publishes and clears a bounded maintenance gate", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    const state = beginProjectRuntimeMaintenance({
      reason: "container runtime migration",
      ttlMs: 30_000,
    });

    expect(getProjectRuntimeMaintenanceState()).toEqual(state);
    expect(fs.existsSync(__test__.statePath())).toBe(true);

    endProjectRuntimeMaintenance();
    expect(getProjectRuntimeMaintenanceState()).toBeUndefined();
  });

  it("expires stale maintenance without permanently denying starts", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(2_000_000);
    beginProjectRuntimeMaintenance({
      reason: "container runtime migration",
      ttlMs: 1_000,
    });
    now.mockReturnValue(2_001_001);

    expect(getProjectRuntimeMaintenanceState()).toBeUndefined();
    expect(fs.existsSync(__test__.statePath())).toBe(false);
  });
});
