/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import type {
  ComputeCatalog,
  ComputeProjectBudget,
  ComputeVolume,
  ComputeVm,
} from "@cocalc/conat/hub/api/compute";
import { useRedux } from "@cocalc/frontend/app-framework";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { CopyToClipBoard, Icon } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  COCALC_CLI_DOWNLOAD_URL,
  COCALC_CLI_INSTALL_COMMAND,
} from "@cocalc/util/consts/ui";
import { uuid } from "@cocalc/util/misc";
import {
  vmCreateCli,
  volumeCreateCli,
  type VmCreateCliValues,
  type VolumeCreateCliValues,
} from "./compute-vms-cli";

const { Paragraph, Text, Title } = Typography;
const COPYABLE_PROPS = {
  inputWidth: "100%",
  inputStyle: { minWidth: 0 },
  outerStyle: { width: "100%" },
  style: { marginTop: 6, width: "100%" },
} as const;

interface VmDraft extends VmCreateCliValues {
  ssh_public_key: string;
}

type VolumeDraft = VolumeCreateCliValues;

interface BudgetDraft {
  limit_usd: number;
  period: "week" | "month";
}

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

function sshKeyOptions(sshKeys: any) {
  const raw = sshKeys?.toJS?.() ?? sshKeys ?? {};
  return Object.entries(raw)
    .map(([fingerprint, value]: [string, any]) => ({
      label: value?.title || fingerprint,
      value: `${value?.value ?? ""}`.trim(),
    }))
    .filter(({ value }) => value);
}

function similarName(name: string, rows: ComputeVm[]): string {
  const names = new Set(rows.map((vm) => vm.name));
  const stem = `${name.slice(0, 26)}-copy`;
  if (!names.has(stem)) return stem;
  for (let index = 2; index < 100; index++) {
    const candidate = `${name.slice(0, 28 - `${index}`.length)}-${index}`;
    if (!names.has(candidate)) return candidate;
  }
  return `vm-${Date.now()}`.slice(0, 32);
}

