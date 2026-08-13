/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Dropdown,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popover,
  Popconfirm,
  Radio,
  Switch,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import type {
  ComputeAgentGrant,
  ComputeCatalog,
  ComputeVolume,
  ComputeVm,
} from "@cocalc/conat/hub/api/compute";
import { useRedux, useTypedRedux } from "@cocalc/frontend/app-framework";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { CopyToClipBoard, Icon, TimeAgo } from "@cocalc/frontend/components";
import { openProjectDocs } from "@cocalc/frontend/docs/navigation";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { mapCountryRegionToR2Region } from "@cocalc/util/consts";
import {
  COCALC_CLI_DOWNLOAD_URL,
  COCALC_CLI_INSTALL_COMMAND,
} from "@cocalc/util/consts/ui";
import { uuid } from "@cocalc/util/misc";
import { gcpMachineArchitecture } from "@cocalc/util/project-host-pricing";
import {
  HostOptionsSelect,
  sortMachineTypeOptions,
} from "../hosts/components/host-options-select";
import { useHostPricingSettings } from "../hosts/hooks/use-host-pricing-settings";
import {
  getGcpMachineTypeOptions,
  getGcpPersistentDiskPriceEstimate,
  getGcpRegionOptions,
  getGcpZoneOptions,
  getProviderDescriptor,
  getProviderOptions,
  getProviderPriceEstimate,
  type HostFieldOption,
  type ProviderSelection,
} from "../hosts/providers/registry";
import {
  markRecommendedRegionOption,
  sortRegionOptionsByPreference,
} from "../hosts/utils/region-ranking";
import {
  vmCreateCli,
  volumeCreateCli,
  type VmCreateCliValues,
  type VolumeCreateCliValues,
} from "./compute-vms-cli";
import { readProjectDeployPublicKey } from "./settings/project-to-project-ssh-service";

const { Paragraph, Text, Title } = Typography;
const COPYABLE_PROPS = {
  inputWidth: "100%",
  inputStyle: { minWidth: 0 },
  outerStyle: { width: "100%" },
  style: { marginTop: 6, width: "100%" },
} as const;

interface VmDraft extends VmCreateCliValues {
  use_project_ssh_key: boolean;
}

type VolumeDraft = VolumeCreateCliValues;

interface TtlDraft {
  action: "set" | "extend" | "clear";
  minutes: number;
}

interface VolumeResizeDraft {
  size_gb: number;
}

