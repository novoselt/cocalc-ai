/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Button, Card, Space, Spin, Typography } from "antd";

import {
  type MembershipTierLike,
  useMembershipTiers,
} from "@cocalc/frontend/account/membership-tiers";
import {
  type BillingInterval,
  membershipPriceValue,
} from "@cocalc/frontend/account/membership-pricing-chooser";
import { sortMembershipTiersByDisplayOrder } from "@cocalc/util/membership-tier-order";
import { currency } from "@cocalc/util/misc";

const { Text, Title } = Typography;

export interface StorageUpgradeContext {
  used: number;
  soft_limit?: number;
  hard_limit?: number;
}

export interface AccountStorageUpgradeOption {
  id: string;
  label: string;
  soft_limit?: number;
  hard_limit?: number;
  project_disk_quota_mb?: number;
  price_monthly?: number;
  price_yearly?: number;
  annual_savings_percent?: number;
}

export function formatDecimalBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = Number.isInteger(value) || value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function getTierNumber(value: unknown): number | undefined {
  if (value == null || value === "") return;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? numberValue
    : undefined;
}

function annualSavingsPercent({
  price_monthly,
  price_yearly,
}: {
  price_monthly?: number;
  price_yearly?: number;
}): number | undefined {
  if (
    price_monthly == null ||
    price_yearly == null ||
    price_monthly <= 0 ||
    price_yearly <= 0 ||
    price_yearly >= price_monthly * 12
  ) {
    return;
  }
  return Math.round((1 - price_yearly / (price_monthly * 12)) * 100);
}

export function getAccountStorageUpgradeOptions(
  context: StorageUpgradeContext,
  tiers: readonly MembershipTierLike[],
): AccountStorageUpgradeOption[] {
  return sortMembershipTiersByDisplayOrder(
    tiers.filter((tier) => tier.store_visible && !tier.disabled),
  ).flatMap((tier) => {
    const price_monthly = membershipPriceValue(tier.price_monthly);
    const price_yearly = membershipPriceValue(tier.price_yearly);
    if (!price_monthly && !price_yearly) return [];

    const usageLimits = tier.usage_limits ?? {};
    const projectDefaults = tier.project_defaults ?? {};
    const soft_limit = getTierNumber(usageLimits.total_storage_soft_bytes);
    const hard_limit = getTierNumber(usageLimits.total_storage_hard_bytes);
    const preservesSoftCap =
      context.soft_limit == null ||
      (soft_limit != null && soft_limit >= context.soft_limit);
    const preservesHardCap =
      context.hard_limit == null ||
      (hard_limit != null && hard_limit >= context.hard_limit);
    const raisesSoftCap =
      soft_limit != null && soft_limit > (context.soft_limit ?? 0);
    const raisesHardCap =
      hard_limit != null && hard_limit > (context.hard_limit ?? 0);
    if (
      !preservesSoftCap ||
      !preservesHardCap ||
      (!raisesSoftCap && !raisesHardCap)
    ) {
      return [];
    }

    const project_disk_quota_mb = getTierNumber(projectDefaults.disk_quota);
    return [
      {
        id: tier.id,
        label: tier.label ?? tier.id,
        soft_limit,
        hard_limit,
        project_disk_quota_mb,
        price_monthly,
        price_yearly,
        annual_savings_percent: annualSavingsPercent({
          price_monthly,
          price_yearly,
        }),
      },
    ];
  });
}

function formatPrice(value: number): string {
  return Number.isInteger(value) ? currency(value, 0) : currency(value);
}

function storageHeadroom(limit: number, used: number, label: string): string {
  const difference = limit - used;
  if (difference > 0) {
    return `${formatDecimalBytes(difference)} before the ${label}`;
  }
  if (difference < 0) {
    return `${formatDecimalBytes(-difference)} over the ${label}`;
  }
  return `at the ${label}`;
}

function annualPriceDescription(
  option: AccountStorageUpgradeOption,
): string | undefined {
  if (option.price_yearly == null || option.price_yearly <= 0) return;
  const parts = [
    `${formatPrice(option.price_yearly)}/year`,
    `${formatPrice(option.price_yearly / 12)}/month equivalent`,
  ];
  if (option.annual_savings_percent != null) {
    parts.push(`save ${option.annual_savings_percent}% versus monthly`);
  }
  return parts.join("; ");
}

