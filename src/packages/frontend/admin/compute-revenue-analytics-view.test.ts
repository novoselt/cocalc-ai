/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  buildCombinedRevenueAnalyticsView,
  buildComputeRevenueAnalyticsView,
} from "./compute-revenue-analytics-view";

describe("compute revenue analytics view", () => {
  const revenue = [
    {
      day: "2026-08-24",
      product: "dedicated-host" as const,
      provider: "gcp",
      cost_component: "compute" as const,
      revenue_cents: 1200,
      purchase_count: 2,
    },
    {
      day: "2026-08-24",
      product: "virtual-machine" as const,
      provider: "nebius",
      cost_component: "storage" as const,
      revenue_cents: 300,
      purchase_count: 3,
    },
  ];
  const usage = [
    {
      day: "2026-08-24",
      product: "dedicated-host" as const,
      provider: "gcp",
      running_unit_seconds: 129_600,
      distinct_running_units: 2,
    },
    {
      day: "2026-08-24",
      product: "virtual-machine" as const,
      provider: "nebius",
      running_unit_seconds: 43_200,
      distinct_running_units: 3,
    },
  ];

  it("uses average or distinct units without changing revenue", () => {
    const average = buildComputeRevenueAnalyticsView({
      revenue,
      usage,
      breakdown: "product",
      start: "2026-08-24",
      end: "2026-08-24",
      unitMetric: "average",
    });
    const distinct = buildComputeRevenueAnalyticsView({
      revenue,
      usage,
      breakdown: "product",
      start: "2026-08-24",
      end: "2026-08-24",
      unitMetric: "distinct",
    });
    expect(average.summary[0]).toMatchObject({
      revenueCents: 1500,
      activeMemberships: 2,
      averageRunningUnits: 2,
      distinctRunningUnits: 5,
    });
    expect(distinct.summary[0]).toMatchObject({
      revenueCents: 1500,
      activeMemberships: 5,
    });
  });

  it("combines membership channels and compute products as revenue sources", () => {
    const view = buildCombinedRevenueAnalyticsView({
      memberships: [
        {
          day: "2026-08-24",
          channel: "personal",
          membership_class: "standard",
          billing_interval: "month",
          lifecycle: "renewal",
          tier_change: "none",
          active_memberships: 1,
          purchased_capacity: 0,
          revenue_cents: 60,
          fact_count: 1,
        },
        {
          day: "2026-08-24",
          channel: "team",
          membership_class: "pro",
          billing_interval: "year",
          lifecycle: "first_paid",
          tier_change: "none",
          active_memberships: 2,
          purchased_capacity: 3,
          revenue_cents: 90,
          fact_count: 1,
        },
      ],
      compute: revenue,
      start: "2026-08-24",
      end: "2026-08-24",
    });
    expect(view.series.map(({ label }) => label)).toEqual([
      "Personal",
      "Team license",
      "Dedicated hosts",
      "Virtual machines",
    ]);
    expect(view.summary[0].revenueCents).toBe(1650);
  });
});
