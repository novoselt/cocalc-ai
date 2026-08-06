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
import { HostOptionsSelect } from "../hosts/components/host-options-select";
import { useHostPricingSettings } from "../hosts/hooks/use-host-pricing-settings";
import {
  getGcpMachineTypeOptions,
  getGcpRegionOptions,
  getGcpZoneOptions,
  getProviderPriceEstimate,
  type HostFieldOption,
  type ProviderSelection,
} from "../hosts/providers/registry";
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
  region: string;
  ssh_public_key: string;
}

type VolumeDraft = VolumeCreateCliValues;

interface TtlDraft {
  action: "set" | "extend" | "clear";
  minutes: number;
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

function pricingLabel(value: string): string {
  return value === "spot" ? "Spot" : "Standard";
}

function regionFromZone(zone?: string): string {
  return `${zone ?? ""}`.replace(/-[a-z]$/, "");
}

function compatibleOptions(options: HostFieldOption[]): HostFieldOption[] {
  return options.filter((option) => {
    const meta = (option.meta ?? {}) as { compatible?: boolean };
    return !option.disabled && meta.compatible !== false;
  });
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
  const pricingSettings = useHostPricingSettings();

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
  const selectedVolume = volumes.find((volume) => volume.name === draft.volume);
  const selection: ProviderSelection = {
    region: draft.region || regionFromZone(draft.zone),
    zone: draft.zone,
    machine_type: draft.machine_type,
    pricing_model: draft.pricing_model,
    storage_mode: "persistent",
    disk_type: "balanced",
    disk_gb: draft.boot_disk_gb,
    price_display: "hourly",
    pricing_settings: pricingSettings,
  };
  const regionOptions = compatibleOptions(
    getGcpRegionOptions(catalog.host_catalog, selection),
  );
  const zoneOptions = compatibleOptions(
    getGcpZoneOptions(catalog.host_catalog, selection),
  );
  const machineOptions = compatibleOptions(
    getGcpMachineTypeOptions(catalog.host_catalog, selection),
  );
  const price = getProviderPriceEstimate(
    "gcp",
    catalog.host_catalog,
    selection,
    pricingSettings,
  );
  const standardFallbackPrice =
    draft.pricing_model === "spot" && draft.allow_on_demand_fallback
      ? getProviderPriceEstimate(
          "gcp",
          catalog.host_catalog,
          { ...selection, pricing_model: "on_demand" },
          pricingSettings,
        )
      : undefined;

  const patchDraft = (patch: Partial<VmDraft>) => {
    form.setFieldsValue(patch);
    setDraft((current) => ({ ...current, ...patch }));
  };

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
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item
            name="region"
            label="Region"
            rules={[{ required: true }]}
            style={{ flex: "1 1 280px" }}
          >
            {regionOptions.length ? (
              <HostOptionsSelect
                options={regionOptions}
                disabled={selectedVolume != null}
                onChange={(region) => {
                  const nextSelection = {
                    ...selection,
                    region,
                    zone: undefined,
                  };
                  const nextZone = compatibleOptions(
                    getGcpZoneOptions(catalog.host_catalog, nextSelection),
                  )[0]?.value;
                  patchDraft({ region, zone: nextZone });
                }}
              />
            ) : (
              <Input disabled={selectedVolume != null} />
            )}
          </Form.Item>
          <Form.Item
            name="zone"
            label="Zone"
            rules={[{ required: true }]}
            style={{ flex: "1 1 280px" }}
          >
            {zoneOptions.length ? (
              <HostOptionsSelect
                options={zoneOptions}
                disabled={selectedVolume != null}
              />
            ) : (
              <Input disabled={selectedVolume != null} />
            )}
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item
            name="machine_type"
            label="Machine"
            rules={[{ required: true }]}
            style={{ flex: "1 1 260px" }}
          >
            <HostOptionsSelect
              options={machineOptions}
              disabled={machineOptions.length === 0}
              placeholder="Select a machine available in this zone"
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
            label="Optional deletion deadline"
            extra="Leave blank to run until you stop it or membership funding is unavailable."
            style={{ flex: "1 1 160px" }}
          >
            <Select
              allowClear
              placeholder="No deadline"
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
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            onChange={(event) => {
              const pricing_model = event.target.value;
              patchDraft({
                pricing_model,
                allow_on_demand_fallback: pricing_model === "spot",
              });
            }}
          >
            <Radio.Button value="spot">Spot · lower cost</Radio.Button>
            <Radio.Button value="on_demand">Standard</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {draft.pricing_model === "spot" && (
          <Form.Item name="allow_on_demand_fallback" valuePropName="checked">
            <Checkbox>
              Automatically restart interrupted Spot VMs. If Spot remains
              unavailable, use Standard capacity for up to 24 hours and keep
              retrying Spot.
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
              if (volume) {
                patchDraft({
                  volume: name,
                  region: volume.region,
                  zone: volume.zone,
                });
              } else {
                patchDraft({ volume: undefined });
              }
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
              ? "Uses one of your account SSH keys. You can add another key later with the CoCalc CLI."
              : "Add an account SSH key or paste one here. You can add another key later with the CoCalc CLI."
          }
        >
          {sshKeys.length ? (
            <Select options={sshKeys} />
          ) : (
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          )}
        </Form.Item>
      </Form>
      <Alert
        showIcon
        type="info"
        title={
          price
            ? `Estimated price: ${price.hourly_label} (${price.monthly_label})`
            : "Price estimate unavailable for this selection"
        }
        description={`${
          standardFallbackPrice
            ? `Standard fallback: ${standardFallbackPrice.hourly_label} (${standardFallbackPrice.monthly_label}). `
            : ""
        }Includes the VM, balanced persistent boot disk, public IPv4 address, and the site surcharge. Public Internet egress is billed separately at $0.10/GB.`}
      />
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
  const pricingSettings = useHostPricingSettings();
  const api = globalThis.location?.origin ?? "https://cocalc.ai";
  const region = regionFromZone(draft.zone ?? initial.zone);
  const placementSelection: ProviderSelection = {
    region,
    zone: draft.zone,
  };
  const pricingSelection: ProviderSelection = {
    ...placementSelection,
    machine_type: "e2-standard-2",
    pricing_model: "on_demand",
    storage_mode: "persistent",
    disk_type: "balanced",
    disk_gb: draft.size_gb,
    pricing_settings: pricingSettings,
  };
  const regionOptions = compatibleOptions(
    getGcpRegionOptions(catalog.host_catalog, placementSelection),
  );
  const zoneOptions = compatibleOptions(
    getGcpZoneOptions(catalog.host_catalog, placementSelection),
  );
  const volumeEstimate = getProviderPriceEstimate(
    "gcp",
    catalog.host_catalog,
    pricingSelection,
    pricingSettings,
  );
  const diskEstimate = volumeEstimate?.line_items.find(
    (item) => item.key === "disk",
  );

  const patchDraft = (patch: Partial<VolumeDraft>) => {
    form.setFieldsValue(patch);
    setDraft((current) => ({ ...current, ...patch }));
  };

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
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item label="Region" style={{ flex: "1 1 220px" }}>
            {regionOptions.length ? (
              <HostOptionsSelect
                value={region}
                options={regionOptions}
                onChange={(nextRegion) => {
                  const nextSelection = {
                    ...placementSelection,
                    region: nextRegion,
                    zone: undefined,
                  };
                  const zone = compatibleOptions(
                    getGcpZoneOptions(catalog.host_catalog, nextSelection),
                  )[0]?.value;
                  patchDraft({ zone });
                }}
              />
            ) : (
              <Input value={region} disabled />
            )}
          </Form.Item>
          <Form.Item
            name="zone"
            label="Zone"
            rules={[{ required: true }]}
            style={{ flex: "1 1 220px" }}
          >
            {zoneOptions.length ? (
              <HostOptionsSelect options={zoneOptions} />
            ) : (
              <Input />
            )}
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
        title={
          diskEstimate
            ? `Balanced persistent SSD: ${diskEstimate.monthly_label} (${(diskEstimate.usd_per_month / Number(draft.size_gb ?? 1)).toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 3 })}/GB/month)`
            : "Balanced persistent SSD pricing is unavailable for this region"
        }
        description="Volumes are retained when VMs are deleted. They can grow online but cannot shrink. The estimate includes the site surcharge."
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

function VmTtlModal({
  vm,
  saving,
  onCancel,
  onSave,
}: {
  vm?: ComputeVm;
  saving: boolean;
  onCancel: () => void;
  onSave: (values: TtlDraft) => Promise<void>;
}) {
  const [form] = Form.useForm<TtlDraft>();
  const [draft, setDraft] = useState<TtlDraft>({
    action: vm?.expires_at ? "extend" : "set",
    minutes: 60,
  });

  useEffect(() => {
    if (!vm) return;
    const initial: TtlDraft = {
      action: vm.expires_at ? "extend" : "set",
      minutes: 60,
    };
    form.setFieldsValue(initial);
    setDraft(initial);
  }, [form, vm]);

  const duration =
    draft.minutes % 60 === 0 ? `${draft.minutes / 60}h` : `${draft.minutes}m`;
  const command = vm
    ? draft.action === "clear"
      ? `cocalc vm ttl ${vm.name} --clear`
      : `cocalc vm ttl ${vm.name} --${draft.action} ${duration}`
    : "";

  return (
    <Modal
      open={vm != null}
      title={vm ? `Deletion deadline for ${vm.name}` : "Deletion deadline"}
      okText="Save deadline"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSave)}
    >
      <Form<TtlDraft>
        form={form}
        layout="vertical"
        onValuesChange={(_, values) => setDraft(values)}
      >
        <Form.Item name="action" label="Change">
          <Select
            options={[
              { value: "set", label: "Set deadline from now" },
              ...(vm?.expires_at
                ? [{ value: "extend", label: "Extend current deadline" }]
                : []),
              { value: "clear", label: "Remove deadline" },
            ]}
          />
        </Form.Item>
        {draft.action !== "clear" && (
          <Form.Item
            name="minutes"
            label="Duration"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 30, label: "30 minutes" },
                { value: 60, label: "1 hour" },
                { value: 240, label: "4 hours" },
                { value: 480, label: "8 hours" },
                { value: 1440, label: "1 day" },
              ]}
            />
          </Form.Item>
        )}
      </Form>
      <Alert
        showIcon
        type="info"
        title="Membership spending limits remain enforced when no deletion deadline is set."
      />
      <CopyToClipBoard value={command} {...COPYABLE_PROPS} />
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
  const [catalog, setCatalog] = useState<ComputeCatalog>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [volumeModalOpen, setVolumeModalOpen] = useState(false);
  const [ttlVm, setTtlVm] = useState<ComputeVm>();
  const [vmInitial, setVmInitial] = useState<VmDraft>();
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction({
    origin: "project managed compute",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [vms, projectVolumes, computeCatalog] = await Promise.all([
        webapp_client.conat_client.hub.compute.listVms({ project_id }),
        webapp_client.conat_client.hub.compute.listVolumes({ project_id }),
        webapp_client.conat_client.hub.compute.getCatalog({}),
      ]);
      setRows(vms);
      setVolumes(projectVolumes);
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

  const defaultVm = (): VmDraft => {
    const zone = catalog?.defaults.zone ?? "us-central1-a";
    return {
      name: "compute-vm",
      region: regionFromZone(zone),
      zone,
      machine_type: catalog?.defaults.machine_type ?? "e2-standard-2",
      pricing_model: "on_demand",
      allow_on_demand_fallback: false,
      ttl_minutes: catalog?.defaults.ttl_minutes ?? null,
      boot_disk_gb: catalog?.defaults.boot_disk_gb ?? 20,
      ssh_public_key: sshKeys[0]?.value ?? "",
    };
  };

  const openSimilar = (vm: ComputeVm) => {
    const ttlMinutes = vm.expires_at
      ? Math.max(
          5,
          Math.round(
            (new Date(vm.expires_at).valueOf() -
              new Date(vm.created_at).valueOf()) /
              60_000,
          ),
        )
      : null;
    setVmInitial({
      name: similarName(vm.name, rows),
      region: vm.region,
      zone: vm.zone,
      machine_type: vm.machine_type,
      pricing_model: vm.desired_pricing_model,
      allow_on_demand_fallback: vm.allow_on_demand_fallback,
      ttl_minutes:
        ttlMinutes == null
          ? null
          : Math.min(ttlMinutes, catalog?.limits.max_ttl_minutes ?? ttlMinutes),
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
          ttl_minutes: values.ttl_minutes ?? null,
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

  const setVmRunning = async (vm: ComputeVm, running: boolean) => {
    setError(undefined);
    try {
      const action = running ? "startVm" : "stopVm";
      await webapp_client.conat_client.hub.compute[action]({
        id_or_name: vm.id,
        idempotency_key: uuid(),
      });
      setNotice(`VM '${vm.name}' is ${running ? "starting" : "stopping"}.`);
      await load();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const saveVmTtl = async (values: TtlDraft) => {
    if (!ttlVm) return;
    setSaving(true);
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.setVmTtl({
          id_or_name: ttlVm.id,
          ...(values.action === "extend"
            ? { extend_minutes: values.minutes }
            : {
                ttl_minutes: values.action === "clear" ? null : values.minutes,
              }),
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setNotice(`Deletion deadline for '${ttlVm.name}' updated.`);
      setTtlVm(undefined);
      await load();
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
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
          {pricingLabel(vm.effective_pricing_model)} · {hourlyPrice(vm)}
        </span>
      ),
    },
    { title: "Zone", dataIndex: "zone" },
    {
      title: "Public egress",
      render: (_, vm) => {
        const egress = vm.metadata?.billing?.egress;
        const gb = Number(egress?.total_bytes ?? 0) / 1_000_000_000;
        const cost = Number(egress?.total_cost_usd ?? 0);
        return (
          <span title="Cumulative metered public egress since this VM was created">
            {gb.toFixed(gb >= 10 ? 1 : 3)} GB · ${cost.toFixed(2)}
          </span>
        );
      },
    },
    {
      title: "Network",
      render: (_, vm) => (
        <div>
          {vm.public_ip ? (
            <Text copyable={{ text: vm.public_ip }}>{vm.public_ip}</Text>
          ) : (
            <Text type="secondary">No public IP</Text>
          )}
          {vm.private_ip && (
            <>
              <br />
              <Text type="secondary" copyable={{ text: vm.private_ip }}>
                private {vm.private_ip}
              </Text>
            </>
          )}
        </div>
      ),
    },
    {
      title: "Expires",
      dataIndex: "expires_at",
      render: (expiresAt?: string | Date | null) =>
        expiresAt ? (
          <Text title={new Date(expiresAt).toLocaleString()}>
            {expiresIn(expiresAt)}
          </Text>
        ) : (
          <Text type="secondary">No deadline</Text>
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
      render: (_, vm) => {
        const transitioning = ["starting", "stopping", "deleting"].includes(
          vm.state,
        );
        const running =
          vm.desired_state === "running" && vm.state !== "stopped";
        return (
          <Space size={4}>
            <Button
              size="small"
              disabled={transitioning}
              onClick={() => void setVmRunning(vm, !running)}
            >
              {running ? "Stop" : "Start"}
            </Button>
            <Button size="small" onClick={() => setTtlVm(vm)}>
              Deadline
            </Button>
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
        );
      },
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
            disabled={!catalog}
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
          title="Managed compute action failed"
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
          title={notice}
          onClose={() => setNotice(undefined)}
          style={{ marginBottom: 12 }}
        />
      )}
      <Alert
        showIcon
        type="info"
        title="VMs use your membership's dedicated-host spending limits."
        description="Compute, boot disks, and retained /work volumes appear in Purchases. Public Internet egress costs $0.10/GB and appears as one accumulating purchase per VM per calendar month, not a new line item for every meter sample. Usage can take about five minutes to appear. Running VMs stop when funding is unavailable."
        style={{ marginBottom: 12 }}
      />
      <Table<ComputeVm>
        columns={vmColumns}
        dataSource={rows}
        loading={loading && rows.length === 0}
        locale={{
          emptyText: "No virtual machines are attached to this project.",
        }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 1200 }}
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
          disabled={!catalog}
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
        title={
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
      <VmTtlModal
        vm={ttlVm}
        saving={saving}
        onCancel={() => setTtlVm(undefined)}
        onSave={saveVmTtl}
      />
      <FreshAuthModal {...freshAuthModalProps} />
    </div>
  );
}
