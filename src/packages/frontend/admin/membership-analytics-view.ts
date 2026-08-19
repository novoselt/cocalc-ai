/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  MembershipAllocationBillingInterval,
  MembershipAllocationChannel,
  MembershipAllocationDailyRow,
  MembershipAllocationLifecycle,
} from "@cocalc/conat/hub/api/purchases";

import {
  membershipChannelLabel,
  membershipChannelOrder,
} from "./membership-analytics-channels";

export type MembershipAnalyticsBreakdown =
  | "channel"
  | "channel-tier"
  | "tier"
  | "tier-interval"
  | "tier-lifecycle"
  | "interval"
  | "lifecycle";

export interface MembershipAnalyticsTier {
  id: string;
  label: string;
  priority: number;
}

export interface MembershipAnalyticsPoint {
  displayDay: string;
  actualDay: string;
  activeMemberships: number;
  purchasedCapacity: number;
  revenueCents: number;
}

export interface MembershipAnalyticsSeries {
  key: string;
  label: string;
  groupLabel?: string;
  detailLabel?: string;
  tierId?: string;
  channel?: MembershipAllocationChannel;
  groupKey?: string;
  variant?: MembershipAllocationBillingInterval | MembershipAllocationLifecycle;
  priority: number;
  order: number;
  current: MembershipAnalyticsPoint[];
  comparison: MembershipAnalyticsPoint[];
}

export interface MembershipAnalyticsSummaryRow {
  key: string;
  label: string;
  total?: boolean;
  channel?: MembershipAllocationChannel;
  activeMemberships: number;
  comparisonActiveMemberships: number;
  purchasedCapacity: number;
  comparisonPurchasedCapacity: number;
  revenueCents: number;
  comparisonRevenueCents: number;
}

