/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  ComputeRevenueCostComponent,
  ComputeRevenueDailyRow,
  ComputeRevenueProduct,
  ComputeUsageDailyRow,
  MembershipAllocationDailyRow,
} from "@cocalc/conat/hub/api/purchases";

import {
  membershipChannelLabel,
  membershipChannelOrder,
} from "./membership-analytics-channels";
import type {
  MembershipAnalyticsBreakdown,
  MembershipAnalyticsSeries,
  MembershipAnalyticsSummaryRow,
  MembershipAnalyticsView,
} from "./membership-analytics-view";
import { shiftMembershipAnalyticsDay } from "./membership-analytics-view";

export type ComputeUnitMetric = "average" | "distinct";

interface Category {
  key: string;
  label: string;
  channel?: MembershipAllocationDailyRow["channel"];
  groupLabel?: string;
  detailLabel?: string;
  groupKey?: string;
  groupOrder?: number;
  priority: number;
  order: number;
}

interface DailyValue {
  revenueCents: number;
  averageRunningUnits: number;
  distinctRunningUnits: number;
}

const PRODUCT_LABELS: Record<ComputeRevenueProduct, string> = {
  "dedicated-host": "Dedicated hosts",
  "virtual-machine": "Virtual machines",
};

const PRODUCT_ORDER: Record<ComputeRevenueProduct, number> = {
  "virtual-machine": 0,
  "dedicated-host": 1,
};
const MEMBERSHIP_SOURCE_OFFSET = Math.max(...Object.values(PRODUCT_ORDER)) + 1;

const COMPONENT_LABELS: Record<ComputeRevenueCostComponent, string> = {
  compute: "CPU/RAM compute",
  gpu: "GPU compute",
  storage: "Storage",
  "network-egress": "Network egress",
  other: "Other",
};

