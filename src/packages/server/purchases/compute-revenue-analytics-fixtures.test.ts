/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  COMPUTE_REVENUE_FIXTURE_BAY,
  generateComputeRevenueFixture,
} from "./compute-revenue-analytics-fixtures";

describe("compute revenue analytics fixtures", () => {
  it("generates deterministic complete-day revenue and usage", () => {
    const options = {
      asOf: "2026-08-26",
      days: 30,
      machines: 100,
    };
    const first = generateComputeRevenueFixture(options);
    const second = generateComputeRevenueFixture(options);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      start: "2026-07-27",
      end: "2026-08-26",
      machine_count: 100,
    });
    expect(first.revenue.length).toBeGreaterThan(100);
    expect(first.usage.length).toBeGreaterThan(50);
    expect(
      first.revenue.every(
        ({ day, bay_id, revenue_cents }) =>
          day < first.end &&
          bay_id === COMPUTE_REVENUE_FIXTURE_BAY &&
          Number.isSafeInteger(revenue_cents),
      ),
    ).toBe(true);
    expect(new Set(first.revenue.map(({ product }) => product))).toEqual(
      new Set(["dedicated-host", "virtual-machine"]),
    );
    expect(
      new Set(first.revenue.map(({ cost_component }) => cost_component)),
    ).toEqual(new Set(["compute", "gpu", "storage", "network-egress"]));
    expect(
      Math.max(
        ...first.usage.map(
          ({ distinct_running_units }) => distinct_running_units,
        ),
      ),
    ).toBeLessThanOrEqual(100);
  });
});
