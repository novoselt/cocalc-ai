/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getEffectiveMembershipUsageLimits } from "./effective-limits";

describe("membership effective limits", () => {
  it("normalizes browser idle timeouts", () => {
    expect(
      getEffectiveMembershipUsageLimits({
        effective_limits: { browser_idle_timeout_seconds: 1800.9 },
        entitlements: {},
      }).browser_idle_timeout_seconds,
    ).toBe(1800);
    expect(
      getEffectiveMembershipUsageLimits({
        entitlements: {
          usage_limits: { browser_idle_timeout_seconds: -1 },
        },
      }).browser_idle_timeout_seconds,
    ).toBeUndefined();
  });

  it("normalizes public directory share limits", () => {
    expect(
      getEffectiveMembershipUsageLimits({
        entitlements: {
          usage_limits: {
            public_directory_shares: 37,
          },
        },
      }).public_directory_shares,
    ).toBe(37);

    expect(
      getEffectiveMembershipUsageLimits({
        entitlements: {
          usage_limits: {
            public_directory_shares: -1,
          },
        },
      }).public_directory_shares,
    ).toBeUndefined();
  });
});
