/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  monthlyRecurringRevenue,
  totalMonthlyRecurringRevenue,
} from "./membership-analytics-mrr";

describe("membership analytics monthly recurring revenue", () => {
  it("uses monthly gross revenue directly", () => {
    expect(
      monthlyRecurringRevenue({ gross_revenue: 240, interval: "month" }),
    ).toBe(240);
  });

  it("normalizes annual gross revenue to one month", () => {
    expect(
      monthlyRecurringRevenue({ gross_revenue: 1800, interval: "year" }),
    ).toBe(150);
  });

  it("does not count revenue without a recurring interval", () => {
    expect(
      monthlyRecurringRevenue({ gross_revenue: 100, interval: "none" }),
    ).toBe(0);
  });

  it("sums normalized revenue across billing periods", () => {
    expect(
      totalMonthlyRecurringRevenue([
        { gross_revenue: 240, interval: "month" },
        { gross_revenue: 1800, interval: "year" },
      ]),
    ).toBe(390);
  });
});
