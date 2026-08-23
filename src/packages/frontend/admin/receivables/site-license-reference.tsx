/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Card, Flex, Select, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import type { SiteLicenseOverview } from "@cocalc/conat/hub/api/purchases";
import { listSiteLicenseOverviews } from "@cocalc/frontend/purchases/api";
import { formatDate } from "./shared";

const { Text } = Typography;

function useSiteLicenseCatalog() {
  const [overviews, setOverviews] = useState<SiteLicenseOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void listSiteLicenseOverviews({ admin: true })
      .then((value) => {
        if (!cancelled) setOverviews(value);
      })
      .catch((err) => {
        if (!cancelled) setError(`${err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { error, loading, overviews };
}

function siteLicenseSearchText(overview: SiteLicenseOverview): string {
  const license = overview.site_license;
  return [
    license.id,
    license.name,
    license.organization_name,
    ...license.allowed_domains,
  ]
    .join(" ")
    .toLowerCase();
}

function SiteLicenseLabel({ overview }: { overview: SiteLicenseOverview }) {
  const license = overview.site_license;
  return (
    <Flex vertical>
      <Text strong>{license.name}</Text>
      <Text type="secondary">
        {license.organization_name}
        {license.allowed_domains.length
          ? ` · ${license.allowed_domains.join(", ")}`
          : ""}
      </Text>
    </Flex>
  );
}

export function SiteLicenseSelector({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange?: (value?: string) => void;
  value?: string;
}) {
  const { error, loading, overviews } = useSiteLicenseCatalog();
  const options = overviews.map((overview) => ({
    label: <SiteLicenseLabel overview={overview} />,
    searchText: siteLicenseSearchText(overview),
    value: overview.site_license.id,
  }));

  return (
    <Flex vertical gap="small">
      <Select
        allowClear
        disabled={disabled}
        filterOption={(input, option) =>
          `${option?.searchText ?? ""}`.includes(input.trim().toLowerCase())
        }
        loading={loading}
        notFoundContent={loading ? <Spin size="small" /> : "No license found"}
        onChange={onChange}
        options={options}
        optionLabelProp="label"
        placeholder="Search existing site licenses"
        showSearch
        style={{ width: "100%" }}
        value={value || undefined}
      />
      {error ? (
        <Text type="danger">
          Existing licenses could not be loaded. Retry by reopening this form.
        </Text>
      ) : null}
    </Flex>
  );
}

function SiteLicenseBox({ overview }: { overview: SiteLicenseOverview }) {
  const license = overview.site_license;
  const totalSeats = overview.pools.reduce(
    (sum, pool) => sum + (pool.seat_count ?? 0),
    0,
  );
  return (
    <Card size="small" styles={{ body: { padding: 12 } }}>
      <Flex vertical gap="small">
        <div>
          <Text strong>{license.name}</Text>
          <br />
          <Text type="secondary">{license.organization_name}</Text>
        </div>
        {license.allowed_domains.length ? (
          <Flex gap={4} wrap>
            {license.allowed_domains.map((domain) => (
              <Tag key={domain}>{domain}</Tag>
            ))}
          </Flex>
        ) : null}
        <Text>
          {totalSeats} seats across {overview.pools.length} pool
          {overview.pools.length === 1 ? "" : "s"}
        </Text>
        <Text type="secondary">
          {formatDate(license.starts_at?.toString())} through{" "}
          {formatDate(license.expires_at?.toString())}
        </Text>
        <details>
          <summary>License diagnostics</summary>
          <Text copyable={{ text: license.id }}>{license.id}</Text>
        </details>
      </Flex>
    </Card>
  );
}

export function SiteLicenseReference({
  emptyLabel = "Not linked",
  siteLicenseId,
}: {
  emptyLabel?: string;
  siteLicenseId?: string | null;
}) {
  const { error, loading, overviews } = useSiteLicenseCatalog();
  if (!siteLicenseId) return <>{emptyLabel}</>;
  if (loading) return <Spin size="small" />;
  const overview = overviews.find(
    ({ site_license }) => site_license.id === siteLicenseId,
  );
  if (overview) return <SiteLicenseBox overview={overview} />;
  return (
    <Alert
      showIcon
      type="warning"
      title="Linked site license is unavailable"
      description={
        <details>
          <summary>{error ? "Lookup failed" : "License diagnostics"}</summary>
          <Text copyable={{ text: siteLicenseId }}>{siteLicenseId}</Text>
        </details>
      }
    />
  );
}
