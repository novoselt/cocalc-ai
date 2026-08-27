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
  membershipBreakdownOptions,
  revenueBreakdownOptions,
} from "./revenue-analytics-dashboard";

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