export function AccountStorageUpgradeOptions({
  context,
  onSelect,
  tiers,
}: {
  context: StorageUpgradeContext;
  onSelect: (tierId: string, interval: BillingInterval) => void;
  tiers: readonly MembershipTierLike[];
}) {
  const options = getAccountStorageUpgradeOptions(context, tiers);
  if (options.length === 0) {
    return (
      <Text type="secondary">
        Your current membership already provides at least as much total account
        storage as the paid personal tiers currently available. Open membership
        details to review your limits.
      </Text>
    );
  }

  return (
    <section aria-labelledby="account-storage-upgrade-heading">
      <Title
        id="account-storage-upgrade-heading"
        level={5}
        style={{ marginBottom: "4px" }}
      >
        How upgrading helps
      </Title>
      <Text type="secondary">
        These paid personal memberships increase your account storage limits.
        The estimates below use your current measured usage of{" "}
        {formatDecimalBytes(context.used)}.
      </Text>
      <div
        style={{
          display: "grid",
          gap: "12px",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
          marginTop: "10px",
        }}
      >
        {options.map((option) => {
          const headroom = [
            option.soft_limit == null
              ? undefined
              : storageHeadroom(option.soft_limit, context.used, "soft cap"),
            option.hard_limit == null
              ? undefined
              : storageHeadroom(option.hard_limit, context.used, "hard cap"),
          ].filter((value): value is string => value != null);
          const annualPrice = annualPriceDescription(option);
          return (
            <article
              aria-label={`${option.label} storage upgrade`}
              key={option.id}
            >
              <Card
                size="small"
                title={option.label}
                style={{ height: "100%" }}
              >
                <Space vertical size="small" style={{ width: "100%" }}>
                  <Text>
                    <strong>Total account storage:</strong>{" "}
                    {option.soft_limit == null
                      ? "No soft cap listed"
                      : `${formatDecimalBytes(option.soft_limit)} soft cap`}
                    {option.hard_limit == null
                      ? ""
                      : ` / ${formatDecimalBytes(option.hard_limit)} hard cap`}
                  </Text>
                  {headroom.length > 0 ? (
                    <Text>
                      <strong>At your current usage:</strong>{" "}
                      {headroom.join("; ")}
                    </Text>
                  ) : null}
                  {option.project_disk_quota_mb != null ? (
                    <Text>
                      <strong>Each project:</strong> up to{" "}
                      {formatDecimalBytes(option.project_disk_quota_mb * 1e6)}
                    </Text>
                  ) : null}
                  {annualPrice != null ? (
                    <Text>
                      <strong>Annual billing:</strong> {annualPrice}
                    </Text>
                  ) : option.price_monthly != null ? (
                    <Text>
                      <strong>Monthly billing:</strong>{" "}
                      {formatPrice(option.price_monthly)}/month
                    </Text>
                  ) : null}
                  <Button
                    block
                    onClick={() =>
                      onSelect(
                        option.id,
                        option.price_yearly != null && option.price_yearly > 0
                          ? "year"
                          : "month",
                      )
                    }
                  >
                    Choose {option.label}
                  </Button>
                </Space>
              </Card>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function AccountStorageUpgradeOptionsLoader({
  context,
  onSelect,
}: {
  context: StorageUpgradeContext;
  onSelect: (tierId: string, interval: BillingInterval) => void;
}) {
  const { error, loading, tiers } = useMembershipTiers();
  if (loading) {
    return (
      <Space role="status" size="small">
        <Spin size="small" />
        <Text type="secondary">Loading storage upgrade options...</Text>
      </Space>
    );
  }
  if (error) {
    return (
      <Text type="secondary">
        Upgrade comparisons are temporarily unavailable. Open membership details
        to review the current plans.
      </Text>
    );
  }
  return (
    <AccountStorageUpgradeOptions
      context={context}
      onSelect={onSelect}
      tiers={tiers}
    />
  );
}
