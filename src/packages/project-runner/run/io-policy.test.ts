/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  DEFAULT_PROJECT_IO_POLICY,
  effectiveProjectIoClass,
  normalizeProjectIoClass,
  parseProjectIoPolicy,
} from "./io-policy";

describe("project I/O policy", () => {
  it("defaults unknown classes to standard", () => {
    expect(normalizeProjectIoClass("premium")).toBe("premium");
    expect(normalizeProjectIoClass("root")).toBe("standard");
    expect(
      effectiveProjectIoClass(DEFAULT_PROJECT_IO_POLICY, null),
    ).toMatchObject({
      name: "standard",
      weight: 100,
    });
  });

  it("rejects incomplete enforcement policies", () => {
    expect(() =>
      parseProjectIoPolicy({
        ...DEFAULT_PROJECT_IO_POLICY,
        mode: "enforce",
      }),
    ).toThrow("pool.rbps must be configured");
  });

  it("accepts complete bandwidth and IOPS limits", () => {
    const limits = { rbps: 64, wbps: 32, riops: 2000, wiops: 1000 };
    const policy = parseProjectIoPolicy({
      ...DEFAULT_PROJECT_IO_POLICY,
      mode: "enforce",
      pool: limits,
      leafClasses: {
        standard: { ...limits, weight: 100 },
        member: { ...limits, weight: 200 },
        premium: { ...limits, weight: 400 },
      },
    });
    expect(policy.mode).toBe("enforce");
    expect(policy.leafClasses.premium.wiops).toBe(1000);
  });
});
