/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { defineMessage } from "react-intl";

import { Loading } from "@cocalc/frontend/components";
import { labels } from "@cocalc/frontend/i18n";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { ManagedEgressHistoryButton } from "@cocalc/frontend/purchases/managed-egress-history";
import { formatManagedEgressCategory } from "@cocalc/frontend/purchases/managed-egress-recent-events";
import type {
  AccountUsageOverview,
  AccountUsageSummaryPressure,
} from "@cocalc/conat/hub/api/purchases";
import { humanSize } from "@cocalc/util/misc";
import { useMembershipSettingsData } from "./membership-settings-data";
import {
  extractLimit,
  formatResetAt,
  getProgressPercent,
  getProjectDefaultsItems,
  normalizeRecord,
} from "./membership-settings-format";
import type { SettingsPageDefinition } from "./settings-page";
import { getUsageLimitsItems } from "./usage-limit-items";
import { getUsageStatusAlerts } from "./usage-status-alerts";
import type { UsageStatusAlert } from "./usage-status-alerts";
import { getUsageStatusItems } from "./usage-status-items";
import { openAccountSettings } from "./settings-routing";
import { dispatchAccountUsageOverviewRefreshed } from "./membership-usage-events";
import { UsageMeterDashboard } from "./usage-meter-dashboard";

const { Paragraph, Text, Title } = Typography;

const GRID_COL_PROPS = {
  xs: 24,
  lg: 12,
  xxl: 8,
} as const;

const METER_ID_BY_LIMIT_KEY: Record<string, string> = {
  blob_account_count: "blob-count",
  blob_account_total_bytes: "blob-storage",
  cpu_5h_seconds: "managed-cpu-5h",
  cpu_7d_seconds: "managed-cpu-7d",
  credit_spend_limit_5h_usd: "dedicated-host-credit-5h",
  credit_spend_limit_7d_usd: "dedicated-host-credit-7d",
  egress_5h_bytes: "managed-egress-5h",
  egress_7d_bytes: "managed-egress-7d",
  max_projects: "projects-owned",
  prepaid_host_usage_limit_5h_usd: "dedicated-host-prepaid-5h",
  prepaid_host_usage_limit_7d_usd: "dedicated-host-prepaid-7d",
  rootfs_count: "rootfs-count",
  rootfs_total_storage_gb: "rootfs-storage",
  total_storage_hard_bytes: "project-storage-hard",
  total_storage_soft_bytes: "project-storage-soft",
};

type DescriptionItem = {
  key: string;
  label: string;
  value: ReactNode;
};

type DashboardCard = {
  content: ReactNode;
  key: string;
  title: string;
};

type InfoItem = DescriptionItem & {
  danger?: boolean;
  progress?: {
    caption: string;
    current: number;
    limit: number;
  };
};

type UsageOverviewState = {
  error: string;
  loading: boolean;
  overview: AccountUsageOverview | null;
};

export const USAGE_LIMITS_SETTINGS_PAGE = {
  component: UsageLimitsPage,
  description: defineMessage({
    id: "account.settings.overview.usage-limits",
    defaultMessage:
      "Check account usage, limits, reset windows, and near-limit warnings.",
  }),
  icon: "tachometer-alt",
  key: "usage-limits",
  label: labels.usage_limits,
} satisfies SettingsPageDefinition;

export function UsageLimitsPage() {
  return (
    <>
      <Paragraph type="secondary">
        These limits come from your current membership and license grants.{" "}
        <a
          onClick={(event) => {
            event.preventDefault();
            openAccountSettings({ page: "membership" });
          }}
        >
          Review membership details.
        </a>
      </Paragraph>
      <UsageLimitsSettingsContent />
    </>
  );
}