export interface MembershipAnalyticsView {
  start: string;
  end: string;
  latestDay: string;
  comparisonAvailable: boolean;
  series: MembershipAnalyticsSeries[];
  summary: MembershipAnalyticsSummaryRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const INTERVAL_LABELS: Record<MembershipAllocationBillingInterval, string> = {
  trial: "Trial",
  month: "Monthly",
  year: "Annual",
  fixed: "Fixed term",
};

const INTERVAL_ORDER: Record<MembershipAllocationBillingInterval, number> = {
  month: 0,
  year: 1,
  fixed: 2,
  trial: 3,
};

const LIFECYCLE_LABELS: Record<MembershipAllocationLifecycle, string> = {
  trial: "Trial",
  first_paid: "First paid",
  renewal: "Renewal",
  plan_change: "Plan change",
};

const LIFECYCLE_ORDER: Record<MembershipAllocationLifecycle, number> = {
  trial: 0,
  first_paid: 1,
  renewal: 2,
  plan_change: 3,
};

interface DailyValue {
  activeMemberships: number;
  purchasedCapacity: number;
  revenueCents: number;
}

interface Category {
  key: string;
  label: string;
  groupLabel?: string;
  detailLabel?: string;
  tierId?: string;
  channel?: MembershipAllocationChannel;
  groupKey?: string;
  groupOrder?: number;
  variant?: MembershipAllocationBillingInterval | MembershipAllocationLifecycle;
  priority: number;
  order: number;
}

function dayKey(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`invalid membership analytics day: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function dayNumber(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / DAY_MS;
}

function dayFromNumber(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

export function shiftMembershipAnalyticsDay(
  day: string,
  offsetDays: number,
): string {
  return dayFromNumber(dayNumber(day) + offsetDays);
}

function tierMetadata(
  row: MembershipAllocationDailyRow,
  tiers: Map<string, MembershipAnalyticsTier>,
): MembershipAnalyticsTier {
  return (
    tiers.get(row.membership_class) ?? {
      id: row.membership_class,
      label: row.membership_class,
      priority: 0,
    }
  );
}

function categoryForRow(
  row: MembershipAllocationDailyRow,
  breakdown: MembershipAnalyticsBreakdown,
  tiers: Map<string, MembershipAnalyticsTier>,
): Category {
  const tier = tierMetadata(row, tiers);
  const interval = row.billing_interval;
  const lifecycle = row.lifecycle;
  const channel = row.channel;
  switch (breakdown) {
    case "channel":
      return {
        key: `channel:${channel}`,
        label: membershipChannelLabel(channel),
        channel,
        priority: 0,
        order: membershipChannelOrder(channel),
      };
    case "channel-tier":
      return {
        key: `channel:${channel}:tier:${tier.id}`,
        label: `${membershipChannelLabel(channel)} · ${tier.label}`,
        groupLabel: membershipChannelLabel(channel),
        detailLabel: tier.label,
        groupKey: `channel:${channel}`,
        groupOrder: membershipChannelOrder(channel),
        channel,
        tierId: tier.id,
        priority: tier.priority,
        order: 0,
      };
    case "tier":
      return {
        key: `tier:${tier.id}`,
        label: tier.label,
        tierId: tier.id,
        priority: tier.priority,
        order: 0,
      };
    case "tier-interval":
      return {
        key: `tier:${tier.id}:interval:${interval}`,
        label: `${tier.label} · ${INTERVAL_LABELS[interval]}`,
        groupLabel: tier.label,
        detailLabel: INTERVAL_LABELS[interval],
        groupKey: `tier:${tier.id}`,
        groupOrder: -tier.priority,
        tierId: tier.id,
        variant: interval,
        priority: tier.priority,
        order: INTERVAL_ORDER[interval],
      };
    case "tier-lifecycle":
      return {
        key: `tier:${tier.id}:lifecycle:${lifecycle}`,
        label: `${tier.label} · ${LIFECYCLE_LABELS[lifecycle]}`,
        groupLabel: tier.label,
        detailLabel: LIFECYCLE_LABELS[lifecycle],
        groupKey: `tier:${tier.id}`,
        groupOrder: -tier.priority,
        tierId: tier.id,
        variant: lifecycle,
        priority: tier.priority,
        order: LIFECYCLE_ORDER[lifecycle],
      };
    case "interval":
      return {
        key: `interval:${interval}`,
        label: INTERVAL_LABELS[interval],
        variant: interval,
        priority: 0,
        order: INTERVAL_ORDER[interval],
      };
    case "lifecycle":
      return {
        key: `lifecycle:${lifecycle}`,
        label: LIFECYCLE_LABELS[lifecycle],
        variant: lifecycle,
        priority: 0,
        order: LIFECYCLE_ORDER[lifecycle],
      };
  }
}

function categorySort(a: Category, b: Category): number {
  const groupOrder = (a.groupOrder ?? 0) - (b.groupOrder ?? 0);
  if (groupOrder !== 0) return groupOrder;
  const priorityOrder = b.priority - a.priority;
  if (priorityOrder !== 0) return priorityOrder;
  if (a.tierId != null && b.tierId != null && a.tierId !== b.tierId) {
    const tierOrder = (a.groupLabel ?? a.label).localeCompare(
      b.groupLabel ?? b.label,
    );
    if (tierOrder !== 0) return tierOrder;
    return a.tierId.localeCompare(b.tierId);
  }
  return a.order - b.order || a.label.localeCompare(b.label);
}

function valueAt(values: Map<string, DailyValue>, day: string): DailyValue {
  return (
    values.get(day) ?? {
      activeMemberships: 0,
      purchasedCapacity: 0,
      revenueCents: 0,
    }
  );
}

function addValues(target: DailyValue, value: DailyValue): void {
  target.activeMemberships += value.activeMemberships;
  target.purchasedCapacity += value.purchasedCapacity;
  target.revenueCents += value.revenueCents;
}

export function buildMembershipAnalyticsView({
  rows,
  tiers,
  breakdown,
  start,
  end,
  historyStart = start,
  comparisonDays = 0,
}: {
  rows: MembershipAllocationDailyRow[];
  tiers: MembershipAnalyticsTier[];
  breakdown: MembershipAnalyticsBreakdown;
  start: Date | string;
  end: Date | string;
  historyStart?: Date | string;
  comparisonDays?: number;
}): MembershipAnalyticsView {
  const startDay = dayKey(start);
  const endDay = dayKey(end);
  const historyStartDay = dayKey(historyStart);
  const startNumber = dayNumber(startDay);
  const endNumber = dayNumber(endDay);
  if (startNumber > endNumber) {
    throw Error("membership analytics start must not follow end");
  }
  if (!Number.isSafeInteger(comparisonDays) || comparisonDays < 0) {
    throw Error("membership analytics comparison must be whole days");
  }

  const tierMap = new Map(tiers.map((tier) => [tier.id, tier]));
  const categories = new Map<string, Category>();
  const valuesByCategory = new Map<string, Map<string, DailyValue>>();
  for (const row of rows) {
    const day = dayKey(row.day);
    const category = categoryForRow(row, breakdown, tierMap);
    categories.set(category.key, category);
    const values = valuesByCategory.get(category.key) ?? new Map();
    const value = values.get(day) ?? {
      activeMemberships: 0,
      purchasedCapacity: 0,
      revenueCents: 0,
    };
    value.activeMemberships += Number(row.active_memberships) || 0;
    value.purchasedCapacity += Number(row.purchased_capacity) || 0;
    value.revenueCents += Number(row.revenue_cents) || 0;
    values.set(day, value);
    valuesByCategory.set(category.key, values);
  }

  const days = Array.from({ length: endNumber - startNumber + 1 }, (_, index) =>
    dayFromNumber(startNumber + index),
  );
  const latestDay = endDay;
  const comparisonDay = shiftMembershipAnalyticsDay(latestDay, -comparisonDays);
  const comparisonAvailable =
    comparisonDays > 0 &&
    dayNumber(comparisonDay) >= dayNumber(historyStartDay);

  const series = [...categories.values()].sort(categorySort).map((category) => {
    const values = valuesByCategory.get(category.key) ?? new Map();
    return {
      ...category,
      current: days.map((displayDay) => ({
        displayDay,
        actualDay: displayDay,
        ...valueAt(values, displayDay),
      })),
      comparison:
        comparisonDays > 0
          ? days.map((displayDay) => {
              const actualDay = shiftMembershipAnalyticsDay(
                displayDay,
                -comparisonDays,
              );
              return {
                displayDay,
                actualDay,
                ...valueAt(values, actualDay),
              };
            })
          : [],
    };
  });

  const summary = series.map((item) => {
    const values = valuesByCategory.get(item.key) ?? new Map();
    const current = valueAt(values, latestDay);
    const comparison = valueAt(values, comparisonDay);
    return {
      key: item.key,
      label: item.label,
      ...(item.channel ? { channel: item.channel } : {}),
      activeMemberships: current.activeMemberships,
      comparisonActiveMemberships: comparison.activeMemberships,
      purchasedCapacity: current.purchasedCapacity,
      comparisonPurchasedCapacity: comparison.purchasedCapacity,
      revenueCents: current.revenueCents,
      comparisonRevenueCents: comparison.revenueCents,
    };
  });
  const total: MembershipAnalyticsSummaryRow = {
    key: "total",
    label: "Total",
    total: true,
    activeMemberships: 0,
    comparisonActiveMemberships: 0,
    purchasedCapacity: 0,
    comparisonPurchasedCapacity: 0,
    revenueCents: 0,
    comparisonRevenueCents: 0,
  };
  for (const row of summary) {
    total.activeMemberships += row.activeMemberships;
    total.comparisonActiveMemberships += row.comparisonActiveMemberships;
    total.purchasedCapacity += row.purchasedCapacity;
    total.comparisonPurchasedCapacity += row.comparisonPurchasedCapacity;
    total.revenueCents += row.revenueCents;
    total.comparisonRevenueCents += row.comparisonRevenueCents;
  }

  return {
    start: startDay,
    end: endDay,
    latestDay,
    comparisonAvailable,
    series,
    summary: [total, ...summary],
  };
}

export function totalMembershipAnalyticsPoints(
  series: MembershipAnalyticsSeries[],
  which: "current" | "comparison",
): MembershipAnalyticsPoint[] {
  const totals = new Map<string, MembershipAnalyticsPoint>();
  for (const item of series) {
    for (const point of item[which]) {
      const total = totals.get(point.displayDay) ?? {
        displayDay: point.displayDay,
        actualDay: point.actualDay,
        activeMemberships: 0,
        purchasedCapacity: 0,
        revenueCents: 0,
      };
      addValues(total, point);
      totals.set(point.displayDay, total);
    }
  }
  return [...totals.values()].sort((a, b) =>
    a.displayDay.localeCompare(b.displayDay),
  );
}
