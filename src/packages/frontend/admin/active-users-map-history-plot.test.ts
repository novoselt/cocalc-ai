import type { ActiveUserMapDailyHistoryPoint } from "@cocalc/conat/inter-bay/api";
import { buildActiveUsersHistoryPlotSeries } from "./active-users-map-history-plot";

function point(
  snapshot_hour: string,
  total_active: number,
): ActiveUserMapDailyHistoryPoint {
  return {
    snapshot_hour,
    captured_at: snapshot_hour,
    total_active,
    mapped_active: total_active,
    unknown_location: 0,
    usage_metrics_not_enabled: 0,
    bay_count: 1,
  };
}

describe("buildActiveUsersHistoryPlotSeries", () => {
  it("shows all available days before a full comparison period exists", () => {
    const result = buildActiveUsersHistoryPlotSeries([
      point("2026-08-01T23:00:00.000Z", 10),
      point("2026-08-03T23:00:00.000Z", 12),
    ]);

    expect(result.current).toEqual([
      {
        actual_date: "2026-08-01",
        display_date: "2026-08-01",
        snapshot_hour: "2026-08-01T23:00:00.000Z",
        total_active: 10,
      },
      {
        actual_date: "2026-08-02",
        display_date: "2026-08-02",
        snapshot_hour: null,
        total_active: null,
      },
      {
        actual_date: "2026-08-03",
        display_date: "2026-08-03",
        snapshot_hour: "2026-08-03T23:00:00.000Z",
        total_active: 12,
      },
    ]);
    expect(result.previous).toEqual([]);
  });

  it("aligns the preceding period by 364 days", () => {
    const result = buildActiveUsersHistoryPlotSeries([
      point("2025-08-08T23:00:00.000Z", 8),
      point("2026-08-07T23:00:00.000Z", 15),
    ]);

    expect(result.current.at(-1)).toMatchObject({
      actual_date: "2026-08-07",
      display_date: "2026-08-07",
      total_active: 15,
    });
    expect(result.previous.at(-1)).toEqual({
      actual_date: "2025-08-08",
      display_date: "2026-08-07",
      snapshot_hour: "2025-08-08T23:00:00.000Z",
      total_active: 8,
    });
  });
});
