/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { MembershipAnalyticsRevenueRow } from "@cocalc/conat/hub/api/purchases";

type RecurringRevenueRow = Pick<
  MembershipAnalyticsRevenueRow,
  "gross_revenue" | "interval"
>;

export function monthlyRecurringRevenue(row: RecurringRevenueRow): number {
  const grossRevenue = Number(row.gross_revenue) || 0;
  if (row.interval === "month") {
    return grossRevenue;
  }
  if (row.interval === "year") {
    return grossRevenue / 12;
  }
  return 0;
}

export function totalMonthlyRecurringRevenue(
  rows: readonly RecurringRevenueRow[],
): number {
  return rows.reduce((total, row) => total + monthlyRecurringRevenue(row), 0);
}
