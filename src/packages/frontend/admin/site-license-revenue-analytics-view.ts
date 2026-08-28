/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  SiteLicenseRevenueAnalyticsRow,
  SiteLicenseRevenueMeasure,
} from "@cocalc/conat/hub/api/commercial-orders";

import type {
  MembershipAnalyticsBreakdown,
  MembershipAnalyticsPoint,
  MembershipAnalyticsSeries,
  MembershipAnalyticsSummaryRow,
  MembershipAnalyticsView,
} from "./membership-analytics-view";
import { shiftMembershipAnalyticsDay } from "./membership-analytics-view";

const SITE_LICENSE_REVENUE_KEY = "site-license-revenue";

export const SITE_LICENSE_REVENUE_MEASURES: Array<{
  measure: SiteLicenseRevenueMeasure;
  label: string;
  description: string;
}> = [
  {
    measure: "contracted",
    label: "Contracted",
    description:
      "Approved, non-complimentary site-license line-item value allocated exactly across its service dates. Taxes are excluded.",
  },
  {
    measure: "invoiced",
    label: "Invoiced",
    description:
      "Issued site-license invoice subtotal on the invoice issue date. Draft, void, and failed invoices and taxes are excluded.",
  },
  {
    measure: "collected",
    label: "Cash collected (gross)",
    description:
      "Cash received for site licenses on the payment date. This is gross collection history, including payments later refunded.",
  },
];

function dayKey(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`invalid site-license revenue analytics day: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function revenueByDay(
  rows: SiteLicenseRevenueAnalyticsRow[],
  measure: SiteLicenseRevenueMeasure,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const row of rows) {
    if (row.measure !== measure) continue;
    const day = dayKey(row.day);
    values.set(day, (values.get(day) ?? 0) + Number(row.amount_cents || 0));
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
  rows: SiteLicenseRevenueAnalyticsRow[];
  breakdown: MembershipAnalyticsBreakdown;
  comparisonDays: number;
}): MembershipAnalyticsView {
  const values = revenueByDay(rows, "contracted");
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

export function buildSiteLicenseAccountingView({
  rows,
  start,
  end,
  comparisonDays,
}: {
  rows: SiteLicenseRevenueAnalyticsRow[];
  start: string;
  end: string;
  comparisonDays: number;
}): MembershipAnalyticsView {
  const days: string[] = [];
  for (let day = start; day <= end; day = shiftMembershipAnalyticsDay(day, 1)) {
    days.push(day);
  }
  const series = SITE_LICENSE_REVENUE_MEASURES.map(
    ({ measure, label }, order): MembershipAnalyticsSeries => {
      const values = revenueByDay(rows, measure);
      return {
        key: `site-license-${measure}`,
        label,
        priority: 0,
        order,
        current: days.map((displayDay) =>
          revenuePoint({ displayDay, actualDay: displayDay, values }),
        ),
        comparison:
          comparisonDays > 0
            ? days.map((displayDay) =>
                revenuePoint({
                  displayDay,
                  actualDay: shiftMembershipAnalyticsDay(
                    displayDay,
                    -comparisonDays,
                  ),
                  values,
                }),
              )
            : [],
      };
    },
  );
  const earliest = rows.length
    ? [...rows].sort((a, b) => dayKey(a.day).localeCompare(dayKey(b.day)))[0]
        .day
    : start;
  return {
    start,
    end,
    latestDay: end,
    comparisonAvailable:
      comparisonDays === 0 ||
      dayKey(earliest) <= shiftMembershipAnalyticsDay(start, -comparisonDays),
    series,
    summary: [],
  };
}

export function siteLicenseAccountingTotals({
  rows,
  start,
  end,
}: {
  rows: SiteLicenseRevenueAnalyticsRow[];
  start: string;
  end: string;
}): Record<SiteLicenseRevenueMeasure, number> {
  const totals: Record<SiteLicenseRevenueMeasure, number> = {
    contracted: 0,
    invoiced: 0,
    collected: 0,
  };
  for (const row of rows) {
    const day = dayKey(row.day);
    if (day >= start && day <= end) {
      totals[row.measure] += Number(row.amount_cents || 0);
    }
  }
  return totals;
}