const COMPONENT_ORDER: Record<ComputeRevenueCostComponent, number> = {
  compute: 0,
  gpu: 1,
  storage: 2,
  "network-egress": 3,
  other: 4,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`invalid compute revenue analytics day: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function dayNumber(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / DAY_MS;
}

function dayFromNumber(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

function providerLabel(provider: string): string {
  const normalized = provider.trim();
  if (!normalized || normalized === "unknown") return "Unknown provider";
  if (normalized.toLowerCase() === "gcp") return "GCP";
  if (normalized.toLowerCase() === "nebius") return "Nebius";
  return normalized;
}

function providerOrder(provider: string): number {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "gcp") return 0;
  if (normalized === "nebius") return 1;
  if (!normalized || normalized === "unknown") return 2;
  return (
    3 +
    [...normalized].reduce(
      (value, character) => (value * 31 + character.charCodeAt(0)) % 10_000,
      0,
    )
  );
}

function categoryForCompute(
  row: Pick<ComputeRevenueDailyRow, "product" | "provider" | "cost_component">,
  breakdown: MembershipAnalyticsBreakdown,
): Category {
  const productLabel = PRODUCT_LABELS[row.product];
  const provider = providerLabel(row.provider);
  const component = COMPONENT_LABELS[row.cost_component];
  switch (breakdown) {
    case "product":
      return {
        key: `product:${row.product}`,
        label: productLabel,
        priority: 0,
        order: PRODUCT_ORDER[row.product],
      };
    case "cost-component":
      return {
        key: `component:${row.cost_component}`,
        label: component,
        priority: 0,
        order: COMPONENT_ORDER[row.cost_component],
      };
    case "provider":
      return {
        key: `provider:${row.provider}`,
        label: provider,
        priority: 0,
        order: providerOrder(row.provider),
      };
    case "product-cost-component":
      return {
        key: `product:${row.product}:component:${row.cost_component}`,
        label: `${productLabel} · ${component}`,
        groupLabel: productLabel,
        detailLabel: component,
        groupKey: `product:${row.product}`,
        groupOrder: PRODUCT_ORDER[row.product],
        priority: 0,
        order: COMPONENT_ORDER[row.cost_component],
      };
    case "product-provider":
      return {
        key: `product:${row.product}:provider:${row.provider}`,
        label: `${productLabel} · ${provider}`,
        groupLabel: productLabel,
        detailLabel: provider,
        groupKey: `product:${row.product}`,
        groupOrder: PRODUCT_ORDER[row.product],
        priority: 0,
        order: providerOrder(row.provider),
      };
    default:
      throw Error(
        `membership breakdown ${breakdown} cannot group compute rows`,
      );
  }
}

function categoryForUsage(
  row: ComputeUsageDailyRow,
  breakdown: MembershipAnalyticsBreakdown,
): Category | undefined {
  return categoryForCompute({ ...row, cost_component: "other" }, breakdown);
}

function emptyValue(): DailyValue {
  return {
    revenueCents: 0,
    averageRunningUnits: 0,
    distinctRunningUnits: 0,
  };
}

function valueAt(values: Map<string, DailyValue>, day: string): DailyValue {
  return values.get(day) ?? emptyValue();
}

function buildView({
  categories,
  valuesByCategory,
  start,
  end,
  historyStart,
  comparisonDays,
  unitMetric,
}: {
  categories: Map<string, Category>;
  valuesByCategory: Map<string, Map<string, DailyValue>>;
  start: Date | string;
  end: Date | string;
  historyStart: Date | string;
  comparisonDays: number;
  unitMetric: ComputeUnitMetric;
}): MembershipAnalyticsView {
  const startDay = dayKey(start);
  const endDay = dayKey(end);
  const historyStartDay = dayKey(historyStart);
  const startNumber = dayNumber(startDay);
  const endNumber = dayNumber(endDay);
  if (startNumber > endNumber) {
    throw Error("compute analytics start must not follow end");
  }
  const days = Array.from({ length: endNumber - startNumber + 1 }, (_, index) =>
    dayFromNumber(startNumber + index),
  );
  const comparisonDay = shiftMembershipAnalyticsDay(endDay, -comparisonDays);
  const comparisonAvailable =
    comparisonDays > 0 &&
    dayNumber(comparisonDay) >= dayNumber(historyStartDay);
  const sorted = [...categories.values()].sort(
    (a, b) =>
      (a.groupOrder ?? 0) - (b.groupOrder ?? 0) ||
      a.order - b.order ||
      a.label.localeCompare(b.label) ||
      a.key.localeCompare(b.key),
  );
  const pointCount = (value: DailyValue) =>
    unitMetric === "average"
      ? value.averageRunningUnits
      : value.distinctRunningUnits;
  const series: MembershipAnalyticsSeries[] = sorted.map((category) => {
    const values = valuesByCategory.get(category.key) ?? new Map();
    return {
      ...category,
      current: days.map((displayDay) => {
        const value = valueAt(values, displayDay);
        return {
          displayDay,
          actualDay: displayDay,
          activeMemberships: pointCount(value),
          purchasedCapacity: 0,
          revenueCents: value.revenueCents,
        };
      }),
      comparison:
        comparisonDays > 0
          ? days.map((displayDay) => {
              const actualDay = shiftMembershipAnalyticsDay(
                displayDay,
                -comparisonDays,
              );
              const value = valueAt(values, actualDay);
              return {
                displayDay,
                actualDay,
                activeMemberships: pointCount(value),
                purchasedCapacity: 0,
                revenueCents: value.revenueCents,
              };
            })
          : [],
    };
  });
  const summary: MembershipAnalyticsSummaryRow[] = sorted.map((category) => {
    const values = valuesByCategory.get(category.key) ?? new Map();
    const current = valueAt(values, endDay);
    const comparison = valueAt(values, comparisonDay);
    return {
      key: category.key,
      label: category.label,
      activeMemberships: pointCount(current),
      comparisonActiveMemberships: pointCount(comparison),
      purchasedCapacity: 0,
      comparisonPurchasedCapacity: 0,
      revenueCents: current.revenueCents,
      comparisonRevenueCents: comparison.revenueCents,
      averageRunningUnits: current.averageRunningUnits,
      comparisonAverageRunningUnits: comparison.averageRunningUnits,
      distinctRunningUnits: current.distinctRunningUnits,
      comparisonDistinctRunningUnits: comparison.distinctRunningUnits,
    };
  });
  const total = summary.reduce<MembershipAnalyticsSummaryRow>(
    (result, row) => ({
      ...result,
      activeMemberships: result.activeMemberships + row.activeMemberships,
      comparisonActiveMemberships:
        result.comparisonActiveMemberships + row.comparisonActiveMemberships,
      revenueCents: result.revenueCents + row.revenueCents,
      comparisonRevenueCents:
        result.comparisonRevenueCents + row.comparisonRevenueCents,
      averageRunningUnits:
        (result.averageRunningUnits ?? 0) + (row.averageRunningUnits ?? 0),
      comparisonAverageRunningUnits:
        (result.comparisonAverageRunningUnits ?? 0) +
        (row.comparisonAverageRunningUnits ?? 0),
      distinctRunningUnits:
        (result.distinctRunningUnits ?? 0) + (row.distinctRunningUnits ?? 0),
      comparisonDistinctRunningUnits:
        (result.comparisonDistinctRunningUnits ?? 0) +
        (row.comparisonDistinctRunningUnits ?? 0),
    }),
    {
      key: "total",
      label: "Total",
      total: true,
      activeMemberships: 0,
      comparisonActiveMemberships: 0,
      purchasedCapacity: 0,
      comparisonPurchasedCapacity: 0,
      revenueCents: 0,
      comparisonRevenueCents: 0,
      averageRunningUnits: 0,
      comparisonAverageRunningUnits: 0,
      distinctRunningUnits: 0,
      comparisonDistinctRunningUnits: 0,
    },
  );
  return {
    start: startDay,
    end: endDay,
    latestDay: endDay,
    comparisonAvailable,
    series,
    summary: [total, ...summary],
  };
}

export function buildComputeRevenueAnalyticsView({
  revenue,
  usage,
  breakdown,
  start,
  end,
  historyStart = start,
  comparisonDays = 0,
  unitMetric = "average",
}: {
  revenue: ComputeRevenueDailyRow[];
  usage: ComputeUsageDailyRow[];
  breakdown: MembershipAnalyticsBreakdown;
  start: Date | string;
  end: Date | string;
  historyStart?: Date | string;
  comparisonDays?: number;
  unitMetric?: ComputeUnitMetric;
}): MembershipAnalyticsView {
  const categories = new Map<string, Category>();
  const valuesByCategory = new Map<string, Map<string, DailyValue>>();
  for (const row of revenue) {
    const category = categoryForCompute(row, breakdown);
    categories.set(category.key, category);
    const values = valuesByCategory.get(category.key) ?? new Map();
    const day = dayKey(row.day);
    const value = values.get(day) ?? emptyValue();
    value.revenueCents += Number(row.revenue_cents) || 0;
    values.set(day, value);
    valuesByCategory.set(category.key, values);
  }
  if (
    breakdown === "product" ||
    breakdown === "provider" ||
    breakdown === "product-provider"
  ) {
    for (const row of usage) {
      const category = categoryForUsage(row, breakdown);
      if (category == null) continue;
      categories.set(category.key, category);
      const values = valuesByCategory.get(category.key) ?? new Map();
      const day = dayKey(row.day);
      const value = values.get(day) ?? emptyValue();
      value.averageRunningUnits +=
        (Number(row.running_unit_seconds) || 0) / 86_400;
      value.distinctRunningUnits += Number(row.distinct_running_units) || 0;
      values.set(day, value);
      valuesByCategory.set(category.key, values);
    }
  }
  return buildView({
    categories,
    valuesByCategory,
    start,
    end,
    historyStart,
    comparisonDays,
    unitMetric,
  });
}

export function buildCombinedRevenueAnalyticsView({
  memberships,
  compute,
  start,
  end,
  historyStart = start,
  comparisonDays = 0,
}: {
  memberships: MembershipAllocationDailyRow[];
  compute: ComputeRevenueDailyRow[];
  start: Date | string;
  end: Date | string;
  historyStart?: Date | string;
  comparisonDays?: number;
}): MembershipAnalyticsView {
  const categories = new Map<string, Category>();
  const valuesByCategory = new Map<string, Map<string, DailyValue>>();
  function add(
    key: string,
    category: Category,
    dayValue: Date | string,
    cents: number,
  ) {
    categories.set(key, category);
    const values = valuesByCategory.get(key) ?? new Map();
    const day = dayKey(dayValue);
    const value = values.get(day) ?? emptyValue();
    value.revenueCents += cents;
    values.set(day, value);
    valuesByCategory.set(key, values);
  }
  for (const row of memberships) {
    const key = `source:membership:${row.channel}`;
    add(
      key,
      {
        key,
        label: membershipChannelLabel(row.channel),
        channel: row.channel,
        priority: 0,
        order: MEMBERSHIP_SOURCE_OFFSET + membershipChannelOrder(row.channel),
      },
      row.day,
      Number(row.revenue_cents) || 0,
    );
  }
  for (const row of compute) {
    const category = categoryForCompute(row, "product");
    add(category.key, category, row.day, Number(row.revenue_cents) || 0);
  }
  return buildView({
    categories,
    valuesByCategory,
    start,
    end,
    historyStart,
    comparisonDays,
    unitMetric: "average",
  });
}