function shortProjectId(projectId: string): string {
  return projectId.slice(0, 8);
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

function providerCatalog(catalog: ComputeCatalog, provider: "gcp" | "nebius") {
  return catalog.provider_catalogs[provider];
}

function compatibleOptions(options: HostFieldOption[]): HostFieldOption[] {
  return options.filter((option) => {
    const meta = (option.meta ?? {}) as { compatible?: boolean };
    return (
      !option.disabled &&
      option.stateLabel !== "price unavailable" &&
      meta.compatible !== false
    );
  });
}

function selectablePlacementOptions(
  options: HostFieldOption[],
): HostFieldOption[] {
  return options.filter((option) => {
    const meta = (option.meta ?? {}) as { compatible?: boolean };
    return !option.disabled && meta.compatible !== false;
  });
}

function formatMaximumSpend(usd: number): string {
  return usd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

function availableName(stem: string, names: Iterable<string>): string {
  const used = new Set(names);
  const base = stem.replace(/-+$/, "").slice(0, 32) || "compute-vm";
  if (!used.has(base)) return base;
  for (let index = 1; index < 10_000; index++) {
    const suffix = "-" + index;
    const candidate = base.slice(0, 32 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  return ("vm-" + Date.now()).slice(0, 32);
}

function originalTtlMinutes(vm: ComputeVm): number | null {
  if (!vm.expires_at) return null;
  return Math.max(
    5,
    Math.round(
      (new Date(vm.expires_at).valueOf() - new Date(vm.created_at).valueOf()) /
        60_000,
    ),
  );
}

function VmCreateModal({
  open,
  project_id,
  catalog,
  volumes,
  initial,
  projectSshPublicKey,
  sshKeys,
  saving,
  error,
  preferredR2Region,
  onGenerateProjectSshKey,
  onCancel,
  onCreate,
}: {
  open: boolean;
  project_id: string;
  catalog: ComputeCatalog;
  volumes: ComputeVolume[];
  initial: VmDraft;
  projectSshPublicKey: string | null;
  sshKeys: Array<{ label: string; value: string }>;
  saving: boolean;
  error?: string;
  preferredR2Region: ReturnType<typeof mapCountryRegionToR2Region>;
  onGenerateProjectSshKey: () => Promise<string | undefined>;
  onCancel: () => void;
  onCreate: (values: VmDraft) => Promise<void>;
}) {
  const [form] = Form.useForm<VmDraft>();
  const [draft, setDraft] = useState<Partial<VmDraft>>(initial);
  const [sortRegionsByPrice, setSortRegionsByPrice] = useState(false);
  const [sortMachinesByPrice, setSortMachinesByPrice] = useState(false);
  const [sshKeyError, setSshKeyError] = useState<string>();
  const pricingSettings = useHostPricingSettings();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initial);
    setDraft(initial);
    setSortRegionsByPrice(false);
    setSortMachinesByPrice(false);
    setSshKeyError(undefined);
  }, [form, initial, open]);

  const api = globalThis.location?.origin ?? "https://cocalc.ai";
  const provider = draft.provider ?? initial.provider;
  const hostCatalog = providerCatalog(catalog, provider);
  const availableVolumes = volumes.filter(
    (volume) =>
      volume.provider === provider &&
      volume.state === "ready" &&
      volume.attachment_state === "detached",
  );
  const selectedVolume = volumes.find(
    (volume) => volume.name === draft.home_volume,
  );
  const selection: ProviderSelection = {
    architecture: draft.architecture,
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
  const providerOptions = getProviderOptions(provider, hostCatalog, selection);
  const descriptor = getProviderDescriptor(provider);
  const regionOptions = markRecommendedRegionOption(
    sortRegionOptionsByPreference({
      options:
        provider === "gcp"
          ? compatibleOptions(getGcpRegionOptions(hostCatalog, selection))
          : selectablePlacementOptions(providerOptions.region ?? []),
      preference: sortRegionsByPrice ? "cheapest" : "closest",
      preferredRegion: preferredR2Region,
    }),
  );
  const zoneOptions = compatibleOptions(
    provider === "gcp"
      ? getGcpZoneOptions(hostCatalog, selection)
      : (providerOptions.zone ?? []),
  );
  const machineOptions =
    sortMachineTypeOptions(
      compatibleOptions(
        (provider === "gcp"
          ? getGcpMachineTypeOptions(hostCatalog, selection)
          : (providerOptions.machine_type ?? [])
        ).filter(
          ({ value }) =>
            provider !== "gcp" ||
            gcpMachineArchitecture(value) === draft.architecture,
        ),
      ),
      sortMachinesByPrice ? "price" : "type",
    ) ?? [];
  const gpuOptions = compatibleOptions(providerOptions.gpu_type ?? []);
  const price = getProviderPriceEstimate(
    provider,
    hostCatalog,
    selection,
    pricingSettings,
  );
  const standardFallbackPrice =
    draft.pricing_model === "spot" && draft.allow_on_demand_fallback
      ? getProviderPriceEstimate(
          provider,
          hostCatalog,
          { ...selection, pricing_model: "on_demand" },
          pricingSettings,
        )
      : undefined;
  const newVolumePrice =
    draft.create_home_volume && provider === "gcp"
      ? getGcpPersistentDiskPriceEstimate(
          hostCatalog,
          {
            region: draft.region || regionFromZone(draft.zone),
            zone: draft.zone,
            storage_mode: "persistent",
            disk_type: "balanced",
            disk_gb: draft.new_home_volume_size_gb,
            pricing_settings: pricingSettings,
          },
          pricingSettings,
        )?.line_items.find((item) => item.key === "disk")
      : undefined;
  const maximumSpend =
    draft.ttl_minutes && (standardFallbackPrice ?? price)
      ? ((standardFallbackPrice ?? price)!.usd_per_hour * draft.ttl_minutes) /
        60
      : undefined;

  const patchDraft = (patch: Partial<VmDraft>) => {
    form.setFieldsValue(patch);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const withResolvedSshKey = (values: VmDraft): VmDraft => ({
    ...values,
    ssh_public_key: values.use_project_ssh_key
      ? (projectSshPublicKey ?? "")
      : values.ssh_public_key,
  });

  return (
    <Modal
      open={open}
      title={initial.name ? `Create ${initial.name}` : "Create virtual machine"}
      okText="Create VM"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() =>
        void form
          .validateFields()
          .then((values) => onCreate(withResolvedSshKey(values)))
      }
      width={720}
    >
      {error && (
        <Alert
          showIcon
          type="error"
          title="Unable to create VM"
          description={error}
          style={{ marginBottom: 16 }}
        />
      )}
      <Form<VmDraft>
        form={form}
        layout="vertical"
        initialValues={initial}
        onValuesChange={(changedValues) =>
          setDraft((current) => ({ ...current, ...changedValues }))
        }
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
            name="funding_mode"
            label="Funding"
            rules={[{ required: true }]}
            style={{ flex: "1 1 280px" }}
          >
            <Select
              options={catalog.funding_modes.map((mode) => ({
                value: mode.value,
                label: mode.label,
                disabled: !mode.allowed,
                title: mode.reason,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="provider"
            label="Cloud provider"
            rules={[{ required: true }]}
            style={{ flex: "1 1 220px" }}
          >
            <Select
              options={catalog.providers.map((value) => ({
                value,
                label: getProviderDescriptor(value).label,
              }))}
              onChange={(nextProvider: "gcp" | "nebius") => {
                const nextCatalog = providerCatalog(catalog, nextProvider);
                const options = getProviderOptions(nextProvider, nextCatalog, {
                  pricing_model: draft.pricing_model,
                });
                const region =
                  nextProvider === "gcp"
                    ? catalog.defaults.region
                    : options.region?.[0]?.value;
                const zone =
                  nextProvider === "gcp"
                    ? catalog.defaults.zone
                    : options.zone?.[0]?.value;
                const machine_type =
                  nextProvider === "gcp"
                    ? catalog.defaults.machine_type
                    : options.machine_type?.[0]?.value;
                patchDraft({
                  provider: nextProvider,
                  architecture: "x86_64",
                  region,
                  zone,
                  machine_type,
                  gpu_type: undefined,
                  gpu_count: 0,
                  home_volume: undefined,
                  create_home_volume: false,
                });
              }}
            />
          </Form.Item>
          <Form.Item
            name="architecture"
            label="Architecture"
            rules={[{ required: true }]}
            style={{ flex: "1 1 180px" }}
          >
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              disabled={provider !== "gcp"}
              onChange={(event) => {
                const architecture = event.target.value as "x86_64" | "arm64";
                const architectureSelection: ProviderSelection = {
                  ...selection,
                  architecture,
                  machine_type: undefined,
                  gpu_type: undefined,
                  region: undefined,
                  zone: undefined,
                };
                const compatibleRegions = sortRegionOptionsByPreference({
                  options: compatibleOptions(
                    getGcpRegionOptions(hostCatalog, architectureSelection),
                  ),
                  preference: sortRegionsByPrice ? "cheapest" : "closest",
                  preferredRegion: preferredR2Region,
                });
                const region = compatibleRegions.some(
                  (option) => option.value === draft.region,
                )
                  ? draft.region
                  : compatibleRegions[0]?.value;
                const zoneSelection = {
                  ...architectureSelection,
                  region,
                };
                const compatibleZones = compatibleOptions(
                  getGcpZoneOptions(hostCatalog, zoneSelection),
                );
                const zone = compatibleZones.some(
                  (option) => option.value === draft.zone,
                )
                  ? draft.zone
                  : compatibleZones[0]?.value;
                const machine_type = compatibleOptions(
                  getGcpMachineTypeOptions(hostCatalog, {
                    ...zoneSelection,
                    zone,
                  }),
                ).find(
                  ({ value }) => gcpMachineArchitecture(value) === architecture,
                )?.value;
                patchDraft({
                  architecture,
                  region,
                  zone,
                  machine_type,
                  gpu_type: undefined,
                  gpu_count: 0,
                });
              }}
            >
              <Radio.Button value="x86_64">x86-64</Radio.Button>
              <Radio.Button value="arm64">ARM64</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item
            name="region"
            label={
              <Flex align="center" justify="space-between" gap={12}>
                <span>Region</span>
                <Space size={6}>
                  <Text type="secondary" style={{ fontWeight: 400 }}>
                    Sort by price
                  </Text>
                  <Switch
                    size="small"
                    checked={sortRegionsByPrice}
                    onChange={setSortRegionsByPrice}
                  />
                </Space>
              </Flex>
            }
            rules={[{ required: true }]}
            style={{ flex: "1 1 280px" }}
          >
            <HostOptionsSelect
              options={regionOptions}
              disabled={selectedVolume != null || !regionOptions.length}
              placeholder={
                regionOptions.length
                  ? "Select a region"
                  : "No regions available"
              }
              onChange={(region) => {
                const nextSelection = {
                  ...selection,
                  region,
                  zone: undefined,
                };
                const nextZone = compatibleOptions(
                  provider === "gcp"
                    ? getGcpZoneOptions(hostCatalog, nextSelection)
                    : (getProviderOptions(provider, hostCatalog, nextSelection)
                        .zone ?? []),
                )[0]?.value;
                patchDraft({ region, zone: nextZone });
              }}
            />
          </Form.Item>
          <Form.Item
            name="zone"
            label="Zone"
            rules={[{ required: provider === "gcp" }]}
            style={{ flex: "1 1 280px" }}
          >
            {!descriptor.supports.zone ? (
              <Input disabled placeholder="Provider-managed location" />
            ) : zoneOptions.length ? (
              <HostOptionsSelect
                options={zoneOptions}
                disabled={selectedVolume != null}
              />
            ) : (
              <Input disabled={selectedVolume != null} />
            )}
          </Form.Item>
        </Flex>
        {descriptor.supports.gpuType &&
          !(provider === "gcp" && draft.architecture === "arm64") &&
          gpuOptions.length > 0 && (
            <Flex gap={12} wrap>
              <Form.Item
                name="gpu_type"
                label="GPU"
                style={{ flex: "1 1 280px" }}
              >
                <HostOptionsSelect options={gpuOptions} placeholder="No GPU" />
              </Form.Item>
              <Form.Item
                name="gpu_count"
                label="GPU count"
                style={{ flex: "1 1 160px" }}
              >
                <InputNumber min={0} max={8} />
              </Form.Item>
            </Flex>
          )}
        <Flex gap={12} wrap>
          <Form.Item
            name="machine_type"
            label={
              <Flex align="center" justify="space-between" gap={12}>
                <span>Machine</span>
                <Space size={6}>
                  <Text type="secondary" style={{ fontWeight: 400 }}>
                    Sort by price
                  </Text>
                  <Switch
                    size="small"
                    checked={sortMachinesByPrice}
                    onChange={setSortMachinesByPrice}
                  />
                </Space>
              </Flex>
            }
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
        <Form.Item name="create_home_volume" valuePropName="checked">
          <Checkbox
            onChange={(event) => {
              if (event.target.checked) {
                patchDraft({ home_volume: undefined });
              }
            }}
          >
            Create a new persistent home volume mounted at{" "}
            <Text code>/home/user</Text>
          </Checkbox>
        </Form.Item>
        {draft.create_home_volume ? (
          <>
            <Flex gap={12} wrap>
              <Form.Item
                name="new_home_volume_name"
                label="New home volume name"
                rules={[
                  { required: true },
                  {
                    pattern: /^[a-z][a-z0-9-]{0,31}$/,
                    message:
                      "Use at most 32 lowercase letters, digits, or hyphens.",
                  },
                ]}
                style={{ flex: "1 1 260px" }}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="new_home_volume_size_gb"
                label="Size (GB)"
                rules={[{ required: true }]}
                style={{ flex: "1 1 160px" }}
              >
                <InputNumber
                  min={10}
                  max={catalog.limits.max_volume_gb}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </Flex>
            <Alert
              showIcon
              type="info"
              title={
                newVolumePrice
                  ? `New home volume: ${newVolumePrice.monthly_label}`
                  : "New home volume pricing is unavailable"
              }
              description={
                "The volume will be created in " +
                (draft.zone ?? "the selected zone") +
                ", attached to this VM, and retained if the VM is deleted."
              }
              style={{ marginBottom: 16 }}
            />
          </>
        ) : (
          <Form.Item
            name="home_volume"
            label="Existing persistent home volume"
            extra="Optional. The VM and volume must be in the same zone. Volumes survive VM deletion and can be attached to only one VM."
          >
            <Select
              allowClear
              placeholder="Use the VM boot disk for /home/user"
              options={availableVolumes.map((volume) => ({
                value: volume.name,
                label: `${volume.name} · ${volume.effective_size_gb} GB · ${volume.region}${volume.zone ? `/${volume.zone}` : ""}${
                  volume.region === draft.region &&
                  (!volume.zone || volume.zone === draft.zone)
                    ? ""
                    : " · unavailable in this location"
                }`,
                disabled:
                  volume.region !== draft.region ||
                  (!!volume.zone && volume.zone !== draft.zone),
              }))}
              onChange={(name) => {
                patchDraft({ home_volume: name || undefined });
              }}
            />
          </Form.Item>
        )}
        <Form.Item name="configure_project_ssh" valuePropName="checked">
          <Checkbox disabled={!draft.use_project_ssh_key}>
            Add a managed SSH alias to this project&apos;s{" "}
            <Text code>~/.ssh/config</Text> when the VM is ready
          </Checkbox>
        </Form.Item>
        {projectSshPublicKey ? (
          <Form.Item name="use_project_ssh_key" valuePropName="checked">
            <Checkbox>
              Add this project&apos;s SSH key from{" "}
              <Text code>.ssh/id_ed25519.pub</Text>
            </Checkbox>
          </Form.Item>
        ) : (
          <Alert
            showIcon
            type="info"
            title="This project does not have an SSH keypair yet."
            description="Create an encrypted project SSH keypair, then use its public key for this VM. The project does not need to restart."
            action={
              <Button
                size="small"
                loading={saving}
                onClick={() => {
                  setSshKeyError(undefined);
                  void onGenerateProjectSshKey()
                    .then((publicKey) => {
                      if (publicKey) {
                        patchDraft({ use_project_ssh_key: true });
                      }
                    })
                    .catch((err) => setSshKeyError(String(err)));
                }}
              >
                Create project SSH keypair
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        {sshKeyError && (
          <Alert
            showIcon
            type="warning"
            title="Unable to create project SSH keypair"
            description={sshKeyError}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form.Item
          name="ssh_public_key"
          label={
            projectSshPublicKey
              ? "Other SSH public key (optional)"
              : "SSH public key (optional)"
          }
          extra={
            draft.use_project_ssh_key
              ? "Uncheck the project key above to select a different initial key."
              : sshKeys.length
                ? "Select an account key, or leave blank. The CoCalc CLI can authorize your local key later when you run cocalc vm ssh."
                : "Leave blank to authorize your local key later with cocalc vm ssh, or paste a public key now."
          }
        >
          {sshKeys.length ? (
            <Select
              allowClear
              disabled={draft.use_project_ssh_key}
              options={sshKeys}
              placeholder="No initial key"
            />
          ) : (
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              disabled={draft.use_project_ssh_key}
            />
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
        description={
          <Space direction="vertical" size={2}>
            <span>
              {standardFallbackPrice
                ? `Standard fallback: ${standardFallbackPrice.hourly_label} (${standardFallbackPrice.monthly_label}). `
                : ""}
              Includes the VM, balanced persistent boot disk, public IPv4
              address, and the site surcharge. Public Internet egress is billed
              separately at $0.10/GB.
            </span>
            {maximumSpend != null && (
              <Text strong>
                Maximum spend through the deletion deadline:{" "}
                {formatMaximumSpend(maximumSpend)} + $0.10/GB public egress.
              </Text>
            )}
          </Space>
        }
      />
      <Divider />
      <Text strong>Equivalent CLI command</Text>
      <Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
        The command reproduces the form exactly, including an initial SSH key or
        an explicitly keyless VM.
      </Paragraph>
      <CopyToClipBoard
        value={vmCreateCli({
          api,
          project_id,
          values: withResolvedSshKey(draft as VmDraft),
        })}
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
    name: "home-data",
    provider: catalog.defaults.provider,
    funding_mode: catalog.default_funding_mode,
    region: catalog.defaults.region,
    zone: catalog.defaults.zone,
    size_gb: 50,
  };
  const [draft, setDraft] = useState<Partial<VolumeDraft>>(initial);
  const pricingSettings = useHostPricingSettings();
  const api = globalThis.location?.origin ?? "https://cocalc.ai";
  const provider = draft.provider ?? initial.provider;
  const hostCatalog = providerCatalog(catalog, provider);
  const region = draft.region ?? regionFromZone(draft.zone ?? initial.zone);
  const placementSelection: ProviderSelection = {
    region,
    zone: draft.zone,
  };
  const pricingSelection = {
    ...placementSelection,
    storage_mode: "persistent",
    disk_type: "balanced",
    disk_gb: draft.size_gb,
    pricing_settings: pricingSettings,
  } as const;
  const providerOptions = getProviderOptions(
    provider,
    hostCatalog,
    placementSelection,
  );
  const regionOptions =
    provider === "gcp"
      ? compatibleOptions(getGcpRegionOptions(hostCatalog, placementSelection))
      : selectablePlacementOptions(providerOptions.region ?? []);
  const zoneOptions = compatibleOptions(
    provider === "gcp"
      ? getGcpZoneOptions(hostCatalog, placementSelection)
      : (providerOptions.zone ?? []),
  );
  const volumeEstimate =
    provider === "gcp"
      ? getGcpPersistentDiskPriceEstimate(
          hostCatalog,
          pricingSelection,
          pricingSettings,
        )
      : undefined;
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
      title="Create persistent home volume"
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
          <Form.Item
            name="funding_mode"
            label="Funding"
            rules={[{ required: true }]}
            style={{ flex: "1 1 260px" }}
          >
            <Select
              options={catalog.funding_modes.map((mode) => ({
                value: mode.value,
                label: mode.label,
                disabled: !mode.allowed,
                title: mode.reason,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="provider"
            label="Cloud provider"
            rules={[{ required: true }]}
            style={{ flex: "1 1 220px" }}
          >
            <Select
              options={catalog.providers.map((value) => ({
                value,
                label: getProviderDescriptor(value).label,
              }))}
              onChange={(nextProvider: "gcp" | "nebius") => {
                const nextCatalog = providerCatalog(catalog, nextProvider);
                const options = getProviderOptions(
                  nextProvider,
                  nextCatalog,
                  {},
                );
                patchDraft({
                  provider: nextProvider,
                  region:
                    nextProvider === "gcp"
                      ? catalog.defaults.region
                      : options.region?.[0]?.value,
                  zone:
                    nextProvider === "gcp"
                      ? catalog.defaults.zone
                      : options.zone?.[0]?.value,
                });
              }}
            />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item
            name="region"
            label="Region"
            rules={[{ required: true }]}
            style={{ flex: "1 1 220px" }}
          >
            <HostOptionsSelect
              value={region}
              options={regionOptions}
              disabled={!regionOptions.length}
              placeholder={
                regionOptions.length
                  ? "Select a region"
                  : "No regions available"
              }
              onChange={(nextRegion) => {
                const nextSelection = {
                  ...placementSelection,
                  region: nextRegion,
                  zone: undefined,
                };
                const zone = compatibleOptions(
                  provider === "gcp"
                    ? getGcpZoneOptions(hostCatalog, nextSelection)
                    : (getProviderOptions(provider, hostCatalog, nextSelection)
                        .zone ?? []),
                )[0]?.value;
                patchDraft({ region: nextRegion, zone });
              }}
            />
          </Form.Item>
          <Form.Item
            name="zone"
            label="Zone"
            rules={[{ required: provider === "gcp" }]}
            style={{ flex: "1 1 220px" }}
          >
            {!getProviderDescriptor(provider).supports.zone ? (
              <Input disabled placeholder="Provider-managed location" />
            ) : zoneOptions.length ? (
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
        description="The volume and VM must use the same provider and location. Volumes are retained when VMs are deleted. They can grow online but cannot shrink. The estimate includes the site surcharge."
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

function VolumeResizeModal({
  volume,
  maxSizeGb,
  saving,
  onCancel,
  onResize,
}: {
  volume?: ComputeVolume;
  maxSizeGb: number;
  saving: boolean;
  onCancel: () => void;
  onResize: (values: VolumeResizeDraft) => Promise<void>;
}) {
  const [form] = Form.useForm<VolumeResizeDraft>();
  const sizeGb = Form.useWatch("size_gb", form);

  useEffect(() => {
    if (!volume) return;
    form.setFieldsValue({ size_gb: volume.size_gb });
  }, [form, volume]);

  const monthlyPrice =
    volume && Number.isFinite(Number(sizeGb))
      ? Number(sizeGb) * Number(volume.monthly_price_per_gb)
      : undefined;
  return (
    <Modal
      open={volume != null}
      title={volume ? "Enlarge " + volume.name : "Enlarge volume"}
      okText="Enlarge volume"
      confirmLoading={saving}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onResize)}
    >
      <Form<VolumeResizeDraft> form={form} layout="vertical">
        <Form.Item
          name="size_gb"
          label="New size (GB)"
          extra={
            volume
              ? "Current size: " +
                volume.size_gb +
                " GB. Volumes cannot shrink."
              : undefined
          }
          rules={[
            { required: true },
            {
              validator: async (_, value) => {
                if (volume && Number(value) < volume.size_gb) {
                  throw new Error("The new size cannot be smaller.");
                }
              },
            },
          ]}
        >
          <InputNumber
            min={volume?.size_gb ?? 10}
            max={maxSizeGb}
            style={{ width: "100%" }}
          />
        </Form.Item>
      </Form>
      <Alert
        showIcon
        type="info"
        title={
          monthlyPrice == null
            ? "Balanced persistent SSD"
            : "Estimated storage: $" + monthlyPrice.toFixed(2) + "/month"
        }
        description={
          volume?.attached_vm_id
            ? "The block device grows online. The VM checks every 30 seconds and automatically grows the ext4 /home/user filesystem without a reboot."
            : "The enlarged capacity is available the next time this volume is attached."
        }
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
      <Alert
        showIcon
        type={vm?.expires_at ? "warning" : "info"}
        title={
          vm?.expires_at ? (
            <>
              This VM and its boot disk will be deleted{" "}
              <TimeAgo date={new Date(vm.expires_at)} click_to_toggle={false} />
              .
            </>
          ) : (
            "This VM has no automatic deletion deadline."
          )
        }
        description={
          vm?.expires_at
            ? "A separate persistent home volume is retained."
            : "It runs until you stop or delete it, or membership funding becomes unavailable."
        }
        style={{ marginBottom: 16 }}
      />
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
  const cloudflareCountry = useTypedRedux("customize", "country");
  const cloudflareRegionCode = useTypedRedux(
    "customize",
    "cloudflare_region_code",
  );
  const preferredR2Region = mapCountryRegionToR2Region(
    cloudflareCountry,
    cloudflareRegionCode,
  );
  const [rows, setRows] = useState<ComputeVm[]>([]);
  const [allRows, setAllRows] = useState<ComputeVm[]>([]);
  const [volumes, setVolumes] = useState<ComputeVolume[]>([]);
  const [catalog, setCatalog] = useState<ComputeCatalog>();
  const [agentGrants, setAgentGrants] = useState<ComputeAgentGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [vmCreateError, setVmCreateError] = useState<string>();
  const [volumeModalOpen, setVolumeModalOpen] = useState(false);
  const [resizeVolumeTarget, setResizeVolumeTarget] = useState<ComputeVolume>();
  const [ttlVm, setTtlVm] = useState<ComputeVm>();
  const [vmInitial, setVmInitial] = useState<VmDraft>();
  const [projectSshPublicKey, setProjectSshPublicKey] = useState<string | null>(
    null,
  );
  const [projectSshKeyLoading, setProjectSshKeyLoading] = useState(true);
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  const load = async () => {
    setLoading(true);
    try {
      const [ownedVms, projectVolumes, computeCatalog, grants] =
        await Promise.all([
          webapp_client.conat_client.hub.compute.listVms({}),
          webapp_client.conat_client.hub.compute.listVolumes({ project_id }),
          webapp_client.conat_client.hub.compute.getCatalog({}),
          webapp_client.conat_client.hub.compute.listAgentGrants({
            project_id,
          }),
        ]);
      setAllRows(ownedVms);
      setRows(ownedVms.filter((vm) => vm.project_id === project_id));
      setVolumes(projectVolumes);
      setCatalog(computeCatalog);
      setAgentGrants(grants);
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

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    setProjectSshKeyLoading(true);
    void readProjectDeployPublicKey(project_id)
      .then((publicKey) => {
        if (!cancelled) {
          setProjectSshPublicKey(publicKey?.trim() || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectSshPublicKey(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProjectSshKeyLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, project_id]);

  const defaultVm = (): VmDraft => {
    const recent = [...rows].sort(
      (a, b) =>
        new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf(),
    )[0];
    const catalogDefaultZone = catalog?.defaults.zone ?? "us-central1-a";
    const defaultProvider = catalog?.defaults.provider ?? "gcp";
    const defaultCatalog = catalog
      ? providerCatalog(catalog, defaultProvider)
      : undefined;
    const defaultSelection: ProviderSelection = {
      region: regionFromZone(catalogDefaultZone),
      zone: catalogDefaultZone,
      machine_type: catalog?.defaults.machine_type ?? "e2-standard-2",
      pricing_model: "on_demand",
      storage_mode: "persistent",
      disk_type: "balanced",
      disk_gb: catalog?.defaults.boot_disk_gb ?? 20,
    };
    const nearestRegion = catalog
      ? sortRegionOptionsByPreference({
          options: compatibleOptions(
            getGcpRegionOptions(defaultCatalog, {
              ...defaultSelection,
              region: undefined,
              zone: undefined,
            }),
          ),
          preference: "closest",
          preferredRegion: preferredR2Region,
        })[0]?.value
      : undefined;
    const nearestZone =
      catalog && nearestRegion
        ? compatibleOptions(
            getGcpZoneOptions(defaultCatalog, {
              ...defaultSelection,
              region: nearestRegion,
              zone: undefined,
            }),
          )[0]?.value
        : undefined;
    const zone = recent?.zone ?? nearestZone ?? catalogDefaultZone;
    const name = availableName(
      recent?.name ?? "compute-vm",
      allRows.map((vm) => vm.name),
    );
    const ttlMinutes = recent ? originalTtlMinutes(recent) : null;
    return {
      name,
      provider: defaultProvider,
      funding_mode:
        recent?.funding_mode ??
        catalog?.default_funding_mode ??
        "account-prepaid",
      architecture:
        recent?.architecture ?? catalog?.defaults.architecture ?? "x86_64",
      region: regionFromZone(zone),
      zone,
      machine_type:
        recent?.machine_type ??
        catalog?.defaults.machine_type ??
        "e2-standard-2",
      pricing_model: recent?.desired_pricing_model ?? "on_demand",
      allow_on_demand_fallback: recent?.allow_on_demand_fallback ?? false,
      ttl_minutes:
        ttlMinutes == null
          ? (catalog?.defaults.ttl_minutes ?? null)
          : Math.min(ttlMinutes, catalog?.limits.max_ttl_minutes ?? ttlMinutes),
      boot_disk_gb:
        recent?.boot_disk_gb ?? catalog?.defaults.boot_disk_gb ?? 20,
      create_home_volume: false,
      new_home_volume_name: availableName(
        name + "-home",
        volumes.map((volume) => volume.name),
      ),
      new_home_volume_size_gb: 50,
      use_project_ssh_key: projectSshPublicKey != null,
      configure_project_ssh: projectSshPublicKey != null,
      ssh_public_key: sshKeys[0]?.value ?? "",
    };
  };

  const openSimilar = (vm: ComputeVm) => {
    const ttlMinutes = originalTtlMinutes(vm);
    const name = similarName(vm.name, allRows);
    setVmInitial({
      name,
      provider: vm.provider,
      funding_mode: vm.funding_mode,
      architecture: vm.architecture,
      region: vm.region,
      zone: vm.zone ?? undefined,
      machine_type: vm.machine_type,
      pricing_model: vm.desired_pricing_model,
      allow_on_demand_fallback: vm.allow_on_demand_fallback,
      ttl_minutes:
        ttlMinutes == null
          ? null
          : Math.min(ttlMinutes, catalog?.limits.max_ttl_minutes ?? ttlMinutes),
      boot_disk_gb: vm.boot_disk_gb,
      create_home_volume: false,
      new_home_volume_name: availableName(
        name + "-home",
        volumes.map((volume) => volume.name),
      ),
      new_home_volume_size_gb: 50,
      use_project_ssh_key: projectSshPublicKey != null,
      configure_project_ssh: projectSshPublicKey != null,
      ssh_public_key: sshKeys[0]?.value ?? "",
    });
    setVmCreateError(undefined);
    setVmModalOpen(true);
  };

  const generateProjectSshKey = async (): Promise<string | undefined> => {
    setSaving(true);
    setError(undefined);
    try {
      let publicKey: string | undefined;
      const completed = await runFreshAuthAction(async () => {
        const result =
          await webapp_client.conat_client.hub.projects.generateProjectSshKeySecret(
            {
              browser_id: webapp_client.browser_id,
              project_id,
            },
          );
        publicKey = result.public_key.trim();
      });
      if (!completed || !publicKey) return;
      setProjectSshPublicKey(publicKey);
      setNotice("Project SSH keypair created and selected for this VM.");
      return publicKey;
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const waitForVolumeReady = async (idOrName: string) => {
    const deadline = Date.now() + 5 * 60_000;
    let state = "requested";
    while (Date.now() < deadline) {
      const volume = await webapp_client.conat_client.hub.compute.getVolume({
        id_or_name: idOrName,
      });
      state = volume.state;
      if (state === "ready") return volume;
      if (state === "failed" || state === "deleted") {
        throw new Error(
          volume.error || "Volume creation failed (state=" + state + ").",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(
      "Timed out waiting for the home volume (state=" + state + ").",
    );
  };

  const createVm = async (values: VmDraft) => {
    setSaving(true);
    setVmCreateError(undefined);
    let createdVolumeName: string | undefined;
    try {
      const completed = await runFreshAuthAction(async () => {
        let homeVolume = values.home_volume;
        if (values.create_home_volume) {
          if (!values.new_home_volume_name || !values.new_home_volume_size_gb) {
            throw new Error("A new home volume name and size are required.");
          }
          const createdVolume =
            await webapp_client.conat_client.hub.compute.createVolume({
              project_id,
              name: values.new_home_volume_name,
              provider: values.provider,
              funding_mode: values.funding_mode,
              region: values.region,
              zone: values.zone,
              size_gb: values.new_home_volume_size_gb,
              idempotency_key: uuid(),
              browser_id: webapp_client.browser_id,
            });
          createdVolumeName = createdVolume.name;
          await waitForVolumeReady(createdVolume.id);
          homeVolume = createdVolume.name;
        }
        await webapp_client.conat_client.hub.compute.createVm({
          project_id,
          name: values.name,
          provider: values.provider,
          funding_mode: values.funding_mode,
          architecture: values.architecture,
          region: values.region,
          zone: values.zone,
          machine_type: values.machine_type,
          gpu_type:
            values.gpu_type && values.gpu_type !== "none"
              ? values.gpu_type
              : undefined,
          gpu_count: values.gpu_count,
          pricing_model: values.pricing_model,
          allow_on_demand_fallback: values.allow_on_demand_fallback,
          ttl_minutes: values.ttl_minutes ?? null,
          boot_disk_gb: values.boot_disk_gb,
          home_volume: homeVolume,
          ssh_public_key: values.ssh_public_key,
          configure_project_ssh: values.configure_project_ssh,
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setVmModalOpen(false);
      setNotice(`VM '${values.name}' requested.`);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setVmCreateError(
        createdVolumeName
          ? "Volume '" +
              createdVolumeName +
              "' was created and retained, but VM creation failed: " +
              message
          : message,
      );
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

  const approveAgentGrant = async (grant: ComputeAgentGrant) => {
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.approveAgentGrant({
          grant_id: grant.grant_id,
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setNotice("The pending Codex VM action is authorized for this turn.");
      await load();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const revokeAgentGrant = async (grant: ComputeAgentGrant) => {
    setError(undefined);
    try {
      await webapp_client.conat_client.hub.compute.revokeAgentGrant({
        grant_id: grant.grant_id,
      });
      setNotice("The Codex VM authorization was revoked.");
      await load();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const setVmRunning = async (vm: ComputeVm, running: boolean) => {
    setError(undefined);
    try {
      const action = running ? "startVm" : "stopVm";
      const execute = async () => {
        await webapp_client.conat_client.hub.compute[action]({
          id_or_name: vm.id,
          idempotency_key: uuid(),
          ...(running ? { browser_id: webapp_client.browser_id } : {}),
        });
      };
      if (running) {
        const completed = await runFreshAuthAction(execute);
        if (!completed) return;
      } else {
        await execute();
      }
      setNotice(`VM '${vm.name}' is ${running ? "starting" : "stopping"}.`);
      await load();
    } catch (err) {
      setError(`${err}`);
    }
  };

  const changeVmFunding = (vm: ComputeVm) => {
    let fundingMode = vm.funding_mode;
    Modal.confirm({
      title: `Change funding for ${vm.name}`,
      content: (
        <Select
          defaultValue={fundingMode}
          style={{ marginTop: 12, width: "100%" }}
          options={(catalog?.funding_modes ?? []).map((mode) => ({
            value: mode.value,
            label: mode.allowed ? mode.label : `${mode.label} (${mode.reason})`,
            disabled: !mode.allowed,
          }))}
          onChange={(value) => {
            fundingMode = value;
          }}
        />
      ),
      okText: "Change funding",
      onOk: async () => {
        if (fundingMode === vm.funding_mode) return;
        const completed = await runFreshAuthAction(async () => {
          await webapp_client.conat_client.hub.compute.setVmFundingMode({
            id_or_name: vm.id,
            funding_mode: fundingMode,
            idempotency_key: uuid(),
            browser_id: webapp_client.browser_id,
          });
        });
        if (!completed) throw new Error("Fresh authorization was cancelled.");
        setNotice(`Funding for '${vm.name}' changed to ${fundingMode}.`);
        await load();
      },
    });
  };

  const changeVolumeFunding = (volume: ComputeVolume) => {
    let fundingMode = volume.funding_mode;
    Modal.confirm({
      title: `Change funding for ${volume.name}`,
      content: (
        <Select
          defaultValue={fundingMode}
          style={{ marginTop: 12, width: "100%" }}
          options={(catalog?.funding_modes ?? []).map((mode) => ({
            value: mode.value,
            label: mode.allowed ? mode.label : `${mode.label} (${mode.reason})`,
            disabled: !mode.allowed,
          }))}
          onChange={(value) => {
            fundingMode = value;
          }}
        />
      ),
      okText: "Change funding",
      onOk: async () => {
        if (fundingMode === volume.funding_mode) return;
        const completed = await runFreshAuthAction(async () => {
          await webapp_client.conat_client.hub.compute.setVolumeFundingMode({
            id_or_name: volume.id,
            funding_mode: fundingMode,
            idempotency_key: uuid(),
            browser_id: webapp_client.browser_id,
          });
        });
        if (!completed) throw new Error("Fresh authorization was cancelled.");
        setNotice(`Funding for '${volume.name}' changed to ${fundingMode}.`);
        await load();
      },
    });
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
          provider: values.provider,
          funding_mode: values.funding_mode,
          region: values.region,
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

  const resizeVolume = async (values: VolumeResizeDraft) => {
    if (!resizeVolumeTarget) return;
    setSaving(true);
    setError(undefined);
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.compute.resizeVolume({
          id_or_name: resizeVolumeTarget.id,
          size_gb: values.size_gb,
          idempotency_key: uuid(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed) return;
      setNotice(
        "Volume '" +
          resizeVolumeTarget.name +
          "' is growing to " +
          values.size_gb +
          " GB.",
      );
      setResizeVolumeTarget(undefined);
      await load();
    } catch (err) {
      setError(String(err));
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
      title: "VM",
      dataIndex: "name",
      fixed: "left",
      width: 180,
      render: (name: string, vm) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text copyable={{ text: vm.id }} type="secondary">
            ID {vm.id.slice(0, 8)}
          </Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "state",
      width: 160,
      render: (state: string, vm) => (
        <Space direction="vertical" size={1} style={{ minWidth: 0 }}>
          <Tag
            color={state === "ready" ? "green" : undefined}
            style={{ marginInlineEnd: 0, width: "fit-content" }}
          >
            {state}
          </Tag>
          {vm.expires_at && (
            <Text type="secondary">
              Deletes <TimeAgo date={new Date(vm.expires_at)} />
            </Text>
          )}
          {state === "recovering" && (
            <Text type="secondary">Spot unavailable; retrying</Text>
          )}
          {state === "failed" && vm.error && (
            <Text type="danger" title={vm.error}>
              Provider error
            </Text>
          )}
          {!vm.expires_at && <Text type="secondary">No deletion deadline</Text>}
        </Space>
      ),
    },
    {
      title: "Configuration",
      width: 175,
      render: (_, vm) => (
        <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
          <Text strong>{vm.machine_type}</Text>
          <Text type="secondary">
            {getProviderDescriptor(vm.provider).label} · {vm.architecture}
          </Text>
          <Text type="secondary">{vm.zone ?? vm.region}</Text>
          {vm.gpu_type && (
            <Text type="secondary">
              {vm.gpu_count}× {vm.gpu_type}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: "Cost & usage",
      width: 190,
      render: (_, vm) => {
        const egress = vm.egress_summary;
        const gb = Number(egress.current_month_bytes ?? 0) / 1_000_000_000;
        const cost = Number(egress.current_month_cost_usd ?? 0);
        return (
          <Space direction="vertical" size={0}>
            <Text>
              {pricingLabel(vm.effective_pricing_model)} · {hourlyPrice(vm)}
            </Text>
            <Text type="secondary">{vm.funding_mode}</Text>
            <Text
              type="secondary"
              title={`Current calendar month; lifetime ${(
                Number(egress.lifetime_bytes) / 1_000_000_000
              ).toFixed(3)} GB / $${Number(egress.lifetime_cost_usd).toFixed(
                2,
              )}`}
            >
              Egress {gb.toFixed(gb >= 10 ? 1 : 3)} GB ·{" "}
              {egress.free ? "free" : `$${cost.toFixed(2)}`}
              {egress.stale ? " · delayed" : ""}
            </Text>
          </Space>
        );
      },
    },
    {
      title: "Actions",
      width: 215,
      render: (_, vm) => {
        const transitioning = ["starting", "stopping", "deleting"].includes(
          vm.state,
        );
        const running =
          vm.desired_state === "running" && vm.state !== "stopped";
        const cliCommand = `cocalc vm ssh ${vm.name}`;
        const directCommand = vm.public_hostname
          ? `ssh user@${vm.public_hostname}`
          : undefined;
        return (
          <Space.Compact>
            <Popover
              trigger="click"
              placement="bottomRight"
              title={`Connect to ${vm.name}`}
              content={
                <Space
                  direction="vertical"
                  size={10}
                  style={{ maxWidth: 430, width: 390 }}
                >
                  <div>
                    <Text type="secondary">CoCalc CLI</Text>
                    <br />
                    <Text code copyable={{ text: cliCommand }}>
                      {cliCommand}
                    </Text>
                  </div>
                  {directCommand ? (
                    <div>
                      <Text type="secondary">Direct SSH</Text>
                      <br />
                      <Text code copyable={{ text: directCommand }}>
                        {directCommand}
                      </Text>
                    </div>
                  ) : (
                    <Text type="secondary">
                      A public address will appear when the VM is ready.
                    </Text>
                  )}
                  <Text type="secondary">
                    Public TCP ports: {vm.public_ports.join(", ")}. HTTPS
                    certificates and services are managed by you.
                  </Text>
                </Space>
              }
            >
              <Button size="small" type="primary">
                Connect
              </Button>
            </Popover>
            <Button
              size="small"
              disabled={transitioning}
              onClick={() => void setVmRunning(vm, !running)}
            >
              {running ? "Stop" : "Start"}
            </Button>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "deadline",
                    label: vm.expires_at
                      ? "Change deletion deadline"
                      : "Set deletion deadline",
                  },
                  { key: "similar", label: "Create similar" },
                  { key: "funding", label: "Change funding" },
                  { type: "divider" },
                  {
                    key: "delete",
                    danger: true,
                    disabled: vm.state === "deleting",
                    label: "Delete VM",
                  },
                ],
                onClick: ({ key }) => {
                  if (key === "deadline") {
                    setTtlVm(vm);
                  } else if (key === "similar") {
                    openSimilar(vm);
                  } else if (key === "funding") {
                    changeVmFunding(vm);
                  } else if (key === "delete") {
                    Modal.confirm({
                      title: `Delete ${vm.name}?`,
                      content:
                        "The VM, persistent boot disk, public address, and DNS record are deleted. An attached persistent home volume is retained independently.",
                      okText: "Delete VM",
                      okButtonProps: { danger: true },
                      onOk: () => deleteVm(vm),
                    });
                  }
                },
              }}
            >
              <Button size="small">Manage</Button>
            </Dropdown>
          </Space.Compact>
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
    {
      title: "Size",
      render: (_, volume) => `${volume.effective_size_gb} GB`,
    },
    {
      title: "Location",
      render: (_, volume) => volume.zone ?? volume.region,
    },
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
        `$${(
          volume.effective_size_gb * Number(volume.monthly_price_per_gb)
        ).toFixed(2)}/month · ${volume.funding_mode}`,
    },
    {
      title: "Actions",
      render: (_, volume) => {
        const attached =
          !!volume.attached_vm_id || volume.attachment_state !== "detached";
        return (
          <Flex gap={4} wrap>
            <Button
              size="small"
              disabled={volume.state !== "ready"}
              onClick={() => setResizeVolumeTarget(volume)}
            >
              Enlarge
            </Button>
            <Button size="small" onClick={() => changeVolumeFunding(volume)}>
              Funding
            </Button>
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
          </Flex>
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
          <Flex align="center" gap={4}>
            <Title level={compact ? 5 : 3} style={{ marginBottom: 0 }}>
              <Icon name="server" /> Virtual machines
            </Title>
            <Popover
              trigger="click"
              title="VMs use your membership's dedicated-host spending limits"
              content={
                <Space direction="vertical" size={10} style={{ maxWidth: 430 }}>
                  <Paragraph style={{ marginBottom: 0 }}>
                    VMs run a minimal Ubuntu 24.04 LTS image; CoCalc and other
                    special software are not installed. Compute, boot disks, and
                    retained home volumes appear in Purchases. The login is{" "}
                    <Text code>user</Text>, whose home is{" "}
                    <Text code>/home/user</Text>.
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    Public Internet egress costs $0.10/GB and appears as one
                    accumulating purchase per VM per calendar month, not a new
                    line item for every meter sample. Usage can take about five
                    minutes to appear.
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    Running VMs stop when funding is unavailable. After
                    authorizing an SSH key, connect with the CoCalc CLI or
                    directly as <Text code>user</Text> at the stable hostname.
                    TCP ports 22 and 443 are public; you manage any HTTPS server
                    and certificate yourself.
                  </Paragraph>
                </Space>
              }
            >
              <Button
                aria-label="Virtual machine help"
                icon={<Icon name="question-circle" />}
                shape="circle"
                size="small"
                type="text"
              />
            </Popover>
          </Flex>
          {!compact && (
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              Short-lived machines owned by you and attached to project{" "}
              <Text code>{shortProjectId(project_id)}</Text>.
            </Paragraph>
          )}
        </div>
        <Space>
          <Button
            icon={<Icon name="book" />}
            onClick={() =>
              openProjectDocs({
                projectId: project_id,
                slug: "projects/virtual-machines",
              })
            }
          >
            Documentation
          </Button>
          <Button
            type="primary"
            icon={<Icon name="plus" />}
            disabled={!catalog || projectSshKeyLoading}
            loading={projectSshKeyLoading}
            onClick={() => {
              setVmInitial(defaultVm());
              setVmCreateError(undefined);
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
      {agentGrants
        .filter((grant) => grant.metadata?.pending_request)
        .map((grant) => {
          const request = grant.metadata.pending_request;
          const details = [
            request.operation ?? request.action,
            request.vm_id ? `VM ${request.vm_id.slice(0, 8)}` : undefined,
            request.provider,
            request.machine_class,
            request.funding_mode,
            Number(request.hourly_usd) > 0
              ? `$${Number(request.hourly_usd).toFixed(3)}/hour maximum`
              : undefined,
            Number(request.total_authorized_usd) > 0
              ? `$${Number(request.total_authorized_usd).toFixed(2)} authorized maximum`
              : undefined,
            Number(request.ttl_minutes) > 0
              ? `${request.ttl_minutes} minute maximum TTL`
              : undefined,
          ].filter(Boolean);
          return (
            <Alert
              key={grant.grant_id}
              showIcon
              type="warning"
              title="Codex requests temporary VM authority"
              description={
                <Space direction="vertical" size={8}>
                  <Text>{details.join(" · ")}</Text>
                  <Text type="secondary">
                    Approval is bound to this project and agent-turn token,
                    expires within 30 minutes, and does not place an account
                    session in the project.
                  </Text>
                  <Space>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => void approveAgentGrant(grant)}
                    >
                      Approve exact request
                    </Button>
                    <Button
                      size="small"
                      onClick={() => void revokeAgentGrant(grant)}
                    >
                      Deny
                    </Button>
                  </Space>
                </Space>
              }
              style={{ marginBottom: 12 }}
            />
          );
        })}
      {agentGrants
        .filter(
          (grant) =>
            !grant.metadata?.pending_request &&
            grant.allowed_actions.some((action) =>
              ["availability", "billable", "destructive"].includes(action),
            ),
        )
        .map((grant) => {
          const request = grant.metadata?.approved_request;
          return (
            <Alert
              key={grant.grant_id}
              showIcon
              type="info"
              title="Codex has temporary VM authority"
              description={
                <Space direction="vertical" size={8}>
                  <Text>
                    {request?.operation ?? grant.allowed_actions.join(", ")}
                    {request?.vm_id
                      ? ` · resource ${request.vm_id.slice(0, 8)}`
                      : ""}
                    {` · expires ${new Date(grant.expires_at).toLocaleTimeString()}`}
                  </Text>
                  <Button
                    size="small"
                    onClick={() => void revokeAgentGrant(grant)}
                  >
                    Revoke now
                  </Button>
                </Space>
              }
              style={{ marginBottom: 12 }}
            />
          );
        })}
      <Table<ComputeVm>
        columns={vmColumns}
        dataSource={rows}
        loading={loading && rows.length === 0}
        locale={{
          emptyText: "No virtual machines are attached to this project.",
        }}
        pagination={false}
        rowKey="id"
        scroll={{ x: 920 }}
        size="small"
      />

      <Flex align="center" justify="space-between" style={{ marginTop: 28 }}>
        <div>
          <Flex align="center" gap={4}>
            <Title level={4} style={{ marginBottom: 0 }}>
              Persistent home volumes
            </Title>
            <Popover
              trigger="click"
              title="About persistent home volumes"
              content={
                <Paragraph style={{ marginBottom: 0, maxWidth: 400 }}>
                  Retained independently from virtual machines. A volume can
                  only be attached at <Text code>/home/user</Text> to a VM from
                  the same provider and location. Select an existing volume or
                  create a new one when creating the VM; changing attachments
                  later is not yet supported.
                </Paragraph>
              }
            >
              <Button
                aria-label="Persistent volume help"
                icon={<Icon name="question-circle" />}
                shape="circle"
                size="small"
                type="text"
              />
            </Popover>
          </Flex>
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
          projectSshPublicKey={projectSshPublicKey}
          sshKeys={sshKeys}
          saving={saving}
          error={vmCreateError}
          preferredR2Region={preferredR2Region}
          onGenerateProjectSshKey={generateProjectSshKey}
          onCancel={() => {
            setVmModalOpen(false);
            setVmCreateError(undefined);
          }}
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
      {catalog && (
        <VolumeResizeModal
          volume={resizeVolumeTarget}
          maxSizeGb={catalog.limits.max_volume_gb}
          saving={saving}
          onCancel={() => setResizeVolumeTarget(undefined)}
          onResize={resizeVolume}
        />
      )}
      <FreshAuthModal {...freshAuthModalProps} />
    </div>
  );
}