function VmCreateModal({
  open,
  project_id,
  catalog,
  volumes,
  initial,
  sshKeys,
  saving,
  onCancel,
  onCreate,
}: {
  open: boolean;
  project_id: string;
  catalog: ComputeCatalog;
  volumes: ComputeVolume[];
  initial: VmDraft;
  sshKeys: Array<{ label: string; value: string }>;
  saving: boolean;
  onCancel: () => void;
  onCreate: (values: VmDraft) => Promise<void>;
}) {
  const [form] = Form.useForm<VmDraft>();
  const [draft, setDraft] = useState<Partial<VmDraft>>(initial);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initial);
    setDraft(initial);
  }, [form, initial, open]);

  const api = globalThis.location?.origin ?? "https://cocalc.ai";
  const availableVolumes = volumes.filter(
    (volume) =>
      volume.state === "ready" && volume.attachment_state === "detached",
  );

  return (
    <Modal
      open={open}
      title={initial.name ? `Create ${initial.name}` : "Create virtual machine"}
      okText="Create VM"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onCreate)}
      width={720}
    >
      <Form<VmDraft>
        form={form}
        layout="vertical"
        initialValues={initial}
        onValuesChange={(_, values) => setDraft(values)}
      >
        <Flex gap={12} wrap>
          <Form.Item
            name="name"
            label="Name"
            rules={[
              { required: true },
              {
                pattern: /^[a-z][a-z0-9-]{0,31}$/,
                message:
                  "Use at most 32 lowercase letters, digits, or hyphens.",
              },
            ]}
            style={{ flex: "1 1 220px" }}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="zone"
            label="Zone"
            rules={[{ required: true }]}
            style={{ flex: "1 1 220px" }}
          >
            <Input />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item
            name="machine_type"
            label="Machine"
            rules={[{ required: true }]}
            style={{ flex: "1 1 260px" }}
          >
            <Select
              options={catalog.machines.map((machine) => ({
                value: machine.machine_type,
                label: `${machine.machine_type} · ${machine.cpu} vCPU · ${machine.ram_gb} GB`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="boot_disk_gb"
            label="Boot disk (GB)"
            rules={[{ required: true }]}
            style={{ flex: "1 1 160px" }}
          >
            <InputNumber min={10} max={catalog.limits.max_boot_disk_gb} />
          </Form.Item>
          <Form.Item
            name="ttl_minutes"
            label="Delete after"
            rules={[{ required: true }]}
            style={{ flex: "1 1 160px" }}
          >
            <Select
              options={[
                { value: 30, label: "30 minutes" },
                { value: 60, label: "1 hour" },
                { value: 240, label: "4 hours" },
                { value: 480, label: "8 hours" },
                { value: 1440, label: "1 day" },
              ].filter(({ value }) => value <= catalog.limits.max_ttl_minutes)}
            />
          </Form.Item>
        </Flex>
        <Form.Item name="pricing_model" label="Capacity">
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio.Button value="spot">Spot · lower cost</Radio.Button>
            <Radio.Button value="on_demand">On demand</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {draft.pricing_model === "spot" && (
          <Form.Item name="allow_on_demand_fallback" valuePropName="checked">
            <Checkbox>
              Fall back temporarily to on-demand capacity when Spot is
              unavailable
            </Checkbox>
          </Form.Item>
        )}
        <Form.Item
          name="volume"
          label="Persistent /work volume"
          extra="Optional. Volumes survive VM deletion and can be attached to only one VM."
        >
          <Select
            allowClear
            placeholder="No persistent /work volume"
            options={availableVolumes.map((volume) => ({
              value: volume.name,
              label: `${volume.name} · ${volume.size_gb} GB · ${volume.zone}`,
            }))}
            onChange={(name) => {
              const volume = volumes.find((entry) => entry.name === name);
              if (volume) form.setFieldValue("zone", volume.zone);
            }}
          />
        </Form.Item>
        <Form.Item
          name="ssh_public_key"
          label="SSH public key"
          rules={[
            { required: true, message: "Select or paste an SSH public key." },
          ]}
          extra={
            sshKeys.length
              ? "Uses one of your account SSH keys."
              : "Add an account SSH key, or paste a public key here."
          }
        >
          {sshKeys.length ? (
            <Select options={sshKeys} />
          ) : (
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          )}
        </Form.Item>
      </Form>
      <Divider />
      <Text strong>Equivalent CLI command</Text>
      <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
        The CLI uses your local SSH key; all VM resource settings below match
        this form exactly.
      </Paragraph>
      <CopyToClipBoard
        value={vmCreateCli({ api, project_id, values: draft })}
        {...COPYABLE_PROPS}
      />
    </Modal>
  );
}

function VolumeCreateModal({
  open,
  project_id,
  catalog,
  saving,
  onCancel,
  onCreate,
}: {
  open: boolean;
  project_id: string;
  catalog: ComputeCatalog;
  saving: boolean;
  onCancel: () => void;
  onCreate: (values: VolumeDraft) => Promise<void>;
}) {
  const [form] = Form.useForm<VolumeDraft>();
  const initial = {
    name: "work-data",
    zone: catalog.defaults.zone,
    size_gb: 50,
  };
  const [draft, setDraft] = useState<Partial<VolumeDraft>>(initial);
  const api = globalThis.location?.origin ?? "https://cocalc.ai";

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initial);
    setDraft(initial);
  }, [form, open]);

  return (
    <Modal
      open={open}
      title="Create persistent /work volume"
      okText="Create volume"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onCreate)}
      width={650}
    >
      <Form<VolumeDraft>
        form={form}
        layout="vertical"
        initialValues={initial}
        onValuesChange={(_, values) => setDraft(values)}
      >
        <Flex gap={12} wrap>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true }, { pattern: /^[a-z][a-z0-9-]{0,31}$/ }]}
            style={{ flex: "1 1 180px" }}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="zone"
            label="Zone"
            rules={[{ required: true }]}
            style={{ flex: "1 1 180px" }}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="size_gb"
            label="Size (GB)"
            rules={[{ required: true }]}
            style={{ flex: "1 1 120px" }}
          >
            <InputNumber min={10} max={catalog.limits.max_volume_gb} />
          </Form.Item>
        </Flex>
      </Form>
      <Alert
        showIcon
        type="info"
        message="Volumes are retained when VMs are deleted. They can grow online but cannot shrink."
      />
      <Divider />
      <Text strong>Equivalent CLI command</Text>
      <CopyToClipBoard
        value={volumeCreateCli({ api, project_id, values: draft })}
        {...COPYABLE_PROPS}
      />
    </Modal>
  );
}

