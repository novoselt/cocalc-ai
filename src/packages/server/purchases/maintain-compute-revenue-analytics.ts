/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { maintainComputeRevenueAnalytics } from "./compute-revenue-analytics";

const RUN_INTERVAL_MS = 60 * 60 * 1000;
let runNotBefore = 0;

export default async function maintainComputeRevenueAnalyticsProjection(): Promise<void> {
  if (Date.now() < runNotBefore) return;
  await maintainComputeRevenueAnalytics();
  runNotBefore = Date.now() + RUN_INTERVAL_MS;
}
