/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Card,
  Col,
  Divider,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import type { ReactElement } from "react";

import type {
  AccountUsageMeter,
  AccountUsageMeterCategory,
  AccountUsageMeterUnit,
} from "@cocalc/conat/hub/api/purchases";
import { currency, humanSize } from "@cocalc/util/misc";
import { formatResetAt } from "./membership-settings-format";

const { Paragraph, Text } = Typography;

type UsageMeterGroupDefinition = {
  categories: AccountUsageMeterCategory[];
  key: string;
  title: string;
};

export type UsageMeterGroup = {
  key: string;
  meters: AccountUsageMeter[];
  title: string;
};

const USAGE_METER_GROUPS: UsageMeterGroupDefinition[] = [
  {
    key: "ai-compute",
    title: "AI and compute",
    categories: ["ai", "compute", "codex"],
  },
  {
    key: "network",
    title: "Network transfer",
    categories: ["network"],
  },
  {
    key: "projects-storage",
    title: "Projects and storage",
    categories: ["projects", "storage", "rootfs", "blob"],
  },
  {
    key: "spending",
    title: "Dedicated host spending",
    categories: ["spend"],
  },
  {
    key: "collaboration",
    title: "Collaboration",
    categories: ["collaboration"],
  },
];

function finiteNumber(value?: number): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function formatCpuSeconds(seconds: number): string {
  const hours = Math.max(0, seconds) / 3600;
  const maximumFractionDigits = hours < 1 ? 3 : hours < 100 ? 2 : 1;
  const value = hours.toLocaleString(undefined, {
    maximumFractionDigits,
  });
  return `${value} CPU-${hours === 1 ? "hour" : "hours"}`;
}

export function formatUsageMeterValue(
  value: number,
  unit: AccountUsageMeterUnit,
): string {
  switch (unit) {
    case "bytes":
      return humanSize(value);
    case "seconds":
      return formatCpuSeconds(value);
    case "usd":
      return currency(value);
    case "count":
    case "units":
      return formatNumber(value);
  }
}

export function groupUsageMeters(
  meters: AccountUsageMeter[],
): UsageMeterGroup[] {
  const assigned = new Set<AccountUsageMeter>();
  const groups = USAGE_METER_GROUPS.map((definition) => {
    const groupedMeters = meters.filter((meter) =>
      definition.categories.includes(meter.category),
    );
    groupedMeters.forEach((meter) => assigned.add(meter));
    return {
      key: definition.key,
      meters: groupedMeters,
      title: definition.title,
    };
  }).filter(({ meters: groupedMeters }) => groupedMeters.length > 0);
  const remaining = meters.filter((meter) => !assigned.has(meter));
  if (remaining.length > 0) {
    groups.push({
      key: "other",
      meters: remaining,
      title: "Other usage",
    });
  }
  return groups;
}

function formatWindow(window: AccountUsageMeter["window"]): string | undefined {
  if (window === "5h") return "5 hours";
  if (window === "7d") return "7 days";
  return;
}

function usageText(meter: AccountUsageMeter): string {
  const used = finiteNumber(meter.used)
    ? formatUsageMeterValue(meter.used, meter.unit)
    : undefined;
  const limit = finiteNumber(meter.limit)
    ? formatUsageMeterValue(meter.limit, meter.unit)
    : undefined;
  if (finiteNumber(meter.limit) && meter.limit <= 0) {
    if (finiteNumber(meter.used) && meter.used > 0) {
      return `${used} used · no allowance`;
    }
    return "Not included";
  }
  if (used && limit) return `${used} of ${limit}`;
  if (used) return `${used} used`;
  if (limit) return `${limit} limit`;
  return "Measurement unavailable";
}

function resetText(meter: AccountUsageMeter): string | undefined {
  const resetAt = formatResetAt(meter.resets_at ?? meter.reset_at);
  if (resetAt && meter.reset_in) {
    return `Resets ${resetAt} · in ${meter.reset_in}`;
  }
  if (resetAt) return `Resets ${resetAt}`;
  if (meter.reset_in) return `Resets in ${meter.reset_in}`;
  return;
}

function MeterStatus({ meter }: { meter: AccountUsageMeter }) {
  if (meter.severity === "over") {
    return <Tag color="error">Limit reached</Tag>;
  }
  if (meter.severity === "near") {
    return <Tag color="warning">Near limit</Tag>;
  }
  return null;
}

function UsageMeterRow({ meter }: { meter: AccountUsageMeter }): ReactElement {
  const window = formatWindow(meter.window);
  const reset = resetText(meter);
  const percent = finiteNumber(meter.percent)
    ? Math.max(0, Math.min(100, meter.percent))
    : undefined;
  const remaining = finiteNumber(meter.remaining)
    ? meter.remaining < 0
      ? `Over by ${formatUsageMeterValue(-meter.remaining, meter.unit)}`
      : `${formatUsageMeterValue(meter.remaining, meter.unit)} remaining`
    : undefined;

  return (
    <Space orientation="vertical" size={4} style={{ width: "100%" }}>
      <Space
        align="start"
        style={{ justifyContent: "space-between", width: "100%" }}
        wrap
      >
        <Space size="small" wrap>
          <Text strong>{meter.label}</Text>
          {window ? <Tag>{window}</Tag> : null}
          <MeterStatus meter={meter} />
        </Space>
        <Text strong>{usageText(meter)}</Text>
      </Space>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {meter.help}
      </Paragraph>
      {percent != null ? (
        <Progress
          percent={percent}
          showInfo={false}
          size="small"
          status={meter.severity === "over" ? "exception" : "normal"}
        />
      ) : null}
      {remaining || reset ? (
        <Space size="small" separator={<Text type="secondary">·</Text>} wrap>
          {remaining ? <Text type="secondary">{remaining}</Text> : null}
          {reset ? <Text type="secondary">{reset}</Text> : null}
        </Space>
      ) : null}
      {meter.severity === "over" && meter.action_when_over ? (
        <Text type="danger">{meter.action_when_over}</Text>
      ) : null}
    </Space>
  );
}

function UsageMeterGroupCard({
  group,
}: {
  group: UsageMeterGroup;
}): ReactElement {
  return (
    <Card
      size="small"
      title={group.title}
      style={{ height: "100%", width: "100%" }}
    >
      {group.meters.map((meter, index) => (
        <div key={meter.id}>
          {index > 0 ? <Divider style={{ margin: "14px 0" }} /> : null}
          <UsageMeterRow meter={meter} />
        </div>
      ))}
    </Card>
  );
}

export function UsageMeterDashboard({
  meters,
}: {
  meters: AccountUsageMeter[];
}): ReactElement {
  const groups = groupUsageMeters(meters);
  if (groups.length === 0) {
    return (
      <Card size="small">
        <Text type="secondary">No metered usage is currently available.</Text>
      </Card>
    );
  }
  return (
    <Row gutter={[16, 16]} align="stretch">
      {groups.map((group) => (
        <Col key={group.key} xs={24} xl={12} style={{ display: "flex" }}>
          <UsageMeterGroupCard group={group} />
        </Col>
      ))}
    </Row>
  );
}
