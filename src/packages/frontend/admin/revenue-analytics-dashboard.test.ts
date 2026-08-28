/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Segmented } from "antd";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

import {
  COMPUTE_UNIT_METRIC_DESCRIPTIONS,
  COMPUTE_UNIT_METRIC_OPTIONS,
  formatRevenueAnalyticsTableMoney,
  membershipBreakdownOptions,
  revenueBreakdownOptions,
  siteLicenseAnalyticsTableRowExplanation,
} from "./revenue-analytics-dashboard";

describe("membership analytics breakdown choices", () => {
  it("distinguishes exact zero revenue from rounded nonzero revenue", () => {
    expect(formatRevenueAnalyticsTableMoney(0)).toBe("-");
    expect(formatRevenueAnalyticsTableMoney(14)).toBe("$0");
    expect(formatRevenueAnalyticsTableMoney(100)).toBe("$1");
  });

  it("explains site-license tier and aggregate rows without positional wording", () => {
    expect(
      siteLicenseAnalyticsTableRowExplanation(
        {
          key: "site-pro",
          label: "Pro · Site license",
          channel: "site",
          activeMemberships: 2,
          comparisonActiveMemberships: 1,
          purchasedCapacity: 0,
          comparisonPurchasedCapacity: 0,
          revenueCents: 0,
          comparisonRevenueCents: 0,
        },
        "tier-channel",
      ),
    ).toBe(
      "Site license memberships are shown by tier. Contracted value is shown separately for the license as a whole.",
    );
    expect(
      siteLicenseAnalyticsTableRowExplanation(
        {
          key: "site-license-revenue",
          label: "Site license",
          countApplicable: false,
          activeMemberships: 0,
          comparisonActiveMemberships: 0,
          purchasedCapacity: 0,
          comparisonPurchasedCapacity: 0,
          revenueCents: 1250,
          comparisonRevenueCents: 1000,
        },
        "tier-channel",
      ),
    ).toBe(
      "Contracted site license value is shown for the license as a whole. Membership counts are included in the tier breakdown.",
    );
  });

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
    ).toEqual(["channel", "channel-tier", "tier", "tier-channel"]);
  });

  it("offers compute dimensions and pins mixed revenue to product", () => {
    expect(
      revenueBreakdownOptions({
        channels: [],
        computeProducts: ["dedicated-host", "virtual-machine"],
      }).map(({ value }) => value),
    ).toEqual([
      "product",
      "cost-component",
      "provider",
      "product-cost-component",
      "product-provider",
    ]);
    expect(
      revenueBreakdownOptions({
        channels: [],
        computeProducts: ["dedicated-host"],
      }).map(({ value }) => value),
    ).toEqual(["cost-component", "provider"]);
    expect(
      revenueBreakdownOptions({
        channels: ["personal"],
        computeProducts: ["dedicated-host"],
      }),
    ).toEqual([{ value: "source", label: "Source" }]);
  });

  it("explains compute unit metrics instead of repeating their labels", () => {
    render(
      createElement(Segmented, {
        "aria-label": "Compute unit metric",
        value: "average",
        options: COMPUTE_UNIT_METRIC_OPTIONS,
      }),
    );

    expect(
      screen.getByTitle(COMPUTE_UNIT_METRIC_DESCRIPTIONS.average),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle(COMPUTE_UNIT_METRIC_DESCRIPTIONS.distinct),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Average running")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Distinct used")).not.toBeInTheDocument();
  });
});