function BudgetModal({
  open,
  project_id,
  budget,
  saving,
  onCancel,
  onSave,
}: {
  open: boolean;
  project_id: string;
  budget?: ComputeProjectBudget | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (values: BudgetDraft) => Promise<void>;
}) {
  const [form] = Form.useForm<BudgetDraft>();
  const initial: BudgetDraft = {
    limit_usd: Number(budget?.limit_usd ?? 100),
    period: budget?.period ?? "month",
  };

  useEffect(() => {
    if (open) form.setFieldsValue(initial);
  }, [budget?.limit_usd, budget?.period, form, open]);

  return (
    <Modal
      open={open}
      title="Project compute budget"
      okText="Save budget"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSave)}
    >
      <Form<BudgetDraft> form={form} layout="vertical" initialValues={initial}>
        <Flex gap={12}>
          <Form.Item
            name="limit_usd"
            label="Spend limit (USD)"
            rules={[{ required: true }]}
            style={{ flex: 1 }}
          >
            <InputNumber min={1} precision={2} prefix="$" />
          </Form.Item>
          <Form.Item
            name="period"
            label="Resets"
            rules={[{ required: true }]}
            style={{ flex: 1 }}
          >
            <Select
              options={[
                { value: "week", label: "Every UTC week" },
                { value: "month", label: "Every UTC month" },
              ]}
            />
          </Form.Item>
        </Flex>
      </Form>
      <Alert
        showIcon
        type="warning"
        message="At the limit, running VMs are deleted. Persistent volumes are retained and continue to count toward future spend."
      />
      <Paragraph style={{ marginTop: 12 }}>
        CLI: <Text code>cocalc vm budget set --project {project_id}</Text>
      </Paragraph>
    </Modal>
  );
}

