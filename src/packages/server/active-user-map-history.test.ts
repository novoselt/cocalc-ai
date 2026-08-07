/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ActiveUserMapHistoryReport } from "@cocalc/conat/inter-bay/api";
import { aggregateActiveUserMapHistoryReports } from "./active-user-map-history";

describe("active user map history aggregation", () => {
  it("builds consent-gated one-hour and one-day country snapshots", () => {
    const reports: ActiveUserMapHistoryReport[] = [
      {
        bay_id: "bay-1",
        accounts: [
          {
            account_id: "recent-mapped",
            last_active: "2026-08-07T11:50:00.000Z",
            country_code: "gb",
            usage_metrics_enabled: true,
          },
          {
            account_id: "older-mapped",
            last_active: "2026-08-07T10:00:00.000Z",
            country_code: "CA",
            usage_metrics_enabled: true,
          },
          {
            account_id: "recent-unknown",
            last_active: "2026-08-07T11:45:00.000Z",
            country_code: null,
            usage_metrics_enabled: true,
          },
          {
            account_id: "recent-no-consent",
            last_active: "2026-08-07T11:40:00.000Z",
            country_code: "US",
            usage_metrics_enabled: false,
          },
        ],
      },
    ];

    expect(
      aggregateActiveUserMapHistoryReports({
        reports,
        captured_at: new Date("2026-08-07T12:00:00.000Z"),
      }),
    ).toEqual([
      {
        active_minutes: 60,
        total_active: 3,
        mapped_active: 1,
        unknown_location: 1,
        usage_metrics_not_enabled: 1,
        countries: [{ country_code: "GB", active_count: 1 }],
      },
      {
        active_minutes: 1440,
        total_active: 4,
        mapped_active: 2,
        unknown_location: 1,
        usage_metrics_not_enabled: 1,
        countries: [
          { country_code: "CA", active_count: 1 },
          { country_code: "GB", active_count: 1 },
        ],
      },
    ]);
  });

  it("deduplicates bays and conservatively honors a conflicting opt-out", () => {
    const duplicate = {
      account_id: "duplicate",
      last_active: "2026-08-07T11:50:00.000Z",
      country_code: "GB",
    };
    const result = aggregateActiveUserMapHistoryReports({
      reports: [
        {
          bay_id: "bay-1",
          accounts: [{ ...duplicate, usage_metrics_enabled: true }],
        },
        {
          bay_id: "bay-2",
          accounts: [{ ...duplicate, usage_metrics_enabled: false }],
        },
      ],
      captured_at: new Date("2026-08-07T12:00:00.000Z"),
    });

    expect(result[0]).toMatchObject({
      total_active: 1,
      mapped_active: 0,
      unknown_location: 0,
      usage_metrics_not_enabled: 1,
      countries: [],
    });
  });
});
