/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type {
  AdminMembershipTierRow,
  MembershipAllocationChannel,
  MembershipAllocationSeries,
} from "@cocalc/conat/hub/api/purchases";
import { Tooltip } from "@cocalc/frontend/components";
import ShowError from "@cocalc/frontend/components/error";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { COLORS } from "@cocalc/util/theme";

import {
  buildMembershipAnalyticsSeriesVisuals,
  MembershipAnalyticsLegend,
  MembershipAnalyticsPlot,
  MembershipAnalyticsSeriesSwatch,
  type MembershipAnalyticsChartMode,
  type MembershipAnalyticsSeriesVisual,
} from "./membership-analytics-chart";
import {
  buildMembershipAnalyticsView,
  shiftMembershipAnalyticsDay,
  type MembershipAnalyticsBreakdown,
  type MembershipAnalyticsSummaryRow,
  type MembershipAnalyticsTier,
} from "./membership-analytics-view";

const { Text, Title } = Typography;
const DAYS_IN_YEAR_COMPARISON = 364;
const MONTHLY_EQUIVALENT_DAYS = 365.25 / 12;

type Period = "year" | "all";
type Comparison = 0 | 7 | 28 | 364;

export type MembershipAnalyticsBreakdownOption = {
  value: MembershipAnalyticsBreakdown;
  label: string;
};

const PERSONAL_MEMBERSHIP_BREAKDOWN_OPTIONS: MembershipAnalyticsBreakdownOption[] =
  [
    { value: "tier", label: "Tier" },
    { value: "tier-interval", label: "Tier and billing period" },
    { value: "tier-lifecycle", label: "Tier and lifecycle" },
    { value: "interval", label: "Billing period" },
    { value: "lifecycle", label: "Lifecycle" },
  ];

const MULTI_CHANNEL_BREAKDOWN_OPTIONS: MembershipAnalyticsBreakdownOption[] = [
  { value: "channel", label: "Channel" },
  { value: "channel-tier", label: "Channel and tier" },
  { value: "tier", label: "Tier" },
];

const SINGLE_CHANNEL_BREAKDOWN_OPTIONS: MembershipAnalyticsBreakdownOption[] = [
  { value: "tier", label: "Tier" },
];

export function membershipBreakdownOptions(
  channels: MembershipAllocationChannel[],
): MembershipAnalyticsBreakdownOption[] {
  if (channels.length !== 1) return MULTI_CHANNEL_BREAKDOWN_OPTIONS;
  return channels[0] === "personal"
    ? PERSONAL_MEMBERSHIP_BREAKDOWN_OPTIONS
    : SINGLE_CHANNEL_BREAKDOWN_OPTIONS;
}

function defaultBreakdown(
  channels: MembershipAllocationChannel[],
): MembershipAnalyticsBreakdown {
  return channels.length === 1 ? "tier" : "channel";
}

const COMPARISON_OPTIONS: Array<{ value: Comparison; label: string }> = [
  { value: 0, label: "None" },
  { value: 7, label: "1 week" },
  { value: 28, label: "4 weeks" },
  { value: DAYS_IN_YEAR_COMPARISON, label: "52 weeks" },
];

function todayUtc(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

function fullHistoryStart(): string {
  return "2000-01-01";
}

function queryStart(): string {
  return shiftMembershipAnalyticsDay(todayUtc(), -(2 * 366));
}

function displayedStart(period: Period, earliest: string): string {
  if (period === "all") return earliest;
  return shiftMembershipAnalyticsDay(todayUtc(), -364);
}

function tierMetadata(
  rows: AdminMembershipTierRow[],
): MembershipAnalyticsTier[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label || row.id,
    priority: Number(row.priority ?? 0),
  }));
}

function comparisonLabel(days: Comparison): string | undefined {
  return COMPARISON_OPTIONS.find(({ value }) => value === days)?.label;
}

function formatMoneyCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatPercent(value: number): string {
  const absolute = Math.abs(value);
  const digits = absolute >= 10 ? 0 : 1;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function ComparisonValue({
  current,
  previous,
  format,
}: {
  current: number;
  previous: number;
  format: (value: number) => string;
}) {
  if (previous === 0) return <Text type="secondary">-</Text>;
  const difference = current - previous;
  const percent = (100 * difference) / Math.abs(previous);
  const color =
    difference > 0
      ? COLORS.BS_GREEN_D
      : difference < 0
        ? COLORS.BS_RED
        : undefined;
  return (
    <Text style={{ color }}>
      {difference > 0 ? "+" : ""}
      {format(difference)} ({formatPercent(percent)})
    </Text>
  );
}

function AnalyticsTable({
  rows,
  visualByKey,
  chartMode,
  latestDay,
  comparison,
  teamOnly,
  breakdown,
}: {
  rows: MembershipAnalyticsSummaryRow[];
  visualByKey: Map<string, MembershipAnalyticsSeriesVisual>;
  chartMode: MembershipAnalyticsChartMode;
  latestDay: string;
  comparison?: string;
  teamOnly: boolean;
  breakdown: MembershipAnalyticsBreakdown;
}) {
  const categoryTitle =
    breakdown === "channel"
      ? "Channel"
      : breakdown === "channel-tier"
        ? "Channel and membership"
        : "Membership";
  return (
    <Space vertical style={{ width: "100%" }}>
      <Title level={4} style={{ margin: 0 }}>
        Current breakdown · {dayjs(latestDay).format("MMMM D, YYYY")}
      </Title>
      <Table<MembershipAnalyticsSummaryRow>
        bordered
        dataSource={rows}
        pagination={false}
        rowKey="key"
        size="small"
        columns={[
          {
            title: categoryTitle,
            dataIndex: "label",
            render: (label: string, row) => {
              const visual = visualByKey.get(row.key);
              return (
                <Space>
                  {visual ? (
                    <MembershipAnalyticsSeriesSwatch
                      visual={visual}
                      chartMode={chartMode}
                    />
                  ) : null}
                  <Text strong={row.total}>{label}</Text>
                </Space>
              );
            },
          },
          {
            title: "Active memberships",
            dataIndex: "activeMemberships",
            align: "right",
            render: (value: number, row) => {
              const assigned = formatInteger(value);
              if (
                (row.channel !== "team" && !teamOnly) ||
                row.purchasedCapacity <= 0
              ) {
                return assigned;
              }
              const paid = formatInteger(row.purchasedCapacity);
              return (
                <Tooltip
                  title={
                    <Space vertical size={0}>
                      <span>Assigned: {assigned}</span>
                      <span>Paid: {paid}</span>
                    </Space>
                  }
                >
                  <span
                    aria-label={`${assigned} assigned memberships out of ${paid} paid seats`}
                    style={{ whiteSpace: "nowrap" }}
                    tabIndex={0}
                  >
                    {assigned} / {paid}
                  </span>
                </Tooltip>
              );
            },
          },
          ...(comparison
            ? [
                {
                  title: "Change",
                  key: "membershipChange",
                  align: "right" as const,
                  render: (_: unknown, row: MembershipAnalyticsSummaryRow) => (
                    <ComparisonValue
                      current={row.activeMemberships}
                      previous={row.comparisonActiveMemberships}
                      format={formatInteger}
                    />
                  ),
                },
              ]
            : []),
          {
            title: "Revenue/day",
            dataIndex: "revenueCents",
            align: "right",
            render: formatMoneyCents,
          },
          ...(comparison
            ? [
                {
                  title: "Revenue change",
                  key: "revenueChange",
                  align: "right" as const,
                  render: (_: unknown, row: MembershipAnalyticsSummaryRow) => (
                    <ComparisonValue
                      current={row.revenueCents}
                      previous={row.comparisonRevenueCents}
                      format={formatMoneyCents}
                    />
                  ),
                },
              ]
            : []),
          {
            title: "Monthly equivalent",
            dataIndex: "revenueCents",
            align: "right",
            render: (value: number) =>
              formatMoneyCents(value * MONTHLY_EQUIVALENT_DAYS),
          },
        ]}
      />
    </Space>
  );
}

export function MembershipAnalyticsDashboard({
  channels,
}: {
  channels: MembershipAllocationChannel[];
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allocation, setAllocation] =
    useState<MembershipAllocationSeries | null>(null);
  const [tiers, setTiers] = useState<MembershipAnalyticsTier[]>([]);
  const [period, setPeriod] = useState<Period>("year");
  const [comparison, setComparison] = useState<Comparison>(364);
  const [breakdown, setBreakdown] =
    useState<MembershipAnalyticsBreakdown>("channel");
  const [chartMode, setChartMode] =
    useState<MembershipAnalyticsChartMode>("stacked");
  const [hoverDay, setHoverDay] = useState<string>();
  const [allHistoryLoaded, setAllHistoryLoaded] = useState(false);
  const loadSequence = useRef(0);

  const load = useEffectEvent(async (start: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const end = shiftMembershipAnalyticsDay(todayUtc(), 1);
      const [allocationResult, tierResult] = await Promise.all([
        webapp_client.conat_client.hub.purchases.getMembershipAllocationSeries({
          start,
          end,
        }),
        webapp_client.conat_client.hub.purchases.getMembershipTierAdminOverview(
          {},
        ),
      ]);
      if (sequence !== loadSequence.current) return;
      setAllocation(allocationResult);
      setTiers(tierMetadata(tierResult.tiers ?? []));
      setAllHistoryLoaded(start === fullHistoryStart());
    } catch (err) {
      if (sequence !== loadSequence.current) return;
      setError(`${err}`);
    } finally {
      if (sequence === loadSequence.current) {
        setLoading(false);
      }
    }
  });

  useEffect(() => {
    void load(queryStart());
  }, []);

  function selectPeriod(value: string | number) {
    const nextPeriod = value as Period;
    setPeriod(nextPeriod);
    if (nextPeriod === "all" && !allHistoryLoaded) {
      void load(fullHistoryStart());
    }
  }

  const selectedChannels = new Set(channels);
  const selectedRows =
    allocation?.rows.filter(({ channel }) => selectedChannels.has(channel)) ??
    [];
  const breakdownOptions = membershipBreakdownOptions(channels);
  const effectiveBreakdown = breakdownOptions.some(
    ({ value }) => value === breakdown,
  )
    ? breakdown
    : defaultBreakdown(channels);
  const earliest = selectedRows.length
    ? selectedRows
        .map(({ day }) => new Date(day).toISOString().slice(0, 10))
        .sort()[0]
    : queryStart();
  const start = displayedStart(period, earliest);
  const end = todayUtc();
  const view =
    allocation && channels.length
      ? buildMembershipAnalyticsView({
          rows: selectedRows,
          tiers,
          breakdown: effectiveBreakdown,
          start,
          end,
          historyStart: allocation.start,
          comparisonDays: comparison,
        })
      : undefined;
  const visuals = view
    ? buildMembershipAnalyticsSeriesVisuals({
        series: view.series,
        tiers,
        breakdown: effectiveBreakdown,
      })
    : [];
  const comparisonText =
    comparison > 0 && view?.comparisonAvailable
      ? comparisonLabel(comparison)
      : undefined;
  const failedBays = allocation?.bays.filter(({ ok }) => !ok) ?? [];
  const visualByKey = new Map(
    visuals.map((visual) => [visual.series.key, visual]),
  );

  return (
    <Space vertical size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Space>
          <Text>Breakdown:</Text>
          <Select
            value={effectiveBreakdown}
            options={breakdownOptions}
            onChange={setBreakdown}
            disabled={!channels.length}
            style={{ minWidth: 190 }}
          />
        </Space>
        <Space>
          <Text>Period:</Text>
          <Segmented
            value={period}
            options={[
              { value: "year", label: "Last year" },
              { value: "all", label: "All" },
            ]}
            onChange={selectPeriod}
          />
        </Space>
        <Space>
          <Text>Compare:</Text>
          <Select<Comparison>
            value={comparison}
            options={COMPARISON_OPTIONS}
            onChange={setComparison}
            style={{ minWidth: 110 }}
          />
        </Space>
        <Space>
          <Text>Charts:</Text>
          <Segmented
            value={chartMode}
            options={[
              { value: "stacked", label: "Stacked area" },
              { value: "lines", label: "Lines" },
            ]}
            onChange={(value) =>
              setChartMode(value as MembershipAnalyticsChartMode)
            }
          />
        </Space>
      </Space>

      {loading ? (
        <Spin description="Loading membership revenue history..." />
      ) : null}
      {error ? <ShowError error={error} /> : null}
      {failedBays.length ? (
        <Alert
          type="warning"
          showIcon
          title="Partial analytics result"
          description={failedBays
            .map(({ bay_id, error }) => `${bay_id}: ${error ?? "unavailable"}`)
            .join("; ")}
        />
      ) : null}
      {comparison > 0 && view && !view.comparisonAvailable ? (
        <Alert
          type="info"
          showIcon
          title={`${comparisonLabel(comparison)} comparison is not available for this range.`}
        />
      ) : null}

      {view && view.series.length ? (
        <Space vertical size="middle" style={{ width: "100%" }}>
          <MembershipAnalyticsLegend
            visuals={visuals}
            breakdown={effectiveBreakdown}
            comparisonLabel={comparisonText}
            chartMode={chartMode}
          />

          <Space vertical style={{ width: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>
              Recognized membership revenue per day
            </Title>
            <MembershipAnalyticsPlot
              view={view}
              visuals={visuals}
              metric="revenue"
              chartMode={chartMode}
              comparisonLabel={comparisonText}
              hoverDay={hoverDay}
              onHoverDay={setHoverDay}
            />
          </Space>

          <Space vertical style={{ width: "100%" }}>
            <Title level={4} style={{ margin: 0 }}>
              Active memberships
            </Title>
            <MembershipAnalyticsPlot
              view={view}
              visuals={visuals}
              metric="memberships"
              chartMode={chartMode}
              comparisonLabel={comparisonText}
              hoverDay={hoverDay}
              onHoverDay={setHoverDay}
            />
          </Space>

          <AnalyticsTable
            rows={view.summary}
            visualByKey={visualByKey}
            chartMode={chartMode}
            latestDay={view.latestDay}
            comparison={comparisonText}
            teamOnly={channels.length === 1 && channels[0] === "team"}
            breakdown={effectiveBreakdown}
          />
        </Space>
      ) : allocation && !loading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            channels.length
              ? "No membership allocation data is available for the selected channels."
              : "Select at least one membership channel."
          }
        />
      ) : null}
    </Space>
  );
}
