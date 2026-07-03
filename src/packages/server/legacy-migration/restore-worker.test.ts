/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { __test__ } from "./restore-worker";

describe("legacy migration restore worker", () => {
  it("adds restore headroom to legacy project disk usage before restore", () => {
    expect(__test__.restoredProjectDiskQuotaMbFromLegacyDiskMb(6624)).toBe(
      7648,
    );
    expect(__test__.restoredProjectDiskQuotaMbFromLegacyDiskMb("6624.1")).toBe(
      7649,
    );
  });

  it("ignores missing or invalid legacy project disk usage", () => {
    expect(__test__.restoredProjectDiskQuotaMbFromLegacyDiskMb(null)).toBe(
      undefined,
    );
    expect(__test__.restoredProjectDiskQuotaMbFromLegacyDiskMb(0)).toBe(
      undefined,
    );
    expect(__test__.restoredProjectDiskQuotaMbFromLegacyDiskMb("nope")).toBe(
      undefined,
    );
  });
});
