/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Popover, Space } from "antd";
import { stringify as csvStringify } from "csv-stringify/sync";

import type { SiteLicenseRevenueAnalyticsRow } from "@cocalc/conat/hub/api/commercial-orders";
import {
  MEMBERSHIP_ALLOCATION_DAILY_EXPORT_FORMAT,
  MEMBERSHIP_ALLOCATION_DAILY_EXPORT_VERSION,
  type MembershipAllocationChannel,
  type MembershipAllocationDailyExport,
  type MembershipAllocationDailyExportTier,
  type MembershipAllocationDailyRow,
  type ComputeRevenueDailyRow,
  type ComputeRevenueProduct,
  type ComputeUsageDailyRow,
} from "@cocalc/conat/hub/api/purchases";
import { Icon } from "@cocalc/frontend/components/icon";

const CSV_COLUMNS = [
  "day",
  "channel",
  "membership_class",
  "billing_interval",
  "lifecycle",
  "previous_membership_class",
  "previous_billing_interval",
  "tier_change",
  "active_memberships",
  "purchased_capacity",
  "revenue_cents",
  "fact_count",
] as const;

const REVENUE_CSV_COLUMNS = [
  "record_type",
  "day",
  "channel",
  "membership_class",
  "billing_interval",
  "lifecycle",
  "previous_membership_class",
  "previous_billing_interval",
  "tier_change",
  "product",
  "provider",
  "cost_component",
  "measure",
  "active_memberships",
  "purchased_capacity",
  "running_unit_seconds",
  "distinct_running_units",
  "revenue_cents",
  "amount_cents",
  "source_count",
  "purchase_count",
  "fact_count",
] as const;

function dayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function rowKey(row: MembershipAllocationDailyExport["rows"][number]): string {
  return [
    row.day,
    row.channel,
    row.membership_class,
    row.billing_interval,
    row.lifecycle,
    row.previous_membership_class ?? "",
    row.previous_billing_interval ?? "",
    row.tier_change,
  ].join("\0");
}

export function buildMembershipAllocationDailyExport({
  rows,
  tiers,
  channels,
  startDay,
  endDay,
  exportedAt = new Date(),
}: {
  rows: MembershipAllocationDailyRow[];
  tiers: MembershipAllocationDailyExportTier[];
  channels: MembershipAllocationChannel[];
  startDay: string;
  endDay: string;
  exportedAt?: Date;
}): MembershipAllocationDailyExport {
  const selectedChannels = new Set(channels);
  const exportRows = rows
    .map((row) => ({
      ...row,
      day: dayKey(row.day),
      previous_membership_class: row.previous_membership_class ?? null,
      previous_billing_interval: row.previous_billing_interval ?? null,
    }))
    .filter(
      ({ day, channel }) =>
        selectedChannels.has(channel) && day >= startDay && day <= endDay,
    )
    .sort((left, right) => rowKey(left).localeCompare(rowKey(right)));

  return {
    format: MEMBERSHIP_ALLOCATION_DAILY_EXPORT_FORMAT,
    version: MEMBERSHIP_ALLOCATION_DAILY_EXPORT_VERSION,
    exported_at: exportedAt.toISOString(),
    range: { start_day: startDay, end_day: endDay },
    channels: [...channels],
    tiers: tiers.map(({ id, label, priority }) => ({ id, label, priority })),
    rows: exportRows,
  };
}

export function membershipAllocationDailyExportCsv(
  payload: MembershipAllocationDailyExport,
): string {
  return csvStringify(payload.rows, {
    header: true,
    columns: [...CSV_COLUMNS],
  });
}

function downloadText({
  contents,
  filename,
  type,
}: {
  contents: string;
  filename: string;
  type: string;
}): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface RevenueAnalyticsDailyExport {
  format: "cocalc-revenue-analytics-daily";
  version: 2;
  exported_at: string;
  range: { start_day: string; end_day: string };
  membership_channels: MembershipAllocationChannel[];
  compute_products: ComputeRevenueProduct[];
  tiers: MembershipAllocationDailyExportTier[];
  membership_rows: MembershipAllocationDailyExport["rows"];
  compute_revenue_rows: Array<
    Omit<ComputeRevenueDailyRow, "day"> & { day: string }
  >;
  compute_usage_rows: Array<
    Omit<ComputeUsageDailyRow, "day"> & { day: string }
  >;
  site_license_revenue_rows: Array<
    Omit<SiteLicenseRevenueAnalyticsRow, "day"> & { day: string }
  >;
}

