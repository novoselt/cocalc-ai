/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { membershipBreakdownOptions } from "./membership-analytics-dashboard";

describe("membership analytics breakdown choices", () => {
  it("offers subscription details only for the personal channel", () => {
    expect(
      membershipBreakdownOptions(["personal"]).map(({ value }) => value),
    ).toEqual([
      "tier",
      "tier-interval",
      "tier-lifecycle",
      "interval",
      "lifecycle",
    ]);
    expect(
      membershipBreakdownOptions(["direct-student"]).map(({ value }) => value),
    ).toEqual(["tier"]);
  });

  it("offers generic channel breakdowns for combined selections", () => {
    expect(
      membershipBreakdownOptions(["personal", "team"]).map(
        ({ value }) => value,
      ),
    ).toEqual(["channel", "channel-tier", "tier"]);
  });
});
