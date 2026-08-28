/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { MembershipAllocationDailyRow } from "@cocalc/conat/hub/api/purchases";

import {
  buildMembershipAllocationDailyExport,
  buildRevenueAnalyticsDailyExport,
  MembershipAnalyticsExport,
  membershipAllocationDailyExportCsv,
  revenueAnalyticsDailyExportCsv,
} from "./membership-analytics-export";

function row(
  day: string,
  overrides: Partial<MembershipAllocationDailyRow> = {},
): MembershipAllocationDailyRow {
  return {
    day,
    channel: "personal",
    membership_class: "standard",
    billing_interval: "month",
    lifecycle: "first_paid",
    previous_membership_class: null,
    previous_billing_interval: null,
    tier_change: "none",
    active_memberships: 1,
    purchased_capacity: 0,
    revenue_cents: 58,
    fact_count: 1,
    ...overrides,
  };
}

describe("membership analytics export", () => {
  const payload = buildMembershipAllocationDailyExport({
    rows: [
      row("2026-08-09"),
      row("2026-08-10", {
        channel: "team",
        membership_class: "pro",
        billing_interval: "year",
        lifecycle: "renewal",
        active_memberships: 3,
        purchased_capacity: 5,
        revenue_cents: 493,
      }),
      row("2026-08-11", { revenue_cents: 59 }),
      row("2026-08-12"),
    ],
    tiers: [
      { id: "standard", label: "Standard", priority: 20 },
      { id: "pro", label: "Pro", priority: 30 },
    ],
    channels: ["personal", "team"],
    startDay: "2026-08-10",
    endDay: "2026-08-11",
    exportedAt: new Date("2026-08-18T12:00:00.000Z"),
  });

  it("exports selected daily rows without applying chart breakdowns", () => {
    expect(payload).toEqual({
      format: "cocalc-membership-allocation-daily",
      version: 1,
      exported_at: "2026-08-18T12:00:00.000Z",
      range: { start_day: "2026-08-10", end_day: "2026-08-11" },
      channels: ["personal", "team"],
      tiers: [
        { id: "standard", label: "Standard", priority: 20 },
        { id: "pro", label: "Pro", priority: 30 },
      ],
      rows: [
        expect.objectContaining({
          day: "2026-08-10",
          channel: "team",
          membership_class: "pro",
          active_memberships: 3,
          purchased_capacity: 5,
          revenue_cents: 493,
        }),
        expect.objectContaining({
          day: "2026-08-11",
          channel: "personal",
          membership_class: "standard",
          revenue_cents: 59,
        }),
      ],
    });
    expect(membershipAllocationDailyExportCsv(payload)).toContain(
      "day,channel,membership_class,billing_interval,lifecycle,previous_membership_class,previous_billing_interval,tier_change,active_memberships,purchased_capacity,revenue_cents,fact_count",
    );
  });

  it("offers keyboard-accessible CSV and JSON downloads", async () => {
    const createObjectURL = jest.fn(() => "blob:membership-export");
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<MembershipAnalyticsExport payload={payload} />);
    const exportButton = screen.getByRole("button", { name: "Export" });
    exportButton.focus();
    expect(exportButton).toHaveFocus();
    fireEvent.click(exportButton);

    const json = await screen.findByRole("button", {
      name: /Daily buckets \(JSON\)/,
    });
    fireEvent.click(json);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:membership-export");

    click.mockRestore();
  });

  it("exports selected membership and compute buckets without PII", () => {
    const combined = buildRevenueAnalyticsDailyExport({
      membershipRows: [row("2026-08-10")],
      computeRevenueRows: [
        {
          day: "2026-08-10",
          product: "dedicated-host",
          provider: "gcp",
          cost_component: "gpu",
          revenue_cents: 1250,
          purchase_count: 2,
        },
      ],
      computeUsageRows: [
        {
          day: "2026-08-10",
          product: "dedicated-host",
          provider: "gcp",
          running_unit_seconds: 86_400,
          distinct_running_units: 2,
        },
      ],
      siteLicenseRevenueRows: [
        {
          day: "2026-08-10",
          measure: "contracted",
          amount_cents: 900,
          source_count: 1,
        },
      ],
      membershipChannels: ["personal"],
      computeProducts: ["dedicated-host"],
      tiers: [{ id: "standard", label: "Standard", priority: 20 }],
      startDay: "2026-08-10",
      endDay: "2026-08-10",
      exportedAt: new Date("2026-08-18T12:00:00.000Z"),
    });
    expect(combined).toMatchObject({
      format: "cocalc-revenue-analytics-daily",
      membership_channels: ["personal"],
      compute_products: ["dedicated-host"],
      tiers: [{ id: "standard", label: "Standard", priority: 20 }],
      membership_rows: [{ day: "2026-08-10" }],
      compute_revenue_rows: [{ day: "2026-08-10", revenue_cents: 1250 }],
      compute_usage_rows: [{ day: "2026-08-10", running_unit_seconds: 86_400 }],
      site_license_revenue_rows: [
        { day: "2026-08-10", measure: "contracted", amount_cents: 900 },
      ],
    });
    const csv = revenueAnalyticsDailyExportCsv(combined);
    expect(csv).toContain("compute-revenue");
    expect(csv).toContain("compute-usage");
    expect(csv).toContain("site-license-accounting");
    expect(csv).not.toContain("account_id");
  });
});
