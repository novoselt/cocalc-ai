/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { renderToStaticMarkup } from "react-dom/server";

import type { AccountUsageMeter } from "@cocalc/conat/hub/api/purchases";
import {
  formatUsageMeterValue,
  groupUsageMeters,
  UsageMeterDashboard,
} from "./usage-meter-dashboard";

function meter(
  overrides: Partial<AccountUsageMeter> & Pick<AccountUsageMeter, "id">,
): AccountUsageMeter {
  return {
    action_when_over: "Wait for this limit to reset.",
    category: "compute",
    help: "Measured usage for this resource.",
    label: overrides.id,
    limit: 7200,
    percent: 50,
    ratio: 0.5,
    severity: "ok",
    unit: "seconds",
    upgrade_relevant: true,
    used: 3600,
    window: "5h",
    ...overrides,
  };
}

describe("usage meter presentation", () => {
  it("groups every backend meter without dropping newer categories", () => {
    const meters = [
      meter({ id: "ai", category: "ai" }),
      meter({ id: "network", category: "network" }),
      meter({ id: "blob", category: "blob" }),
      meter({ id: "spend", category: "spend" }),
      meter({ id: "collaboration", category: "collaboration" }),
    ];

    const groups = groupUsageMeters(meters);

    expect(groups.map(({ title }) => title)).toEqual([
      "AI and compute",
      "Network transfer",
      "Projects and storage",
      "Dedicated host spending",
      "Collaboration",
    ]);
    expect(groups.flatMap(({ meters: items }) => items)).toHaveLength(
      meters.length,
    );
  });

  it("formats all meter units for users", () => {
    expect(formatUsageMeterValue(3600, "seconds")).toBe("1 CPU-hour");
    expect(formatUsageMeterValue(1024, "bytes")).toBe("1 KB");
    expect(formatUsageMeterValue(12.5, "usd")).toBe("$12.50");
    expect(formatUsageMeterValue(1234, "count")).toMatch(/1[,.]234/);
  });

  it("renders limits, reset information, and over-limit consequences", () => {
    const html = renderToStaticMarkup(
      <UsageMeterDashboard
        meters={[
          meter({
            id: "dedicated-host-credit-7d",
            action_when_over: "Dedicated-host actions are blocked.",
            category: "spend",
            label: "Dedicated host credit spend",
            limit: 10,
            percent: 120,
            remaining: -2,
            reset_in: "2 hours",
            severity: "over",
            unit: "usd",
            used: 12,
            window: "7d",
          }),
        ]}
      />,
    );

    expect(html).toContain("Dedicated host spending");
    expect(html).toContain("$12.00 of $10.00");
    expect(html).toContain("Limit reached");
    expect(html).toContain("Over by $2.00");
    expect(html).toContain("Resets in 2 hours");
    expect(html).toContain("Dedicated-host actions are blocked.");
  });

  it("distinguishes a missing allowance from zero usage", () => {
    const html = renderToStaticMarkup(
      <UsageMeterDashboard
        meters={[
          meter({
            id: "not-included",
            label: "Not included",
            limit: 0,
            percent: 0,
            remaining: 0,
            unit: "count",
            used: 0,
            window: "point",
          }),
          meter({
            id: "used-without-allowance",
            label: "Used without allowance",
            limit: 0,
            percent: 100,
            remaining: -2,
            unit: "count",
            used: 2,
            window: "point",
          }),
        ]}
      />,
    );

    expect(html).toContain("Not included");
    expect(html).toContain("2 used · no allowance");
    expect(html).toContain("Over by 2");
  });
});