export function ProjectComputeVms({
  project_id,
  compact = false,
  isVisible = true,
}: {
  project_id: string;
  compact?: boolean;
  isVisible?: boolean;
}) {
  const accountSshKeys = useRedux("account", "ssh_keys");
  const sshKeys = sshKeyOptions(accountSshKeys);
  const [rows, setRows] = useState<ComputeVm[]>([]);
  const [volumes, setVolumes] = useState<ComputeVolume[]>([]);
  const [budget, setBudget] = useState<ComputeProjectBudget | null>();
  const [catalog, setCatalog] = useState<ComputeCatalog>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [volumeModalOpen, setVolumeModalOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [vmInitial, setVmInitial] = useState<VmDraft>();
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction({
    origin: "project managed compute",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [vms, projectVolumes, projectBudget, computeCatalog] =
        await Promise.all([
          webapp_client.conat_client.hub.compute.listVms({ project_id }),
          webapp_client.conat_client.hub.compute.listVolumes({ project_id }),
          webapp_client.conat_client.hub.compute.getProjectBudget({
            project_id,
          }),
          webapp_client.conat_client.hub.compute.getCatalog({}),
        ]);
      setRows(vms);
      setVolumes(projectVolumes);
      setBudget(projectBudget);
      setCatalog(computeCatalog);
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

  const defaultVm = (): VmDraft => ({
    name: "compute-vm",
    zone: catalog?.defaults.zone ?? "us-central1-a",
    machine_type: catalog?.defaults.machine_type ?? "e2-standard-2",
    pricing_model: "spot",
    allow_on_demand_fallback: false,
    ttl_minutes: catalog?.defaults.ttl_minutes ?? 30,
    boot_disk_gb: catalog?.defaults.boot_disk_gb ?? 20,
    ssh_public_key: sshKeys[0]?.value ?? "",
  });

  const openSimilar = (vm: ComputeVm) => {
    const ttlMinutes = Math.max(
      5,
      Math.round(
        (new Date(vm.expires_at).valueOf() -
          new Date(vm.created_at).valueOf()) /
          60_000,
      ),
    );
    setVmInitial({
      name: similarName(vm.name, rows),
      zone: vm.zone,
      machine_type: vm.machine_type,
      pricing_model: vm.desired_pricing_model,
      allow_on_demand_fallback: vm.allow_on_demand_fallback,
      ttl_minutes: Math.min(
        ttlMinutes,
        catalog?.limits.max_ttl_minutes ?? ttlMinutes,
      ),
      boot_disk_gb: vm.boot_disk_gb,
      ssh_public_key: sshKeys[0]?.value ?? "",
    });
    setVmModalOpen(true);
  };

  const createVm = async (values: VmDraft) => {
    setSaving(true);
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.createVm({
          project_id,
          name: values.name,
          zone: values.zone,
          machine_type: values.machine_type,
          pricing_model: values.pricing_model,
          allow_on_demand_fallback: values.allow_on_demand_fallback,
          ttl_minutes: values.ttl_minutes,
          boot_disk_gb: values.boot_disk_gb,
          volume: values.volume,
          ssh_public_key: values.ssh_public_key,
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setVmModalOpen(false);
      setNotice(`VM '${values.name}' requested.`);
      await load();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteVm = async (vm: ComputeVm) => {
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.deleteVm({
          id_or_name: vm.id,
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setNotice(`VM '${vm.name}' is being deleted.`);
      await load();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const createVolume = async (values: VolumeDraft) => {
    setSaving(true);
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.createVolume({
          project_id,
          name: values.name,
          zone: values.zone,
          size_gb: values.size_gb,
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setVolumeModalOpen(false);
      setNotice(`Volume '${values.name}' requested.`);
      await load();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteVolume = async (volume: ComputeVolume) => {
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.deleteVolume({
          id_or_name: volume.id,
          confirm_name: volume.name,
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setNotice(`Volume '${volume.name}' is being deleted.`);
      await load();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const saveBudget = async (values: BudgetDraft) => {
    setSaving(true);
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        const next =
          await webapp_client.conat_client.hub.compute.setProjectBudget({
            project_id,
            limit_usd: values.limit_usd.toFixed(2),
            period: values.period,
            browser_id: webapp_client.browser_id,
          });
        setBudget(next);
      });
      if (!completed) return;
      setBudgetModalOpen(false);
      setNotice("Project compute budget saved.");
      await load();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  const vmColumns: ColumnsType<ComputeVm> = [
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
      render: (state: string, vm) => (
        <div>
          <Tag color={state === "ready" ? "green" : undefined}>{state}</Tag>
          {state === "recovering" && (
            <Text type="secondary" style={{ whiteSpace: "nowrap" }}>
              Spot unavailable; retrying
            </Text>
          )}
          {state === "failed" && vm.error && (
            <Text type="danger" title={vm.error}>
              Provider error
            </Text>
          )}
        </div>
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
    {
      title: "Actions",
      fixed: "right",
      render: (_, vm) => (
        <Space size={4}>
          <Button size="small" onClick={() => openSimilar(vm)}>
            Create similar
          </Button>
          <Popconfirm
            title={`Delete ${vm.name}?`}
            description="The persistent boot disk is deleted. An attached /work volume is retained."
            okText="Delete VM"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteVm(vm)}
          >
            <Button size="small" danger disabled={vm.state === "deleting"}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const volumeColumns: ColumnsType<ComputeVolume> = [
    {
      title: "Name",
      dataIndex: "name",
      render: (name: string, volume) => (
        <div>
          <Text strong>{name}</Text>
          <br />
          <Text copyable={{ text: volume.id }} type="secondary">
            {volume.id.slice(0, 8)}
          </Text>
        </div>
      ),
    },
    {
      title: "State",
      dataIndex: "state",
      render: (state: string) => <Tag>{state}</Tag>,
    },
    { title: "Size", render: (_, volume) => `${volume.size_gb} GB` },
    { title: "Zone", dataIndex: "zone" },
    {
      title: "Attachment",
      render: (_, volume) => (
        <span>
          {volume.attachment_state}
          {volume.attached_vm_id
            ? ` · ${rows.find((vm) => vm.id === volume.attached_vm_id)?.name ?? volume.attached_vm_id.slice(0, 8)}`
            : ""}
        </span>
      ),
    },
    {
      title: "Storage",
      render: (_, volume) =>
        `$${(volume.size_gb * Number(volume.monthly_price_per_gb)).toFixed(2)}/month`,
    },
    {
      title: "Actions",
      render: (_, volume) => {
        const attached =
          !!volume.attached_vm_id || volume.attachment_state !== "detached";
        return (
          <Popconfirm
            title={`Permanently delete ${volume.name}?`}
            description="All data on this volume will be lost."
            okText="Delete volume"
            okButtonProps={{ danger: true }}
            disabled={attached}
            onConfirm={() => deleteVolume(volume)}
          >
            <Button danger size="small" disabled={attached}>
              Delete
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

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
        <Space>
          <Button
            type="primary"
            icon={<Icon name="plus" />}
            disabled={!catalog || budget == null}
            onClick={() => {
              setVmInitial(defaultVm());
              setVmModalOpen(true);
            }}
          >
            Create VM
          </Button>
          <Button
            icon={<Icon name="refresh" />}
            loading={loading}
            onClick={load}
          >
            Refresh
          </Button>
        </Space>
      </Flex>
      {error && (
        <Alert
          closable
          showIcon
          type="warning"
          message="Managed compute action failed"
          description={error}
          onClose={() => setError(undefined)}
          style={{ marginBottom: 12 }}
        />
      )}
      {notice && (
        <Alert
          closable
          showIcon
          type="success"
          message={notice}
          onClose={() => setNotice(undefined)}
          style={{ marginBottom: 12 }}
        />
      )}
      {budget ? (
        <Alert
          showIcon
          type={Number(budget.remaining_usd) > 0 ? "info" : "warning"}
          message={`$${Number(budget.spent_usd).toFixed(2)} of $${Number(budget.limit_usd).toFixed(2)} used this ${budget.period}`}
          description={`$${Number(budget.remaining_usd).toFixed(2)} remains until ${new Date(budget.period_ends_at).toLocaleString()}. VMs are deleted if the budget is exhausted; persistent volumes are retained.`}
          action={
            <Button size="small" onClick={() => setBudgetModalOpen(true)}>
              Edit budget
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : budget === null ? (
        <Alert
          showIcon
          type="info"
          message="Set a project compute budget before creating resources"
          description="Choose a recurring weekly or monthly limit. Volumes are retained if VM spending reaches the limit."
          action={
            <Button type="primary" onClick={() => setBudgetModalOpen(true)}>
              Set budget
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}
      <Table<ComputeVm>
        columns={vmColumns}
        dataSource={rows}
        loading={loading && rows.length === 0}
        locale={{
          emptyText: "No virtual machines are attached to this project.",
        }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 1050 }}
        size="small"
      />

      <Flex align="center" justify="space-between" style={{ marginTop: 28 }}>
        <div>
          <Title level={4} style={{ marginBottom: 0 }}>
            Persistent /work volumes
          </Title>
          <Text type="secondary">
            Retained independently from virtual machines.
          </Text>
        </div>
        <Button
          icon={<Icon name="plus" />}
          disabled={!catalog || budget == null}
          onClick={() => setVolumeModalOpen(true)}
        >
          Create volume
        </Button>
      </Flex>
      <Table<ComputeVolume>
        columns={volumeColumns}
        dataSource={volumes}
        loading={loading && volumes.length === 0}
        locale={{ emptyText: "No persistent volumes belong to this project." }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 850 }}
        size="small"
        style={{ marginTop: 12 }}
      />

      <Alert
        showIcon
        type="info"
        message={
          <span>
            Prefer a terminal?{" "}
            <a href={COCALC_CLI_DOWNLOAD_URL}>Install the CoCalc CLI</a>.
          </span>
        }
        description={
          <CopyToClipBoard
            value={COCALC_CLI_INSTALL_COMMAND}
            {...COPYABLE_PROPS}
          />
        }
        style={{ marginTop: 20 }}
      />

      {catalog && vmInitial && (
        <VmCreateModal
          open={vmModalOpen}
          project_id={project_id}
          catalog={catalog}
          volumes={volumes}
          initial={vmInitial}
          sshKeys={sshKeys}
          saving={saving}
          onCancel={() => setVmModalOpen(false)}
          onCreate={createVm}
        />
      )}
      {catalog && (
        <VolumeCreateModal
          open={volumeModalOpen}
          project_id={project_id}
          catalog={catalog}
          saving={saving}
          onCancel={() => setVolumeModalOpen(false)}
          onCreate={createVolume}
        />
      )}
      <BudgetModal
        open={budgetModalOpen}
        project_id={project_id}
        budget={budget}
        saving={saving}
        onCancel={() => setBudgetModalOpen(false)}
        onSave={saveBudget}
      />
      <FreshAuthModal {...freshAuthModalProps} />
    </div>
  );
}
