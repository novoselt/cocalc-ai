/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Empty, Space, Spin, Typography } from "antd";

import type {
  ActiveUserMapDailyHistory,
  ActiveUserMapDailyHistoryPoint,
} from "@cocalc/conat/inter-bay/api";
import Plot from "@cocalc/frontend/components/plotly";
import { COLORS } from "@cocalc/util/theme";

const COMPARISON_DAYS = 364;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActiveUsersHistoryPlotPoint {
  actual_date: string;
  display_date: string;
  snapshot_hour: string | null;
  total_active: number | null;
}

export interface ActiveUsersHistoryPlotSeries {
  current: ActiveUsersHistoryPlotPoint[];
  previous: ActiveUsersHistoryPlotPoint[];
}

function utcDay(value: string | Date): Date | undefined {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return;
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.valueOf() + days * DAY_MS);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildActiveUsersHistoryPlotSeries(
  points: ActiveUserMapDailyHistoryPoint[],
): ActiveUsersHistoryPlotSeries {
  const byDay = new Map<
    string,
    { day: Date; point: ActiveUserMapDailyHistoryPoint }
  >();
  for (const point of points) {
    const day = utcDay(point.snapshot_hour);
    if (!day) continue;
    const key = dayKey(day);
    const current = byDay.get(key);
    if (
      !current ||
      new Date(point.snapshot_hour).valueOf() >
        new Date(current.point.snapshot_hour).valueOf()
    ) {
      byDay.set(key, { day, point });
    }
  }
  const available = [...byDay.values()].sort(
    (a, b) => a.day.valueOf() - b.day.valueOf(),
  );
  if (!available.length) return { current: [], previous: [] };

  const latest = available[available.length - 1].day;
  const fullCurrentStart = addUtcDays(latest, 1 - COMPARISON_DAYS);
  const currentStart =
    available[0].day.valueOf() > fullCurrentStart.valueOf()
      ? available[0].day
      : fullCurrentStart;
  const current: ActiveUsersHistoryPlotPoint[] = [];
  const previous: ActiveUsersHistoryPlotPoint[] = [];
  for (
    let displayDay = currentStart;
    displayDay.valueOf() <= latest.valueOf();
    displayDay = addUtcDays(displayDay, 1)
  ) {
    const display_date = dayKey(displayDay);
    const currentEntry = byDay.get(display_date)?.point;
    current.push({
      actual_date: display_date,
      display_date,
      snapshot_hour: currentEntry?.snapshot_hour ?? null,
      total_active: currentEntry?.total_active ?? null,
    });

    const previousDay = addUtcDays(displayDay, -COMPARISON_DAYS);
    const previous_date = dayKey(previousDay);
    const previousEntry = byDay.get(previous_date)?.point;
    previous.push({
      actual_date: previous_date,
      display_date,
      snapshot_hour: previousEntry?.snapshot_hour ?? null,
      total_active: previousEntry?.total_active ?? null,
    });
  }
  return {
    current,
    previous: previous.some(({ total_active }) => total_active != null)
      ? previous
      : [],
  };
}

function plotMode(points: ActiveUsersHistoryPlotPoint[]): "lines" | "markers" {
  return points.filter(({ total_active }) => total_active != null).length > 1
    ? "lines"
    : "markers";
}

function traceData(points: ActiveUsersHistoryPlotPoint[]) {
  return {
    x: points.map(({ display_date }) => display_date),
    y: points.map(({ total_active }) => total_active),
    customdata: points.map(({ actual_date, snapshot_hour }) => [
      actual_date,
      snapshot_hour,
    ]),
  };
}

export function ActiveUsersMapHistoryPlot({
  history,
  loading,
}: {
  history?: ActiveUserMapDailyHistory;
  loading: boolean;
}) {
  if (!history) {
    return loading ? <Spin /> : null;
  }
  const series = buildActiveUsersHistoryPlotSeries(history.points);
  if (!series.current.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No daily active-user history has been recorded yet."
      />
    );
  }
  const hasPrevious = series.previous.length > 0;
  const currentName = hasPrevious ? "Latest 364 days" : "Active users";
  return (
    <Space vertical style={{ width: "100%" }}>
      <Typography.Title level={4}>Daily active users</Typography.Title>
      <Plot
        style={{ width: "100%" }}
        data={[
          {
            ...traceData(series.current),
            type: "scatter",
            mode: plotMode(series.current),
            connectgaps: false,
            line: { color: COLORS.BLUE_D },
            marker: { color: COLORS.BLUE_D },
            name: currentName,
            hovertemplate:
              "%{customdata[0]}<br>%{y:,} active users<extra>%{fullData.name}</extra>",
          },
          ...(hasPrevious
            ? [
                {
                  ...traceData(series.previous),
                  type: "scatter" as const,
                  mode: plotMode(series.previous),
                  connectgaps: false,
                  line: { color: COLORS.GRAY, dash: "dash" },
                  marker: { color: COLORS.GRAY },
                  name: "Previous 364 days",
                  hovertemplate:
                    "%{customdata[0]}<br>%{y:,} active users<extra>%{fullData.name}</extra>",
                },
              ]
            : []),
        ]}
        layout={{
          height: 320,
          hovermode: "x unified",
          margin: { l: 55, r: 20, t: 20, b: 45 },
          showlegend: hasPrevious,
          xaxis: { type: "date" },
          yaxis: { title: "Active users", rangemode: "tozero" },
        }}
        config={{ displayModeBar: false, responsive: true }}
      />
    </Space>
  );
}
