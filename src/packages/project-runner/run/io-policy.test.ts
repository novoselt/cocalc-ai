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

  it.each([
    ["numeric strings", { rbps: "64" }],
    ["boolean values", { rbps: true }],
  ])(
    "rejects %s instead of diverging from the privileged parser",
    (_, pool) => {
      expect(() =>
        parseProjectIoPolicy({
          ...DEFAULT_PROJECT_IO_POLICY,
          pool: { ...DEFAULT_PROJECT_IO_POLICY.pool, ...pool },
        }),
      ).toThrow("pool.rbps must be a non-negative integer");
    },
  );

  it.each(["1", true])("rejects non-numeric policy version %p", (version) => {
    expect(() =>
      parseProjectIoPolicy({ ...DEFAULT_PROJECT_IO_POLICY, version }),
    ).toThrow("project I/O policy version must be 1");
  });

  it("rejects relative mountpoints and control characters", () => {
    expect(() =>
      parseProjectIoPolicy({
        ...DEFAULT_PROJECT_IO_POLICY,
        mountpoint: "mnt/cocalc",
      }),
    ).toThrow("mountpoint must be absolute");
    expect(() =>
      parseProjectIoPolicy({
        ...DEFAULT_PROJECT_IO_POLICY,
        profile: "unsafe\nprofile",
      }),
    ).toThrow("profile contains invalid control characters");
  });

  it("rejects a leaf limit above the aggregate pool envelope", () => {
    const pool = { rbps: 64, wbps: 32, riops: 2000, wiops: 1000 };
    expect(() =>
      parseProjectIoPolicy({
        ...DEFAULT_PROJECT_IO_POLICY,
        mode: "enforce",
        pool,
        leafClasses: {
          standard: { ...pool, rbps: 65, weight: 100 },
          member: { ...pool, weight: 200 },
          premium: { ...pool, weight: 400 },
        },
      }),
    ).toThrow("leafClasses.standard.rbps must not exceed pool.rbps");
  });
});
