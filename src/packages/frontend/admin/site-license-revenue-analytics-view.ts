/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { SiteLicenseRevenueDailyRow } from "@cocalc/conat/hub/api/purchases";

import type {
  MembershipAnalyticsBreakdown,
  MembershipAnalyticsPoint,
  MembershipAnalyticsSeries,
  MembershipAnalyticsSummaryRow,
  MembershipAnalyticsView,
} from "./membership-analytics-view";
import { shiftMembershipAnalyticsDay } from "./membership-analytics-view";

const SITE_LICENSE_REVENUE_KEY = "site-license-revenue";

function dayKey(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`invalid site-license revenue analytics day: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function revenueByDay(rows: SiteLicenseRevenueDailyRow[]): Map<string, number> {
  const values = new Map<string, number>();
  for (const row of rows) {
    const day = dayKey(row.day);
    values.set(day, (values.get(day) ?? 0) + Number(row.revenue_cents || 0));
  }
  return values;
}

function viewDays(view: MembershipAnalyticsView): string[] {
  const days: string[] = [];
  for (
    let day = view.start;
    day <= view.end;
    day = shiftMembershipAnalyticsDay(day, 1)
  ) {
    days.push(day);
  }
  return days;
}

function revenuePoint({
  displayDay,
  actualDay,
  values,
}: {
  displayDay: string;
  actualDay: string;
  values: Map<string, number>;
}): MembershipAnalyticsPoint {
  return {
    displayDay,
    actualDay,
    activeMemberships: 0,
    purchasedCapacity: 0,
    revenueCents: values.get(actualDay) ?? 0,
  };
}

function addRevenue(
  points: MembershipAnalyticsPoint[],
  values: Map<string, number>,
): MembershipAnalyticsPoint[] {
  return points.map((point) => ({
    ...point,
    revenueCents: point.revenueCents + (values.get(point.actualDay) ?? 0),
  }));
}

function addSummaryRevenue(
  row: MembershipAnalyticsSummaryRow,
  currentRevenueCents: number,
  comparisonRevenueCents: number,
): MembershipAnalyticsSummaryRow {
  return {
    ...row,
    revenueCents: row.revenueCents + currentRevenueCents,
    comparisonRevenueCents: row.comparisonRevenueCents + comparisonRevenueCents,
  };
}

export function addSiteLicenseRevenueToAnalyticsView({
  view,
  rows,
  breakdown,
  comparisonDays,
}: {
  view: MembershipAnalyticsView;
  rows: SiteLicenseRevenueDailyRow[];
  breakdown: MembershipAnalyticsBreakdown;
  comparisonDays: number;
}): MembershipAnalyticsView {
  const values = revenueByDay(rows);
  const days = viewDays(view);
  const comparisonDay = shiftMembershipAnalyticsDay(
    view.latestDay,
    -comparisonDays,
  );
  const currentRevenueCents = values.get(view.latestDay) ?? 0;
  const comparisonRevenueCents =
    comparisonDays > 0 ? (values.get(comparisonDay) ?? 0) : 0;
  const hasDisplayedRevenue = days.some(
    (day) =>
      (values.get(day) ?? 0) !== 0 ||
      (comparisonDays > 0 &&
        (values.get(shiftMembershipAnalyticsDay(day, -comparisonDays)) ?? 0) !==
          0),
  );
  if (!hasDisplayedRevenue) return view;

  const mergeWithSiteChannel =
    breakdown === "channel" || breakdown === "source";
  const targetSeries = mergeWithSiteChannel
    ? view.series.find(({ channel }) => channel === "site")
    : undefined;
  const targetSummary = targetSeries
    ? view.summary.find(({ key }) => key === targetSeries.key)
    : undefined;
  const total = view.summary.find(({ total }) => total);
  const updatedTotal = total
    ? addSummaryRevenue(total, currentRevenueCents, comparisonRevenueCents)
    : undefined;

  if (targetSeries && targetSummary) {
    return {
      ...view,
      series: view.series.map((series) =>
        series.key === targetSeries.key
          ? {
              ...series,
              current: addRevenue(series.current, values),
              comparison: addRevenue(series.comparison, values),
            }
          : series,
      ),
      summary: view.summary.map((row) =>
        row.key === targetSummary.key
          ? addSummaryRevenue(row, currentRevenueCents, comparisonRevenueCents)
          : row.total && updatedTotal
            ? updatedTotal
            : row,
      ),
    };
  }

  const current = days.map((displayDay) =>
    revenuePoint({ displayDay, actualDay: displayDay, values }),
  );
  const comparison =
    comparisonDays > 0
      ? days.map((displayDay) =>
          revenuePoint({
            displayDay,
            actualDay: shiftMembershipAnalyticsDay(displayDay, -comparisonDays),
            values,
          }),
        )
      : [];
  const series: MembershipAnalyticsSeries = {
    key: SITE_LICENSE_REVENUE_KEY,
    label: "Site license",
    countApplicable: false,
    priority: 0,
    order: Number.MAX_SAFE_INTEGER,
    current,
    comparison,
  };
  const summary: MembershipAnalyticsSummaryRow = {
    key: SITE_LICENSE_REVENUE_KEY,
    label: "Site license",
    countApplicable: false,
    activeMemberships: 0,
    comparisonActiveMemberships: 0,
    purchasedCapacity: 0,
    comparisonPurchasedCapacity: 0,
    revenueCents: currentRevenueCents,
    comparisonRevenueCents,
  };
  return {
    ...view,
    series: [...view.series, series],
    summary: [
      ...view.summary.map((row) =>
        row.total && updatedTotal ? updatedTotal : row,
      ),
      summary,
    ],
  };
}
