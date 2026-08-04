/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Flex, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import type { ComputeVm } from "@cocalc/conat/hub/api/compute";
import { Icon } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";

const { Paragraph, Text, Title } = Typography;

function shortProjectId(projectId: string): string {
  return projectId.slice(0, 8);
}

function expiresIn(value: string | Date): string {
  const milliseconds = new Date(value).valueOf() - Date.now();
  if (milliseconds <= 0) return "expired";
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function hourlyPrice(vm: ComputeVm): string {
  const price =
    vm.effective_pricing_model === "spot"
      ? vm.spot_hourly_price
      : vm.on_demand_hourly_price;
  return `$${Number(price).toFixed(3)}/h`;
}

const columns: ColumnsType<ComputeVm> = [
  {
    title: "Name",
    dataIndex: "name",
    fixed: "left",
    render: (name: string, vm) => (
      <div>
        <Text strong>{name}</Text>
        <br />
        <Text copyable={{ text: vm.id }} type="secondary">
          {vm.id.slice(0, 8)}
        </Text>
      </div>
    ),
  },
  {
    title: "State",
    dataIndex: "state",
    render: (state: string) => (
      <Tag color={state === "ready" ? "green" : undefined}>{state}</Tag>
    ),
  },
  { title: "Machine", dataIndex: "machine_type" },
  {
    title: "Pricing",
    render: (_, vm) => (
      <span>
        {vm.effective_pricing_model} · {hourlyPrice(vm)}
      </span>
    ),
  },
  { title: "Zone", dataIndex: "zone" },
  {
    title: "IP",
    dataIndex: "public_ip",
    render: (ip?: string | null) =>
      ip ? (
        <Text copyable={{ text: ip }}>{ip}</Text>
      ) : (
        <Text type="secondary">-</Text>
      ),
  },
  {
    title: "Expires",
    dataIndex: "expires_at",
    render: (expiresAt: string | Date) => (
      <Text title={new Date(expiresAt).toLocaleString()}>
        {expiresIn(expiresAt)}
      </Text>
    ),
  },
  {
    title: "Connect",
    render: (_, vm) => (
      <Text code copyable={{ text: `cocalc vm ssh ${vm.name}` }}>
        cocalc vm ssh {vm.name}
      </Text>
    ),
  },
];

export function ProjectComputeVms({
  project_id,
  compact = false,
  isVisible = true,
}: {
  project_id: string;
  compact?: boolean;
  isVisible?: boolean;
}) {
  const [rows, setRows] = useState<ComputeVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = async () => {
    setLoading(true);
    try {
      const vms = await webapp_client.conat_client.hub.compute.listVms({
        project_id,
      });
      setRows(vms);
      setError(undefined);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isVisible) return;
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [isVisible, project_id]);

  return (
    <div
      style={{
        boxSizing: "border-box",
        margin: compact ? undefined : "0 auto",
        maxWidth: compact ? undefined : 1180,
        padding: compact ? 12 : 24,
        width: "100%",
      }}
    >
      <Flex align="center" justify="space-between" gap={12} wrap>
        <div>
          <Title level={compact ? 5 : 3} style={{ marginBottom: 0 }}>
            <Icon name="server" /> Virtual machines
          </Title>
          {!compact && (
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              Short-lived machines owned by you and attached to project{" "}
              <Text code>{shortProjectId(project_id)}</Text>.
            </Paragraph>
          )}
        </div>
        <Button icon={<Icon name="refresh" />} loading={loading} onClick={load}>
          Refresh
        </Button>
      </Flex>
      {error && (
        <Alert
          showIcon
          type="warning"
          message="VM inventory is unavailable"
          description={error}
          style={{ marginBottom: 12 }}
        />
      )}
      <Table<ComputeVm>
        columns={columns}
        dataSource={rows}
        loading={loading && rows.length === 0}
        locale={{
          emptyText: "No virtual machines are attached to this project.",
        }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 900 }}
        size="small"
      />
      <Paragraph type="secondary" style={{ marginTop: 12 }}>
        Create and manage machines with <Text code>cocalc vm</Text>. Persistent
        volumes mounted at <Text code>/work</Text> survive VM deletion.
      </Paragraph>
    </div>
  );
}
