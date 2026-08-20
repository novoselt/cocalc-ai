/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Popover, Space } from "antd";
import { stringify as csvStringify } from "csv-stringify/sync";

import {
  MEMBERSHIP_ALLOCATION_DAILY_EXPORT_FORMAT,
  MEMBERSHIP_ALLOCATION_DAILY_EXPORT_VERSION,
  type MembershipAllocationChannel,
  type MembershipAllocationDailyExport,
  type MembershipAllocationDailyExportTier,
  type MembershipAllocationDailyRow,
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