function renderManagedEgressBreakdown(
  label: string,
  breakdown?: Record<string, number>,
): ReactElement | null {
  if (!breakdown || Object.keys(breakdown).length === 0) {
    return null;
  }
  const entries = Object.entries(breakdown).filter(
    ([, value]) =>
      typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (entries.length === 0) return null;
  return renderInfoItems({
    items: [
      {
        key: label,
        label,
        value: (
          <Space wrap>
            {entries.map(([category, bytes]) => (
              <Tag key={category}>
                {formatManagedEgressCategory(category)}: {humanSize(bytes)}
              </Tag>
            ))}
          </Space>
        ),
      },
    ],
  });
}

function useAccountUsageOverview(
  account_id?: string,
  refreshToken = 0,
): UsageOverviewState {
  const [overview, setOverview] = useState<AccountUsageOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let canceled = false;
    async function load() {
      if (!account_id) {
        setOverview(null);
        setError("");
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result =
          await webapp_client.conat_client.hub.purchases.getAccountUsageOverview();
        if (!canceled) {
          setOverview(result);
          setError("");
          dispatchAccountUsageOverviewRefreshed(result);
        }
      } catch (err) {
        if (!canceled) {
          setOverview(null);
          setError(`${err}`);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [account_id, refreshToken]);

  return { error, loading, overview };
}

function formatUsagePercent(percent: number): string {
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function severityProgressStatus(
  severity?: AccountUsageSummaryPressure["severity"],
): "normal" | "exception" | "success" {
  if (severity === "over") return "exception";
  if (severity === "near") return "normal";
  return "success";
}

function UsagePressureCard({
  label,
  pressure,
}: {
  label: string;
  pressure?: AccountUsageSummaryPressure;
}): ReactElement {
  if (!pressure) {
    return (
      <Card size="small" title={label} style={{ height: "100%" }}>
        <Text type="secondary">No active limited usage yet.</Text>
      </Card>
    );
  }
  return (
    <Card size="small" title={label} style={{ height: "100%" }}>
      <Space vertical size="small" style={{ width: "100%" }}>
        <Progress
          aria-label={`${label}: ${formatUsagePercent(pressure.percent)} of limit used`}
          percent={Math.min(100, Math.max(0, pressure.percent))}
          status={severityProgressStatus(pressure.severity)}
        />
        <div>
          <Text strong>{pressure.limiting_meter_label ?? "Closest limit"}</Text>
          <br />
          <Text type="secondary">
            {formatUsagePercent(pressure.percent)} of limit used
          </Text>
        </div>
        {pressure.resets_at || pressure.reset_in ? (
          <Text type="secondary">
            Resets{" "}
            {pressure.resets_at ? formatResetAt(pressure.resets_at) : "later"}
            {pressure.reset_in ? ` · in ${pressure.reset_in}` : ""}
          </Text>
        ) : null}
      </Space>
    </Card>
  );
}

function UsagePressureSummary({
  overview,
}: {
  overview: AccountUsageOverview | null;
}): ReactElement | null {
  if (!overview) return null;
  const liveCapacity = overview.summary.live_capacity;
  const columnWidth = liveCapacity ? 6 : 8;
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12} xl={columnWidth}>
        <UsagePressureCard
          label="5-hour pressure"
          pressure={overview.summary.pressure_5h}
        />
      </Col>
      <Col xs={24} md={12} xl={columnWidth}>
        <UsagePressureCard
          label="7-day pressure"
          pressure={overview.summary.pressure_7d}
        />
      </Col>
      <Col xs={24} md={12} xl={columnWidth}>
        <UsagePressureCard
          label="Storage pressure"
          pressure={overview.summary.storage}
        />
      </Col>
      {liveCapacity ? (
        <Col xs={24} md={12} xl={columnWidth}>
          <UsagePressureCard label="Codex capacity" pressure={liveCapacity} />
        </Col>
      ) : null}
    </Row>
  );
}

function renderInfoItems({
  emptyLabel,
  emptyValue,
  items,
  layout = "horizontal",
}: {
  emptyLabel?: string;
  emptyValue?: string;
  items: InfoItem[];
  layout?: "horizontal" | "vertical";
}): ReactElement | null {
  if (items.length === 0) {
    if (!emptyLabel || !emptyValue) return null;
    return renderInfoItems({
      items: [
        {
          key: "empty",
          label: emptyLabel,
          value: <Text type="secondary">{emptyValue}</Text>,
        },
      ],
    });
  }
  return (
    <Descriptions colon size="small" column={1} layout={layout}>
      {items.map((item) => (
        <Descriptions.Item key={item.key} label={item.label}>
          <Space vertical size={0} style={{ width: "100%" }}>
            {item.danger ? <Text type="danger">{item.value}</Text> : item.value}
            {item.progress ? (
              <>
                <Progress
                  aria-label={`${item.label}: ${item.progress.caption}`}
                  percent={getProgressPercent(
                    item.progress.current,
                    item.progress.limit,
                  )}
                  showInfo={false}
                  size="small"
                  status={item.danger ? "exception" : "normal"}
                />
                <Text type="secondary">{item.progress.caption}</Text>
              </>
            ) : null}
          </Space>
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}

function renderDashboardGrid({
  cards,
  gutter,
  headerBackgroundColor,
}: {
  cards: DashboardCard[];
  gutter: [number, number];
  headerBackgroundColor: string;
}): ReactElement {
  return (
    <Row align="stretch" gutter={gutter}>
      {cards.map((card) => (
        <Col key={card.key} style={{ display: "flex" }} {...GRID_COL_PROPS}>
          <Card
            size="small"
            title={card.title}
            style={{ height: "100%", width: "100%" }}
            styles={{ header: { backgroundColor: headerBackgroundColor } }}
          >
            {card.content}
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function renderAlertsGrid({
  alerts,
  gutter,
}: {
  alerts: UsageStatusAlert[];
  gutter: [number, number];
}): ReactElement | null {
  if (alerts.length === 0) return null;
  return (
    <Row align="stretch" gutter={gutter}>
      {alerts.map((alert) => (
        <Col key={alert.key} style={{ display: "flex" }} {...GRID_COL_PROPS}>
          <Alert
            showIcon
            type={alert.type}
            title={alert.title}
            style={{ height: "100%", width: "100%" }}
          />
        </Col>
      ))}
    </Row>
  );
}

function UsageLimitsSettingsContent(): ReactElement | null {
  const { account_id, details, error, loading, membership, refresh } =
    useMembershipSettingsData();
  const [overviewRefreshToken, setOverviewRefreshToken] = useState(0);
  const {
    error: overviewError,
    loading: overviewLoading,
    overview,
  } = useAccountUsageOverview(account_id, overviewRefreshToken);
  const { token } = theme.useToken();

  if (!account_id) return null;
  if (loading) return <Loading />;
  if (error) return <Alert type="error" title={error} />;
  if (!membership) return null;

  const refreshUsage = () => {
    refresh();
    setOverviewRefreshToken((value) => value + 1);
  };

  const entitlements = normalizeRecord(membership.entitlements);
  const projectDefaults = normalizeRecord(entitlements.project_defaults);
  const aiLimits = normalizeRecord(entitlements.ai_limits);
  const usageLimits = normalizeRecord(
    membership.effective_limits ?? entitlements.usage_limits,
  );
  const projectDefaultsItems = getProjectDefaultsItems(projectDefaults);
  const usageLimitItems = getUsageLimitsItems(usageLimits);
  const usageStatusItems = getUsageStatusItems(
    details?.usage_status,
    usageLimits,
  );
  const usageStatusAlerts = getUsageStatusAlerts(details?.usage_status);
  const gridGutter: [number, number] = [token.margin, token.margin];
  const representedMeterIds = new Set(
    overview?.meters.map(({ id }) => id) ?? [],
  );
  const aiLimitItems: InfoItem[] = [
    {
      id: "ai-5h",
      key: "ai_units_5h",
      label: "AI 5-hour window",
      value: extractLimit(aiLimits, ["units_5h", "limit_5h"]),
    },
    {
      id: "ai-7d",
      key: "ai_units_7d",
      label: "AI 7-day window",
      value: extractLimit(aiLimits, ["units_7d", "limit_7d"]),
    },
  ]
    .filter(({ id, value }) => value != null && !representedMeterIds.has(id))
    .map(({ key, label, value }) => ({
      key,
      label,
      value: `${value?.toLocaleString()} units`,
    }));
  const supplementalLimitItems = usageLimitItems.filter(({ key }) => {
    const meterId = METER_ID_BY_LIMIT_KEY[key];
    return meterId == null || !representedMeterIds.has(meterId);
  });
  const sharedComputeLimitItems = supplementalLimitItems.filter(
    ({ key }) => key === "shared_compute_priority",
  );
  const additionalLimitItems = supplementalLimitItems.filter(
    ({ key }) => key !== "shared_compute_priority",
  );
  const runtimeEnvironmentItems = [
    ...sharedComputeLimitItems,
    ...projectDefaultsItems,
  ];

  const fallbackCards: DashboardCard[] = [
    {
      key: "fallback-usage",
      title: "Last available usage",
      content: renderInfoItems({
        emptyLabel: "Usage",
        emptyValue: "Unavailable",
        items: usageStatusItems,
      }),
    },
  ];

  const configurationCards: DashboardCard[] = [
    {
      key: "runtime-environment",
      title: "Runtime environment",
      content: renderInfoItems({
        emptyLabel: "Environment",
        emptyValue: "Not configured",
        items: runtimeEnvironmentItems,
      }),
    },
    ...([...additionalLimitItems, ...aiLimitItems].length > 0
      ? [
          {
            key: "additional-limits",
            title: "Additional limits",
            content: renderInfoItems({
              items: [...additionalLimitItems, ...aiLimitItems],
            }),
          },
        ]
      : []),
    {
      key: "network-details",
      title: "Network details",
      content: (
        <Space vertical size="small" style={{ width: "100%" }}>
          {renderManagedEgressBreakdown(
            "Managed egress by category (5 hours)",
            details?.usage_status?.managed_egress_categories_5h_bytes,
          )}
          {renderManagedEgressBreakdown(
            "Managed egress by category (7 days)",
            details?.usage_status?.managed_egress_categories_7d_bytes,
          )}
          <ManagedEgressHistoryButton
            buttonText="View network history"
            size="small"
          />
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Text type="secondary">
          Last checked{" "}
          {overview?.collected_at
            ? formatResetAt(overview.collected_at)
            : overviewLoading
              ? "now"
              : "unavailable"}
        </Text>
        <Button onClick={refreshUsage} loading={loading || overviewLoading}>
          Refresh usage
        </Button>
      </Space>
      {overviewError ? (
        <Alert
          type="warning"
          showIcon
          message="Current usage overview is unavailable"
          description={overviewError}
        />
      ) : null}
      {overview?.measurement_warnings?.length ? (
        <Alert
          type="warning"
          showIcon
          message="Some usage measurements are incomplete"
          description={
            <Space vertical size={0}>
              {overview.measurement_warnings.map((warning) => (
                <Text key={warning}>{warning}</Text>
              ))}
            </Space>
          }
        />
      ) : null}
      {renderAlertsGrid({ alerts: usageStatusAlerts, gutter: gridGutter })}
      {overview ? (
        <>
          <Title level={4} style={{ marginBottom: 0 }}>
            At a glance
          </Title>
          <UsagePressureSummary overview={overview} />
          <Title level={4} style={{ marginBottom: 0 }}>
            Usage by resource
          </Title>
          <UsageMeterDashboard meters={overview.meters} />
        </>
      ) : overviewLoading ? (
        <Card size="small">
          <Loading text="Loading current usage..." />
        </Card>
      ) : (
        <>
          <Title level={4} style={{ marginBottom: 0 }}>
            Available usage information
          </Title>
          {renderDashboardGrid({
            cards: fallbackCards,
            gutter: gridGutter,
            headerBackgroundColor: token.colorWarningBg,
          })}
        </>
      )}
      <Title level={4} style={{ marginBottom: 0 }}>
        Membership configuration
      </Title>
      {renderDashboardGrid({
        cards: configurationCards,
        gutter: gridGutter,
        headerBackgroundColor: token.colorInfoBg,
      })}
    </Space>
  );
}
