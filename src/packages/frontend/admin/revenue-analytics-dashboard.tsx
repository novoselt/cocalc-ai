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

import type { SiteLicenseRevenueAnalytics } from "@cocalc/conat/hub/api/commercial-orders";
import type {
  AdminMembershipTierRow,
  ComputeRevenueProduct,
  ComputeRevenueSeries,
  MembershipAllocationChannel,
  MembershipAllocationSeries,
} from "@cocalc/conat/hub/api/purchases";
import { Tooltip } from "@cocalc/frontend/components";
import ShowError from "@cocalc/frontend/components/error";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { COLORS } from "@cocalc/util/theme";

import {
  buildCombinedRevenueAnalyticsView,
  buildComputeRevenueAnalyticsView,
  type ComputeUnitMetric,
} from "./compute-revenue-analytics-view";
import {
  buildMembershipAnalyticsSeriesVisuals,
  MembershipAnalyticsLegend,
  MembershipAnalyticsPlot,
  MembershipAnalyticsSeriesSwatch,
  type MembershipAnalyticsChartMode,
  type MembershipAnalyticsSeriesVisual,
} from "./membership-analytics-chart";
import {
  buildMembershipAllocationDailyExport,
  MembershipAnalyticsExport,
  buildRevenueAnalyticsDailyExport,
  RevenueAnalyticsExport,
} from "./membership-analytics-export";
import {
  buildMembershipAnalyticsView,
  shiftMembershipAnalyticsDay,
  type MembershipAnalyticsBreakdown,
  type MembershipAnalyticsSummaryRow,
  type MembershipAnalyticsTier,
} from "./membership-analytics-view";
import {
  addSiteLicenseRevenueToAnalyticsView,
  buildSiteLicenseAccountingView,
  SITE_LICENSE_REVENUE_MEASURES,
  siteLicenseAccountingTotals,
} from "./site-license-revenue-analytics-view";

const { Text, Title } = Typography;
const DAYS_IN_YEAR_COMPARISON = 364;
const MONTHLY_EQUIVALENT_DAYS = 365.25 / 12;

type Period = "year" | "all";
type Comparison = 0 | 7 | 28 | 364;

export const COMPUTE_UNIT_METRIC_DESCRIPTIONS: Record<
  ComputeUnitMetric,
  string
> = {
  average:
    "Daily running time divided by 24 hours. One machine running for 12 hours counts as 0.5.",
  distinct:
    "Number of different machines that ran at any time during the day, regardless of duration.",
};

export const COMPUTE_UNIT_METRIC_OPTIONS = [
  {
    value: "average" as const,
    label: "Average running",
    title: COMPUTE_UNIT_METRIC_DESCRIPTIONS.average,
  },
  {
    value: "distinct" as const,
    label: "Distinct used",
    title: COMPUTE_UNIT_METRIC_DESCRIPTIONS.distinct,
  },
];

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
  { value: "tier-channel", label: "Tier and channel" },
];

const SINGLE_CHANNEL_BREAKDOWN_OPTIONS: MembershipAnalyticsBreakdownOption[] = [
  { value: "tier", label: "Tier" },
];

const COMPUTE_BREAKDOWN_OPTIONS: MembershipAnalyticsBreakdownOption[] = [
  { value: "product", label: "Product" },
  { value: "cost-component", label: "Cost component" },
  { value: "provider", label: "Provider" },
  { value: "product-cost-component", label: "Product and cost component" },
  { value: "product-provider", label: "Product and provider" },
];

const SINGLE_COMPUTE_BREAKDOWN_OPTIONS = COMPUTE_BREAKDOWN_OPTIONS.filter(
  ({ value }) =>
    value !== "product" &&
    value !== "product-cost-component" &&
    value !== "product-provider",
);

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
  computeProducts: ComputeRevenueProduct[],
): MembershipAnalyticsBreakdown {
  if (channels.length && computeProducts.length) return "source";
  if (computeProducts.length === 1) return "cost-component";
  if (computeProducts.length > 1) return "product";
  return channels.length === 1 ? "tier" : "channel";
}