export function buildRevenueAnalyticsDailyExport({
  membershipRows,
  computeRevenueRows,
  computeUsageRows,
  siteLicenseRevenueRows,
  membershipChannels,
  computeProducts,
  tiers,
  startDay,
  endDay,
  exportedAt = new Date(),
}: {
  membershipRows: MembershipAllocationDailyRow[];
  computeRevenueRows: ComputeRevenueDailyRow[];
  computeUsageRows: ComputeUsageDailyRow[];
  siteLicenseRevenueRows: SiteLicenseRevenueAnalyticsRow[];
  membershipChannels: MembershipAllocationChannel[];
  computeProducts: ComputeRevenueProduct[];
  tiers: MembershipAllocationDailyExportTier[];
  startDay: string;
  endDay: string;
  exportedAt?: Date;
}): RevenueAnalyticsDailyExport {
  const channelSet = new Set(membershipChannels);
  const productSet = new Set(computeProducts);
  const inRange = (day: Date | string) => {
    const key = dayKey(day);
    return key >= startDay && key <= endDay;
  };
  return {
    format: "cocalc-revenue-analytics-daily",
    version: 2,
    exported_at: exportedAt.toISOString(),
    range: { start_day: startDay, end_day: endDay },
    membership_channels: [...membershipChannels],
    compute_products: [...computeProducts],
    tiers: tiers.map(({ id, label, priority }) => ({ id, label, priority })),
    membership_rows: membershipRows
      .filter(({ day, channel }) => channelSet.has(channel) && inRange(day))
      .map((row) => ({ ...row, day: dayKey(row.day) })),
    compute_revenue_rows: computeRevenueRows
      .filter(({ day, product }) => productSet.has(product) && inRange(day))
      .map((row) => ({ ...row, day: dayKey(row.day) })),
    compute_usage_rows: computeUsageRows
      .filter(({ day, product }) => productSet.has(product) && inRange(day))
      .map((row) => ({ ...row, day: dayKey(row.day) })),
    site_license_revenue_rows: siteLicenseRevenueRows
      .filter(({ day }) => inRange(day))
      .map((row) => ({ ...row, day: dayKey(row.day) })),
  };
}

export function revenueAnalyticsDailyExportCsv(
  payload: RevenueAnalyticsDailyExport,
): string {
  const rows: Array<Record<string, string | number | null>> = [];
  for (const row of payload.membership_rows) {
    rows.push({
      record_type: "membership",
      ...row,
      previous_membership_class: row.previous_membership_class ?? null,
      previous_billing_interval: row.previous_billing_interval ?? null,
    });
  }
  for (const row of payload.compute_revenue_rows) {
    rows.push({ record_type: "compute-revenue", ...row });
  }
  for (const row of payload.compute_usage_rows) {
    rows.push({ record_type: "compute-usage", ...row });
  }
  for (const row of payload.site_license_revenue_rows) {
    rows.push({ record_type: "site-license-accounting", ...row });
  }
  return csvStringify(rows, {
    header: true,
    columns: [...REVENUE_CSV_COLUMNS],
  });
}

export function MembershipAnalyticsExport({
  payload,
  disabled = false,
}: {
  payload?: MembershipAllocationDailyExport;
  disabled?: boolean;
}) {
  const filename = payload
    ? `cocalc-membership-daily-${payload.range.start_day}-to-${payload.range.end_day}`
    : "cocalc-membership-daily";

  return (
    <Popover
      placement="bottom"
      trigger="click"
      content={
        <Space vertical size={0}>
          <Button
            type="link"
            disabled={!payload}
            onClick={() => {
              if (!payload) return;
              downloadText({
                contents: membershipAllocationDailyExportCsv(payload),
                filename: `${filename}.csv`,
                type: "text/csv;charset=utf-8",
              });
            }}
          >
            <Icon name="csv" /> Daily buckets (CSV)
          </Button>
          <Button
            type="link"
            disabled={!payload}
            onClick={() => {
              if (!payload) return;
              downloadText({
                contents: JSON.stringify(payload, null, 2),
                filename: `${filename}.json`,
                type: "application/json;charset=utf-8",
              });
            }}
          >
            <Icon name="js-square" /> Daily buckets (JSON)
          </Button>
        </Space>
      }
    >
      <Button disabled={disabled || !payload}>
        <Icon name="cloud-download" /> Export
      </Button>
    </Popover>
  );
}

export function RevenueAnalyticsExport({
  payload,
  disabled = false,
}: {
  payload?: RevenueAnalyticsDailyExport;
  disabled?: boolean;
}) {
  const filename = payload
    ? `cocalc-revenue-daily-${payload.range.start_day}-to-${payload.range.end_day}`
    : "cocalc-revenue-daily";
  return (
    <Popover
      placement="bottom"
      trigger="click"
      content={
        <Space vertical size={0}>
          <Button
            type="link"
            disabled={!payload}
            onClick={() => {
              if (!payload) return;
              downloadText({
                contents: revenueAnalyticsDailyExportCsv(payload),
                filename: `${filename}.csv`,
                type: "text/csv;charset=utf-8",
              });
            }}
          >
            <Icon name="csv" /> Daily buckets (CSV)
          </Button>
          <Button
            type="link"
            disabled={!payload}
            onClick={() => {
              if (!payload) return;
              downloadText({
                contents: JSON.stringify(payload, null, 2),
                filename: `${filename}.json`,
                type: "application/json;charset=utf-8",
              });
            }}
          >
            <Icon name="js-square" /> Daily buckets (JSON)
          </Button>
        </Space>
      }
    >
      <Button disabled={disabled || !payload}>
        <Icon name="cloud-download" /> Export
      </Button>
    </Popover>
  );
}
