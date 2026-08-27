/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { buildMembershipAnalyticsView } from "./membership-analytics-view";
import { addSiteLicenseRevenueToAnalyticsView } from "./site-license-revenue-analytics-view";

const tiers = [{ id: "pro", label: "Pro", priority: 30 }];
const siteAssignment = {
  day: "2026-08-24",
  channel: "site" as const,
  membership_class: "pro",
  billing_interval: "fixed" as const,
  lifecycle: "first_paid" as const,
  tier_change: "none" as const,
  active_memberships: 2,
  purchased_capacity: 0,
  revenue_cents: 0,
  fact_count: 1,
};

describe("site-license revenue analytics view", () => {
  it("keeps tier counts separate from unallocated site-license revenue", () => {
    const view = addSiteLicenseRevenueToAnalyticsView({
      view: buildMembershipAnalyticsView({
        rows: [siteAssignment],
        tiers,
        breakdown: "tier",
        start: "2026-08-24",
        end: "2026-08-24",
      }),
      rows: [{ day: "2026-08-24", revenue_cents: 1250 }],
      breakdown: "tier",
      comparisonDays: 0,
    });

    expect(view.series.map(({ label }) => label)).toEqual([
      "Pro",
      "Site license",
    ]);
    expect(view.summary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "total",
          activeMemberships: 2,
          revenueCents: 1250,
        }),
        expect.objectContaining({
          label: "Site license",
          countApplicable: false,
          activeMemberships: 0,
          revenueCents: 1250,
        }),
      ]),
    );
  });

  it("merges revenue with the site channel at channel granularity", () => {
    const view = addSiteLicenseRevenueToAnalyticsView({
      view: buildMembershipAnalyticsView({
        rows: [siteAssignment],
        tiers,
        breakdown: "channel",
        start: "2026-08-24",
        end: "2026-08-24",
      }),
      rows: [{ day: "2026-08-24", revenue_cents: 1250 }],
      breakdown: "channel",
      comparisonDays: 0,
    });

    expect(view.series).toHaveLength(1);
    expect(view.summary[1]).toMatchObject({
      label: "Site license",
      activeMemberships: 2,
      revenueCents: 1250,
    });
  });
});