export function revenueBreakdownOptions({
  channels,
  computeProducts,
}: {
  channels: MembershipAllocationChannel[];
  computeProducts: ComputeRevenueProduct[];
}): MembershipAnalyticsBreakdownOption[] {
  if (channels.length && computeProducts.length) {
    return [{ value: "source", label: "Source" }];
  }
  if (computeProducts.length) {
    return computeProducts.length === 1
      ? SINGLE_COMPUTE_BREAKDOWN_OPTIONS
      : COMPUTE_BREAKDOWN_OPTIONS;
  }
  return membershipBreakdownOptions(channels);
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

export function formatRevenueAnalyticsTableMoney(cents: number): string {
  return cents === 0 ? "-" : formatMoneyCents(cents);
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatComputeUnits(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value < 10 ? 2 : 1,
  });
}

function formatTableInteger(value: number): string {
  return value === 0 ? "-" : formatInteger(value);
}

function formatTableComputeUnits(value: number): string {
  return value === 0 ? "-" : formatComputeUnits(value);
}

function formatPercent(value: number): string {
  const absolute = Math.abs(value);
  const digits = absolute >= 10 ? 0 : 1;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function ComputeUnitColumnTitle({
  metric,
  children,
}: {
  metric: ComputeUnitMetric;
  children: string;
}) {
  return (
    <Tooltip title={COMPUTE_UNIT_METRIC_DESCRIPTIONS[metric]}>
      <span tabIndex={0}>{children}</span>
    </Tooltip>
  );
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
  if (difference === 0) return <Text type="secondary">-</Text>;
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

export function siteLicenseAnalyticsTableRowExplanation(
  row: MembershipAnalyticsSummaryRow,
  breakdown: MembershipAnalyticsBreakdown,
): string | undefined {
  if (row.countApplicable === false) {
    return breakdown === "channel" || breakdown === "source"
      ? "Contracted site license value is shown for the license as a whole. This row does not represent an assigned membership count."
      : "Contracted site license value is shown for the license as a whole. Membership counts are included in the tier breakdown.";
  }
  if (
    row.channel === "site" &&
    (breakdown === "channel-tier" || breakdown === "tier-channel")
  ) {
    return "Site license memberships are shown by tier. Contracted value is shown separately for the license as a whole.";
  }
}

function AnalyticsTable({
  rows,
  visualByKey,
  chartMode,
  latestDay,
  comparison,
  teamOnly,
  breakdown,
  countMode,
}: {
  rows: MembershipAnalyticsSummaryRow[];
  visualByKey: Map<string, MembershipAnalyticsSeriesVisual>;
  chartMode: MembershipAnalyticsChartMode;
  latestDay: string;
  comparison?: string;
  teamOnly: boolean;
  breakdown: MembershipAnalyticsBreakdown;
  countMode: "membership" | "compute" | "none";
}) {
  const notShown = () => <Text type="secondary">-</Text>;
  const categoryTitle =
    breakdown === "source"
      ? "Source"
      : breakdown === "channel"
        ? "Channel"
        : breakdown === "channel-tier"
          ? "Channel and tier"
          : breakdown === "tier-channel"
            ? "Tier and channel"
            : breakdown === "product"
              ? "Product"
              : breakdown === "cost-component"
                ? "Cost component"
                : breakdown === "provider"
                  ? "Provider"
                  : breakdown === "product-cost-component"
                    ? "Product and cost component"
                    : breakdown === "product-provider"
                      ? "Product and provider"
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
              const content = (
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
              const explanation = siteLicenseAnalyticsTableRowExplanation(
                row,
                breakdown,
              );
              return explanation ? (
                <Tooltip title={explanation}>
                  <div style={{ width: "100%" }} tabIndex={0}>
                    {content}
                  </div>
                </Tooltip>
              ) : (
                content
              );
            },
          },
          ...(countMode === "membership"
            ? [
                {
                  title: "Active memberships",
                  dataIndex: "activeMemberships",
                  align: "right" as const,
                  render: (
                    value: number,
                    row: MembershipAnalyticsSummaryRow,
                  ) => {
                    if (row.countApplicable === false) {
                      return notShown();
                    }
                    const assigned = formatInteger(value);
                    if (
                      (row.channel !== "team" && !teamOnly) ||
                      row.purchasedCapacity <= 0
                    ) {
                      return formatTableInteger(value);
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
              ]
            : countMode === "compute"
              ? [
                  {
                    title: (
                      <ComputeUnitColumnTitle metric="average">
                        Average running
                      </ComputeUnitColumnTitle>
                    ),
                    dataIndex: "averageRunningUnits",
                    align: "right" as const,
                    render: (value: number | undefined) =>
                      formatTableComputeUnits(value ?? 0),
                  },
                  {
                    title: (
                      <ComputeUnitColumnTitle metric="distinct">
                        Distinct used
                      </ComputeUnitColumnTitle>
                    ),
                    dataIndex: "distinctRunningUnits",
                    align: "right" as const,
                    render: (value: number | undefined) =>
                      formatTableInteger(value ?? 0),
                  },
                ]
              : []),
          ...(comparison && countMode === "membership"
            ? [
                {
                  title: "Change",
                  key: "membershipChange",
                  align: "right" as const,
                  render: (_: unknown, row: MembershipAnalyticsSummaryRow) =>
                    row.countApplicable === false ? (
                      notShown()
                    ) : (
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
            render: formatRevenueAnalyticsTableMoney,
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
              formatRevenueAnalyticsTableMoney(value * MONTHLY_EQUIVALENT_DAYS),
          },
        ]}
      />
    </Space>
  );
}

export function RevenueAnalyticsDashboard({
  channels,
  computeProducts,
}: {
  channels: MembershipAllocationChannel[];
  computeProducts: ComputeRevenueProduct[];
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allocation, setAllocation] =
    useState<MembershipAllocationSeries | null>(null);
  const [computeAllocation, setComputeAllocation] =
    useState<ComputeRevenueSeries | null>(null);
  const [siteLicenseRevenue, setSiteLicenseRevenue] =
    useState<SiteLicenseRevenueAnalytics | null>(null);
  const [tiers, setTiers] = useState<MembershipAnalyticsTier[]>([]);
  const [period, setPeriod] = useState<Period>("year");
  const [comparison, setComparison] = useState<Comparison>(364);
  const [breakdown, setBreakdown] =
    useState<MembershipAnalyticsBreakdown>("channel");
  const [chartMode, setChartMode] =
    useState<MembershipAnalyticsChartMode>("stacked");
  const [computeUnitMetric, setComputeUnitMetric] =
    useState<ComputeUnitMetric>("average");
  const [hoverDay, setHoverDay] = useState<string>();
  const [allHistoryLoaded, setAllHistoryLoaded] = useState(false);
  const loadSequence = useRef(0);

  const load = useEffectEvent(async (start: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const end = shiftMembershipAnalyticsDay(todayUtc(), 1);
      const [allocationResult, computeResult, siteRevenueResult, tierResult] =
        await Promise.all([
          webapp_client.conat_client.hub.purchases.getMembershipAllocationSeries(
            {
              start,
              end,
            },
          ),
          webapp_client.conat_client.hub.purchases.getComputeRevenueSeries({
            start,
            end: todayUtc(),
          }),
          webapp_client.conat_client.hub.commercialOrders.siteLicenseRevenueAnalytics(
            {
              start,
              end,
              reason: "Review site license revenue analytics",
            },
          ),
          webapp_client.conat_client.hub.purchases.getMembershipTierAdminOverview(
            {},
          ),
        ]);
      if (sequence !== loadSequence.current) return;
      setAllocation(allocationResult);
      setComputeAllocation(computeResult);
      setSiteLicenseRevenue(siteRevenueResult);
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
  const selectedComputeProducts = new Set(computeProducts);
  const selectedComputeRevenue =
    computeAllocation?.revenue.filter(({ product }) =>
      selectedComputeProducts.has(product),
    ) ?? [];
  const selectedComputeUsage =
    computeAllocation?.usage.filter(({ product }) =>
      selectedComputeProducts.has(product),
    ) ?? [];
  const selectedSiteLicenseRevenue = selectedChannels.has("site")
    ? (siteLicenseRevenue?.rows ?? [])
    : [];
  const hasMemberships = channels.length > 0;
  const hasCompute = computeProducts.length > 0;
  const mixedProducts = hasMemberships && hasCompute;
  const breakdownOptions = revenueBreakdownOptions({
    channels,
    computeProducts,
  });
  const effectiveBreakdown = breakdownOptions.some(
    ({ value }) => value === breakdown,
  )
    ? breakdown
    : defaultBreakdown(channels, computeProducts);
  const sourceDays = [
    ...selectedRows.map(({ day }) => new Date(day).toISOString().slice(0, 10)),
    ...selectedComputeRevenue.map(({ day }) =>
      new Date(day).toISOString().slice(0, 10),
    ),
    ...selectedSiteLicenseRevenue.map(({ day }) =>
      new Date(day).toISOString().slice(0, 10),
    ),
  ];
  const earliest = sourceDays.length ? sourceDays.sort()[0] : queryStart();
  const start = displayedStart(period, earliest);
  const end = hasCompute
    ? computeAllocation?.complete_through
      ? new Date(computeAllocation.complete_through).toISOString().slice(0, 10)
      : ""
    : todayUtc();
  const membershipHistoryStart = allocation
    ? new Date(allocation.start).toISOString().slice(0, 10)
    : queryStart();
  const computeHistoryStart = computeAllocation
    ? new Date(computeAllocation.start).toISOString().slice(0, 10)
    : queryStart();
  const historyStart = mixedProducts
    ? [membershipHistoryStart, computeHistoryStart].sort().at(-1)!
    : hasCompute
      ? computeHistoryStart
      : membershipHistoryStart;
  const baseView =
    allocation && computeAllocation && siteLicenseRevenue && end && start <= end
      ? mixedProducts
        ? buildCombinedRevenueAnalyticsView({
            memberships: selectedRows,
            compute: selectedComputeRevenue,
            start,
            end,
            historyStart,
            comparisonDays: comparison,
          })
        : hasCompute
          ? buildComputeRevenueAnalyticsView({
              revenue: selectedComputeRevenue,
              usage: selectedComputeUsage,
              breakdown: effectiveBreakdown,
              start,
              end,
              historyStart,
              comparisonDays: comparison,
              unitMetric: computeUnitMetric,
            })
          : hasMemberships
            ? buildMembershipAnalyticsView({
                rows: selectedRows,
                tiers,
                breakdown: effectiveBreakdown,
                start,
                end,
                historyStart,
                comparisonDays: comparison,
              })
            : undefined
      : undefined;
  const view =
    baseView && selectedChannels.has("site")
      ? addSiteLicenseRevenueToAnalyticsView({
          view: baseView,
          rows: selectedSiteLicenseRevenue,
          breakdown: effectiveBreakdown,
          comparisonDays: comparison,
        })
      : baseView;
  const siteAccountingRows = selectedSiteLicenseRevenue.filter(({ day }) => {
    const key = new Date(day).toISOString().slice(0, 10);
    return key >= start && key <= end;
  });
  const siteAccountingView =
    selectedChannels.has("site") && end && start <= end
      ? buildSiteLicenseAccountingView({
          rows: selectedSiteLicenseRevenue,
          start,
          end,
          comparisonDays: comparison,
        })
      : undefined;
  const siteAccountingVisuals = siteAccountingView
    ? buildMembershipAnalyticsSeriesVisuals({
        series: siteAccountingView.series,
        tiers: [],
        breakdown: "source",
      })
    : [];
  const siteAccountingTotals = siteAccountingView
    ? siteLicenseAccountingTotals({
        rows: selectedSiteLicenseRevenue,
        start,
        end,
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
  const failedBays = [
    ...(allocation?.bays.filter(({ ok }) => !ok) ?? []),
    ...(computeAllocation?.bays.filter(({ ok }) => !ok) ?? []),
  ].filter(
    ({ bay_id }, index, rows) =>
      rows.findIndex((row) => row.bay_id === bay_id) === index,
  );
  const exportPayload =
    allocation &&
    channels.length &&
    !hasCompute &&
    !selectedChannels.has("site") &&
    !failedBays.length
      ? buildMembershipAllocationDailyExport({
          rows: selectedRows,
          tiers,
          channels,
          startDay: start,
          endDay: end,
        })
      : undefined;
  const revenueExportPayload =
    allocation &&
    computeAllocation &&
    siteLicenseRevenue &&
    (hasCompute || selectedChannels.has("site")) &&
    end &&
    !failedBays.length
      ? buildRevenueAnalyticsDailyExport({
          membershipRows: selectedRows,
          computeRevenueRows: selectedComputeRevenue,
          computeUsageRows: selectedComputeUsage,
          siteLicenseRevenueRows: selectedSiteLicenseRevenue,
          membershipChannels: channels,
          computeProducts,
          tiers,
          startDay: start,
          endDay: end,
        })
      : undefined;
  const visualByKey = new Map(
    visuals.map((visual) => [visual.series.key, visual]),
  );
  const computeCountCompatible =
    hasCompute &&
    !hasMemberships &&
    (effectiveBreakdown === "product" ||
      effectiveBreakdown === "provider" ||
      effectiveBreakdown === "product-provider");
  const countMode = mixedProducts
    ? "none"
    : hasCompute
      ? computeCountCompatible
        ? "compute"
        : "none"
      : "membership";
  const breakdownDisabled = (!hasMemberships && !hasCompute) || mixedProducts;

  return (
    <Space vertical size="middle" style={{ width: "100%" }}>
      <Space wrap>
        <Space>
          <Text>Breakdown:</Text>
          <Tooltip
            title={
              mixedProducts
                ? "Source is the available breakdown when membership and compute revenue are combined. Memberships are separated by channel and compute revenue by product."
                : undefined
            }
          >
            <span
              tabIndex={mixedProducts ? 0 : undefined}
              aria-label={
                mixedProducts
                  ? "Breakdown fixed to Source because membership and compute revenue are combined"
                  : undefined
              }
            >
              <Select
                aria-label="Revenue breakdown"
                value={effectiveBreakdown}
                options={breakdownOptions}
                onChange={setBreakdown}
                disabled={breakdownDisabled}
                style={{ minWidth: 190 }}
              />
            </span>
          </Tooltip>
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
        {hasCompute || selectedChannels.has("site") ? (
          <RevenueAnalyticsExport
            payload={revenueExportPayload}
            disabled={loading}
          />
        ) : (
          <MembershipAnalyticsExport
            payload={exportPayload}
            disabled={loading}
          />
        )}
      </Space>

      {loading ? <Spin description="Loading revenue history..." /> : null}
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
              Revenue per day
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

          {countMode !== "none" ? (
            <Space vertical style={{ width: "100%" }}>
              {countMode === "compute" ? (
                <Space wrap>
                  <Title level={4} style={{ margin: 0 }}>
                    Compute units
                  </Title>
                  <Segmented
                    aria-label="Compute unit metric"
                    value={computeUnitMetric}
                    options={COMPUTE_UNIT_METRIC_OPTIONS}
                    onChange={(value) =>
                      setComputeUnitMetric(value as ComputeUnitMetric)
                    }
                  />
                </Space>
              ) : (
                <Title level={4} style={{ margin: 0 }}>
                  Active memberships
                </Title>
              )}
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
          ) : null}

          <AnalyticsTable
            rows={view.summary}
            visualByKey={visualByKey}
            chartMode={chartMode}
            latestDay={view.latestDay}
            comparison={comparisonText}
            teamOnly={channels.length === 1 && channels[0] === "team"}
            breakdown={effectiveBreakdown}
            countMode={countMode}
          />
        </Space>
      ) : allocation && !loading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            hasMemberships || hasCompute
              ? "No revenue data is available for the selected products."
              : "Select at least one membership or compute product."
          }
        />
      ) : null}

      {siteAccountingView && siteAccountingRows.length ? (
        <Space vertical size="middle" style={{ width: "100%" }}>
          <Space vertical size={0}>
            <Title level={4} style={{ margin: 0 }}>
              Site license accounting
            </Title>
            <Text type="secondary">
              These are distinct measures and must not be added together. The
              chart uses lines rather than stacking for that reason.
            </Text>
          </Space>
          <MembershipAnalyticsLegend
            visuals={siteAccountingVisuals}
            breakdown="source"
            comparisonLabel={
              comparison > 0 && siteAccountingView.comparisonAvailable
                ? comparisonLabel(comparison)
                : undefined
            }
            chartMode="lines"
          />
          <MembershipAnalyticsPlot
            view={siteAccountingView}
            visuals={siteAccountingVisuals}
            metric="revenue"
            chartMode="lines"
            hoverDay={hoverDay}
            onHoverDay={setHoverDay}
            comparisonLabel={
              comparison > 0 && siteAccountingView.comparisonAvailable
                ? comparisonLabel(comparison)
                : undefined
            }
          />
          <Table
            aria-label="Site license accounting totals"
            bordered
            size="small"
            pagination={false}
            rowKey="measure"
            dataSource={SITE_LICENSE_REVENUE_MEASURES}
            columns={[
              {
                title: "Measure",
                dataIndex: "label",
                render: (label: string, row) => (
                  <Tooltip title={row.description}>
                    <span tabIndex={0}>{label}</span>
                  </Tooltip>
                ),
              },
              {
                title: "Selected period",
                dataIndex: "measure",
                align: "right",
                render: (measure) =>
                  formatMoneyCents(siteAccountingTotals?.[measure] ?? 0),
              },
            ]}
          />
        </Space>
      ) : null}
    </Space>
  );
}
