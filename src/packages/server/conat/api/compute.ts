/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import type {
  ComputeCatalog,
  ComputeVolume,
  ComputeVm,
  CreateComputeVolumeRequest,
  CreateComputeVmRequest,
} from "@cocalc/conat/hub/api/compute";
import type { HostCatalogMachineType } from "@cocalc/conat/hub/api/hosts";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { assertComputeProjectAssignedToHost } from "@cocalc/server/compute/host-authorization";
import { requireDangerousSessionAuth } from "./dangerous-session-auth";
import { resolveProjectReferenceAllowRemote } from "@cocalc/server/conat/project-remote-access";
import {
  addComputeVmSshPublicKey,
  appendComputeEvent,
  enqueueComputeWork,
  insertComputeVm,
  listOwnedComputeVms,
  listProjectComputeVms,
  resolveProjectComputeVm,
  resolveOwnedComputeVm,
  updateComputeVm,
} from "@cocalc/server/compute/db";
import type { ComputeVmRow } from "@cocalc/server/compute/types";
import type { ComputeVolumeRow } from "@cocalc/server/compute/types";
import {
  ensureProviderComputeSshAccess,
  getProviderComputeRegions,
  requireProviderComputeSubnetwork,
} from "@cocalc/server/compute/provider";
import { DEFAULT_SPOT_RECOVERY_POLICY } from "@cocalc/server/cloud/spot-restore";
import {
  getComputeVmConfig,
  requireComputeVmCreateAllowed,
  requireComputeVmStartAllowed,
} from "@cocalc/server/compute/config";
import {
  appendComputeVolumeEvent,
  insertComputeVolume,
  listOwnedComputeVolumes,
  listProjectComputeVolumes,
  resolveProjectComputeVolume,
  resolveOwnedComputeVolume,
  updateComputeVolume,
} from "@cocalc/server/compute/volume-db";
import { assertDedicatedHostAdmissionForAccount } from "@cocalc/server/project-host/admission";
import { estimateDedicatedHostRate } from "@cocalc/server/project-host/spend";
import { isSupportedCatalogGcpMachineType } from "@cocalc/util/project-host-pricing";
import { getCatalog as getHostCatalog } from "./hosts";
import {
  defaultComputeZone,
  regionFromComputeZone,
  requireComputeZoneInRegions,
  restrictHostCatalogToRegions,
} from "@cocalc/server/compute/placement";

const MIN_BOOT_DISK_GB = 10;
const MIN_VOLUME_GB = 10;
const HOURS_PER_MONTH = 730;

function requireAccount(accountId?: string) {
  const value = `${accountId ?? ""}`.trim();
  if (!value) throw new Error("must be signed in");
  return value;
}

async function requireProjectMembership(accountId: string, projectId: string) {
  const project = await resolveProjectReferenceAllowRemote({
    account_id: accountId,
    project_id: projectId,
  });
  if (!project) {
    throw Object.assign(new Error("project not found or access denied"), {
      code: 403,
    });
  }
}

function normalizeName(value: string) {
  const name = `${value ?? ""}`.trim();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
    throw new Error(
      "VM name must start with a letter and contain at most 32 lowercase letters, digits, or hyphens",
    );
  }
  return name;
}

function normalizeZone(value: string) {
  const zone = `${value ?? ""}`.trim().toLowerCase();
  if (!/^[a-z]+-[a-z]+\d-[a-z]$/.test(zone)) {
    throw new Error(`invalid GCP zone '${value}'`);
  }
  return zone;
}

function normalizeSshPublicKey(value: string) {
  const key = `${value ?? ""}`.trim();
  if (!key) return "";
  if (!/^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp\d+)\s+\S+/.test(key)) {
    throw new Error("ssh_public_key must be an OpenSSH public key");
  }
  if (key.length > 16_384) throw new Error("ssh_public_key is too large");
  return key;
}

function normalizeIdempotencyKey(value: string) {
  const key = `${value ?? ""}`.trim();
  if (!key || key.length > 200) {
    throw new Error(
      "idempotency_key is required and must be at most 200 bytes",
    );
  }
  return key;
}

function publicVm(vm: ComputeVmRow): ComputeVm {
  const {
    ssh_public_key: _sshPublicKey,
    idempotency_key: _key,
    ...result
  } = vm;
  return {
    ...result,
    private_ip: vm.metadata?.runtime?.private_ip ?? null,
    internal_hostname: vm.metadata?.runtime?.internal_hostname ?? null,
  };
}

function publicVolume(volume: ComputeVolumeRow): ComputeVolume {
  const { idempotency_key: _key, ...result } = volume;
  return result;
}

async function resolveOwned(
  accountId: string,
  idOrName: string,
  includeDeleted = false,
) {
  const vm = await resolveOwnedComputeVm({
    owner_account_id: accountId,
    id_or_name: `${idOrName ?? ""}`.trim(),
    include_deleted: includeDeleted,
  });
  if (!vm) throw new Error(`compute VM '${idOrName}' not found`);
  return vm;
}

async function resolveOwnedVolume(
  accountId: string,
  idOrName: string,
  includeDeleted = false,
) {
  const volume = await resolveOwnedComputeVolume({
    owner_account_id: accountId,
    id_or_name: `${idOrName ?? ""}`.trim(),
    include_deleted: includeDeleted,
  });
  if (!volume) throw new Error(`compute volume '${idOrName}' not found`);
  return volume;
}

function normalizeVolumeName(value: string) {
  const name = `${value ?? ""}`.trim();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) {
    throw new Error(
      "volume name must start with a letter and contain at most 32 lowercase letters, digits, or hyphens",
    );
  }
  return name;
}

function normalizeFundingMode(
  value: unknown,
): "account-prepaid" | "account-postpaid" {
  if (value === "account-prepaid" || value === "account-postpaid") {
    return value;
  }
  throw new Error("funding_mode must be account-prepaid or account-postpaid");
}

async function requireComputeFunding(opts: {
  account_id: string;
  action: "create" | "start" | "resize";
  funding_mode: unknown;
}) {
  const candidates =
    opts.funding_mode == null
      ? (["account-prepaid", "account-postpaid"] as const)
      : ([normalizeFundingMode(opts.funding_mode)] as const);
  let lastError: unknown;
  for (const fundingMode of candidates) {
    try {
      await assertDedicatedHostAdmissionForAccount({
        account_id: opts.account_id,
        action: opts.action,
        machine_cloud: "gcp",
        funding_mode_override: fundingMode,
      });
      return fundingMode;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function machineArchitecture(machineType: string): "arm64" | "x86_64" {
  return machineType.split("-")[0]?.endsWith("a") ? "arm64" : "x86_64";
}

function machineEntries(
  catalog: Awaited<ReturnType<typeof getHostCatalog>>,
  zone: string,
) {
  const payload = catalog.entries.find(
    ({ kind, scope }) => kind === "machine_types" && scope === `zone/${zone}`,
  )?.payload;
  return Array.isArray(payload) ? (payload as HostCatalogMachineType[]) : [];
}

async function getComputeMachine(opts: {
  account_id: string;
  zone: string;
  machine_type: string;
}) {
  const catalog = await getHostCatalog({
    account_id: opts.account_id,
    provider: "gcp",
  });
  const machine = machineEntries(catalog, opts.zone).find(
    ({ name, deprecated }) => name === opts.machine_type && !deprecated,
  );
  if (!machine?.name || !machine.guestCpus || !machine.memoryMb) {
    throw new Error(
      `machine '${opts.machine_type}' is not available in ${opts.zone}`,
    );
  }
  return {
    machine_type: machine.name,
    architecture: machineArchitecture(machine.name),
    cpu: machine.guestCpus,
    ram_gb: machine.memoryMb / 1024,
  };
}

function volumeAuthorization(opts: { size_gb: number; max_volume_gb: number }) {
  const sizeGb = Number(opts.size_gb);
  if (
    !Number.isInteger(sizeGb) ||
    sizeGb < MIN_VOLUME_GB ||
    sizeGb > opts.max_volume_gb
  ) {
    throw new Error(
      `size_gb must be an integer from ${MIN_VOLUME_GB} to ${opts.max_volume_gb}`,
    );
  }
  return sizeGb;
}

export async function getCatalog(opts: {
  account_id?: string;
}): Promise<ComputeCatalog> {
  const accountId = requireAccount(opts.account_id);
  const config = await getComputeVmConfig();
  const configuredRegions = await getProviderComputeRegions();
  const catalog = restrictHostCatalogToRegions(
    await getHostCatalog({
      account_id: accountId,
      provider: "gcp",
    }),
    configuredRegions,
  );
  const zone = defaultComputeZone(catalog);
  return {
    host_catalog: catalog,
    defaults: {
      zone,
      machine_type: "e2-standard-2",
      ttl_minutes: null,
      boot_disk_gb: 20,
    },
    limits: {
      max_active_per_project: config.max_active_per_project,
      max_ttl_minutes: config.max_ttl_minutes,
      max_boot_disk_gb: config.max_boot_disk_gb,
      max_volume_gb: config.max_volume_gb,
    },
  };
}

export async function createVm(opts: CreateComputeVmRequest) {
  const accountId = requireAccount(opts.account_id);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  await requireProjectMembership(accountId, opts.project_id);
  const fundingMode = await requireComputeFunding({
    account_id: accountId,
    action: "create",
    funding_mode: opts.funding_mode,
  });

  const name = normalizeName(opts.name);
  const zone = normalizeZone(opts.zone);
  const configuredRegions = await getProviderComputeRegions();
  requireComputeZoneInRegions(zone, configuredRegions);
  await requireProviderComputeSubnetwork(zone);
  let attachedVolume = opts.volume
    ? await resolveOwnedVolume(accountId, opts.volume)
    : undefined;
  if (attachedVolume && attachedVolume.zone !== zone) {
    throw new Error(
      `compute volume '${attachedVolume.name}' is in ${attachedVolume.zone}; create the VM in the same zone`,
    );
  }
  if (
    attachedVolume?.project_id &&
    attachedVolume.project_id !== opts.project_id
  ) {
    throw new Error(
      `compute volume '${attachedVolume.name}' belongs to a different project`,
    );
  }
  if (attachedVolume && !attachedVolume.project_id) {
    attachedVolume = (await updateComputeVolume(attachedVolume.id, {
      project_id: opts.project_id,
    }))!;
  }
  const machine = await getComputeMachine({
    account_id: accountId,
    zone,
    machine_type: opts.machine_type,
  });
  if (
    !isSupportedCatalogGcpMachineType(machine.machine_type) ||
    machine.machine_type.startsWith("g2-") ||
    machine.ram_gb < 8
  ) {
    throw new Error(
      `machine_type '${machine.machine_type}' is not supported for managed compute VMs`,
    );
  }
  const pricingModel = opts.pricing_model;
  if (pricingModel !== "spot" && pricingModel !== "on_demand") {
    throw new Error("pricing_model must be spot or on_demand");
  }
  const ttlMinutes =
    opts.ttl_minutes == null ? undefined : Number(opts.ttl_minutes);
  if (
    ttlMinutes != null &&
    (!Number.isInteger(ttlMinutes) ||
      ttlMinutes < 5 ||
      ttlMinutes > config.max_ttl_minutes)
  ) {
    throw new Error(
      `ttl_minutes must be an integer from 5 to ${config.max_ttl_minutes}`,
    );
  }
  const bootDiskGb = Number(opts.boot_disk_gb ?? 20);
  if (
    !Number.isInteger(bootDiskGb) ||
    bootDiskGb < MIN_BOOT_DISK_GB ||
    bootDiskGb > config.max_boot_disk_gb
  ) {
    throw new Error(
      `boot_disk_gb must be an integer from ${MIN_BOOT_DISK_GB} to ${config.max_boot_disk_gb}`,
    );
  }
  const rateInput = {
    provider: "gcp",
    region: regionFromComputeZone(zone),
    zone,
    machine_type: machine.machine_type,
    disk_gb: bootDiskGb,
    disk_type: "balanced",
  } as const;
  const [spotRate, onDemandRate, stoppedRate] = await Promise.all([
    estimateDedicatedHostRate({
      ...rateInput,
      pricing_model: "spot",
      billing_state: "running",
    }),
    estimateDedicatedHostRate({
      ...rateInput,
      pricing_model: "on_demand",
      billing_state: "running",
    }),
    estimateDedicatedHostRate({
      ...rateInput,
      pricing_model: pricingModel,
      billing_state: "stopped",
    }),
  ]);
  if (!spotRate || !onDemandRate || !stoppedRate) {
    throw new Error(
      `pricing is unavailable for ${machine.machine_type} in ${regionFromComputeZone(zone)}`,
    );
  }
  const allowOnDemandFallback =
    pricingModel === "spot" && opts.allow_on_demand_fallback === true;
  const authorizedFallbackHours = allowOnDemandFallback ? 24 : 0;
  const id = randomUUID();
  const sshPublicKey = normalizeSshPublicKey(opts.ssh_public_key ?? "");
  const providerInstanceId = `cocalc-vm-${id.replaceAll("-", "").slice(0, 24)}`;
  const vm = await insertComputeVm(
    {
      id,
      name,
      owner_account_id: accountId,
      owning_bay_id: getConfiguredBayId(),
      project_id: opts.project_id,
      provider: "gcp",
      region: regionFromComputeZone(zone),
      zone,
      architecture: machine.architecture,
      machine_type: machine.machine_type,
      desired_pricing_model: pricingModel,
      effective_pricing_model: pricingModel,
      boot_disk_gb: bootDiskGb,
      boot_disk_id: `${providerInstanceId}-boot`,
      attached_volume_id: attachedVolume?.id ?? null,
      state: "requested",
      desired_state: "running",
      instance_generation: 1,
      provider_instance_id: providerInstanceId,
      public_ip: null,
      ssh_user: "ubuntu",
      ssh_public_key: sshPublicKey,
      expires_at:
        ttlMinutes == null ? null : new Date(Date.now() + ttlMinutes * 60_000),
      allow_on_demand_fallback: allowOnDemandFallback,
      authorized_fallback_hours: authorizedFallbackHours,
      spot_hourly_price: `${spotRate.hourly_cost_usd}`,
      on_demand_hourly_price: `${onDemandRate.hourly_cost_usd}`,
      authorized_cost: "0.000000",
      accrued_cost: "0.000000",
      billing_state: "pending",
      spot_recovery_policy: {
        ...DEFAULT_SPOT_RECOVERY_POLICY,
        standard_fallback_enabled: allowOnDemandFallback,
      },
      spot_recovery_state: { phase: "idle" },
      idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
      error: null,
      metadata: {
        machine: { cpu: machine.cpu, ram_gb: machine.ram_gb },
        ssh_public_keys: sshPublicKey ? [sshPublicKey] : [],
        provider_context: config.staging_legacy_provider
          ? "project-host-provider-context"
          : "dedicated-compute-provider-context",
        price_snapshot_kind: "dedicated-host-catalog",
        max_ttl_minutes: config.max_ttl_minutes,
        billing: {
          funding_mode: fundingMode,
          running_rates: {
            spot: spotRate,
            on_demand: onDemandRate,
          },
          stopped_rate: stoppedRate,
        },
      },
    },
    {
      max_active_per_project: config.max_active_per_project,
      max_active_total: config.max_active_total,
    },
  );
  await appendComputeEvent({
    vm,
    actor_account_id: accountId,
    actor_kind: "human",
    action: "create",
    idempotency_key: opts.idempotency_key,
    new_state: vm.state,
    status: "requested",
    details: {
      machine_type: vm.machine_type,
      pricing_model: vm.desired_pricing_model,
      expires_at: vm.expires_at,
      funding_mode: fundingMode,
      attached_volume_id: vm.attached_volume_id,
    },
  });
  await enqueueComputeWork({
    resource_id: vm.id,
    action: "provision",
    idempotency_key: `provision:${vm.id}:1`,
  });
  return publicVm(vm);
}

export async function createVolume(opts: CreateComputeVolumeRequest) {
  const accountId = requireAccount(opts.account_id);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  await requireProjectMembership(accountId, opts.project_id);
  const fundingMode = await requireComputeFunding({
    account_id: accountId,
    action: "create",
    funding_mode: opts.funding_mode,
  });
  const name = normalizeVolumeName(opts.name);
  const zone = normalizeZone(opts.zone);
  const configuredRegions = await getProviderComputeRegions();
  requireComputeZoneInRegions(zone, configuredRegions);
  await requireProviderComputeSubnetwork(zone);
  const sizeGb = volumeAuthorization({
    size_gb: opts.size_gb,
    max_volume_gb: config.max_volume_gb,
  });
  const volumeRate = await estimateDedicatedHostRate({
    provider: "gcp",
    region: regionFromComputeZone(zone),
    zone,
    machine_type: "e2-standard-2",
    pricing_model: "on_demand",
    disk_gb: sizeGb,
    disk_type: "balanced",
    billing_state: "stopped",
  });
  if (!volumeRate) {
    throw new Error(
      `storage pricing is unavailable in ${regionFromComputeZone(zone)}`,
    );
  }
  const monthlyCost = Number(volumeRate.hourly_cost_usd) * HOURS_PER_MONTH;
  const id = randomUUID();
  const volume = await insertComputeVolume(
    {
      id,
      name,
      owner_account_id: accountId,
      owning_bay_id: getConfiguredBayId(),
      project_id: opts.project_id,
      provider: "gcp",
      region: regionFromComputeZone(zone),
      zone,
      disk_type: "balanced",
      filesystem: "ext4",
      size_gb: sizeGb,
      desired_size_gb: sizeGb,
      provider_disk_id: `cocalc-vol-${id.replaceAll("-", "").slice(0, 24)}`,
      state: "requested",
      desired_state: "ready",
      attached_vm_id: null,
      attachment_generation: 0,
      attachment_state: "detached",
      monthly_price_per_gb: (monthlyCost / sizeGb).toFixed(6),
      authorized_monthly_cost: monthlyCost.toFixed(6),
      billing_state: "pending",
      idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
      error: null,
      metadata: {
        provider_context: config.staging_legacy_provider
          ? "project-host-provider-context"
          : "dedicated-compute-provider-context",
        price_snapshot_kind: "dedicated-host-catalog",
        billing: { funding_mode: fundingMode, rate: volumeRate },
      },
    },
    config.max_volumes_per_account,
  );
  await appendComputeVolumeEvent({
    volume,
    actor_account_id: accountId,
    actor_kind: "human",
    action: "create",
    idempotency_key: opts.idempotency_key,
    new_state: volume.state,
    status: "requested",
    details: {
      size_gb: volume.size_gb,
      funding_mode: fundingMode,
    },
  });
  await enqueueComputeWork({
    resource_kind: "volume",
    resource_id: volume.id,
    action: "provision_volume",
    idempotency_key: `provision-volume:${volume.id}`,
  });
  return publicVolume(volume);
}

export async function listVolumes(opts: {
  account_id?: string;
  project_id?: string;
  include_deleted?: boolean;
}) {
  const accountId = requireAccount(opts.account_id);
  return (
    await listOwnedComputeVolumes({
      owner_account_id: accountId,
      project_id: opts.project_id,
      include_deleted: opts.include_deleted,
    })
  ).map(publicVolume);
}

export async function getVolume(opts: {
  account_id?: string;
  id_or_name: string;
}) {
  const accountId = requireAccount(opts.account_id);
  return publicVolume(
    await resolveOwnedVolume(accountId, opts.id_or_name, true),
  );
}

export async function resizeVolume(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  id_or_name: string;
  size_gb: number;
  funding_mode?: "account-prepaid" | "account-postpaid";
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  const volume = await resolveOwnedVolume(accountId, opts.id_or_name);
  const fundingMode = await requireComputeFunding({
    account_id: accountId,
    action: "resize",
    funding_mode: opts.funding_mode,
  });
  const sizeGb = volumeAuthorization({
    size_gb: opts.size_gb,
    max_volume_gb: config.max_volume_gb,
  });
  if (sizeGb < volume.size_gb) {
    throw new Error("compute volumes cannot be shrunk");
  }
  const volumeRate = await estimateDedicatedHostRate({
    provider: "gcp",
    region: volume.region,
    zone: volume.zone,
    machine_type: "e2-standard-2",
    pricing_model: "on_demand",
    disk_gb: sizeGb,
    disk_type: "balanced",
    billing_state: "stopped",
  });
  if (!volumeRate)
    throw new Error(`storage pricing is unavailable in ${volume.region}`);
  const monthlyCost = Number(volumeRate.hourly_cost_usd) * HOURS_PER_MONTH;
  const next = (await updateComputeVolume(volume.id, {
    desired_size_gb: sizeGb,
    monthly_price_per_gb: (monthlyCost / sizeGb).toFixed(6),
    authorized_monthly_cost: monthlyCost.toFixed(6),
    state: sizeGb === volume.size_gb ? volume.state : "resizing",
    error: null,
    metadata: {
      ...volume.metadata,
      billing: { funding_mode: fundingMode, rate: volumeRate },
    },
  }))!;
  await appendComputeVolumeEvent({
    volume: next,
    actor_account_id: accountId,
    actor_kind: "human",
    action: "resize",
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    old_state: volume.state,
    new_state: next.state,
    status: "requested",
    details: { old_size_gb: volume.size_gb, desired_size_gb: sizeGb },
  });
  if (sizeGb > volume.size_gb) {
    await enqueueComputeWork({
      resource_kind: "volume",
      resource_id: volume.id,
      action: "resize_volume",
      idempotency_key: opts.idempotency_key,
    });
  }
  return publicVolume(next);
}

export async function deleteVolume(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  id_or_name: string;
  confirm_name: string;
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  const volume = await resolveOwnedVolume(accountId, opts.id_or_name);
  if (`${opts.confirm_name ?? ""}` !== volume.name) {
    throw new Error(`confirm_name must exactly equal '${volume.name}'`);
  }
  if (volume.attached_vm_id || volume.attachment_state !== "detached") {
    throw new Error("cannot delete an attached or uncertain compute volume");
  }
  const next = (await updateComputeVolume(volume.id, {
    desired_state: "deleted",
    state: "deleting",
    error: null,
  }))!;
  await appendComputeVolumeEvent({
    volume: next,
    actor_account_id: accountId,
    actor_kind: "human",
    action: "delete",
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    old_state: volume.state,
    new_state: "deleting",
    status: "requested",
  });
  await enqueueComputeWork({
    resource_kind: "volume",
    resource_id: volume.id,
    action: "delete_volume",
    idempotency_key: opts.idempotency_key,
  });
  return publicVolume(next);
}

export async function listVms(opts: {
  account_id?: string;
  project_id?: string;
  include_deleted?: boolean;
}) {
  const accountId = requireAccount(opts.account_id);
  const rows = await listOwnedComputeVms({
    owner_account_id: accountId,
    project_id: opts.project_id,
    include_deleted: opts.include_deleted,
  });
  return rows.map(publicVm);
}

export async function listProjectVms(opts: {
  host_id?: string;
  project_id?: string;
  include_deleted?: boolean;
}) {
  const projectId = await requireComputeProjectReadIdentity(opts);
  return (
    await listProjectComputeVms({
      project_id: projectId,
      include_deleted: opts.include_deleted,
    })
  ).map(publicVm);
}

export async function getVm(opts: { account_id?: string; id_or_name: string }) {
  const accountId = requireAccount(opts.account_id);
  return publicVm(await resolveOwned(accountId, opts.id_or_name, true));
}

export async function getProjectVm(opts: {
  host_id?: string;
  project_id?: string;
  id_or_name: string;
}) {
  const projectId = await requireComputeProjectReadIdentity(opts);
  const vm = await resolveProjectComputeVm({
    project_id: projectId,
    id_or_name: `${opts.id_or_name ?? ""}`.trim(),
    include_deleted: true,
  });
  if (!vm) throw new Error(`compute VM '${opts.id_or_name}' not found`);
  return publicVm(vm);
}

export async function listProjectVolumes(opts: {
  host_id?: string;
  project_id?: string;
  include_deleted?: boolean;
}) {
  const projectId = await requireComputeProjectReadIdentity(opts);
  return (
    await listProjectComputeVolumes({
      project_id: projectId,
      include_deleted: opts.include_deleted,
    })
  ).map(publicVolume);
}

export async function getProjectVolume(opts: {
  host_id?: string;
  project_id?: string;
  id_or_name: string;
}) {
  const projectId = await requireComputeProjectReadIdentity(opts);
  const volume = await resolveProjectComputeVolume({
    project_id: projectId,
    id_or_name: `${opts.id_or_name ?? ""}`.trim(),
    include_deleted: true,
  });
  if (!volume) throw new Error(`compute volume '${opts.id_or_name}' not found`);
  return publicVolume(volume);
}

async function requireComputeProjectReadIdentity(opts: {
  host_id?: string;
  project_id?: string;
}): Promise<string> {
  const projectId = `${opts.project_id ?? ""}`.trim();
  if (!projectId) throw new Error("must be a project");
  const hostId = `${opts.host_id ?? ""}`.trim();
  if (hostId) {
    await assertComputeProjectAssignedToHost({
      project_id: projectId,
      host_id: hostId,
      bay_id: getConfiguredBayId(),
    });
  }
  return projectId;
}

export async function authorizeSshKey(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  id_or_name: string;
  ssh_public_key: string;
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  const key = normalizeSshPublicKey(opts.ssh_public_key);
  if (!key) throw new Error("ssh_public_key is required");
  const vm = await resolveOwned(accountId, opts.id_or_name);
  return await authorizeSshKeyForVm({
    vm,
    key,
    idempotency_key: opts.idempotency_key,
    actor_account_id: accountId,
    actor_kind: "human",
    beforeAdd: async () => {
      await requireDangerousSessionAuth({
        account_id: accountId,
        browser_id: opts.browser_id,
        session_hash: opts.session_hash,
        require_second_factor: "if_enabled",
      });
    },
  });
}

async function authorizeSshKeyForVm(opts: {
  vm: ComputeVmRow;
  key: string;
  idempotency_key: string;
  actor_account_id?: string;
  actor_kind: "human" | "project";
  beforeAdd?: () => Promise<void>;
}) {
  const { vm, key } = opts;
  if (vm.state !== "ready" || !vm.public_ip) {
    throw new Error(
      `compute VM '${vm.name}' is not SSH-ready (state=${vm.state})`,
    );
  }
  const existingKeys = Array.from(
    new Set(
      [
        vm.ssh_public_key,
        ...(Array.isArray(vm.metadata?.ssh_public_keys)
          ? vm.metadata.ssh_public_keys
          : []),
      ]
        .map((value) => `${value ?? ""}`.trim())
        .filter(Boolean),
    ),
  );
  let next = vm;
  let added = false;
  if (!existingKeys.includes(key)) {
    await opts.beforeAdd?.();
    const result = await addComputeVmSshPublicKey({
      id: vm.id,
      owner_account_id: vm.owner_account_id,
      ssh_public_key: key,
    });
    next = result.vm;
    added = result.added;
  }
  await ensureProviderComputeSshAccess(next);
  if (added) {
    const authorizedKeyCount = Array.isArray(next.metadata?.ssh_public_keys)
      ? next.metadata.ssh_public_keys.length
      : 1;
    await appendComputeEvent({
      vm: next,
      actor_account_id: opts.actor_account_id,
      actor_kind: opts.actor_kind,
      action: "authorize_ssh_key",
      idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
      old_state: vm.state,
      new_state: next.state,
      status: "completed",
      details: { authorized_key_count: authorizedKeyCount },
    });
  }
  return publicVm(next);
}

export async function authorizeProjectSshKey(opts: {
  project_id?: string;
  id_or_name: string;
  ssh_public_key: string;
  idempotency_key: string;
}) {
  const projectId = `${opts.project_id ?? ""}`.trim();
  if (!projectId) throw new Error("must be a project");
  const key = normalizeSshPublicKey(opts.ssh_public_key);
  if (!key) throw new Error("ssh_public_key is required");
  const vm = await resolveProjectComputeVm({
    project_id: projectId,
    id_or_name: `${opts.id_or_name ?? ""}`.trim(),
  });
  if (!vm) throw new Error(`compute VM '${opts.id_or_name}' not found`);
  return await authorizeSshKeyForVm({
    vm,
    key,
    idempotency_key: opts.idempotency_key,
    actor_kind: "project",
  });
}

export async function authorizeProjectSshKeyFromHost(opts: {
  host_id?: string;
  project_id: string;
  id_or_name: string;
  ssh_public_key: string;
  idempotency_key: string;
}) {
  const hostId = `${opts.host_id ?? ""}`.trim();
  const projectId = `${opts.project_id ?? ""}`.trim();
  if (!hostId) throw new Error("must be a host");
  if (!projectId) throw new Error("project_id is required");
  await assertComputeProjectAssignedToHost({
    project_id: projectId,
    host_id: hostId,
    bay_id: getConfiguredBayId(),
  });
  return await authorizeProjectSshKey({
    project_id: projectId,
    id_or_name: opts.id_or_name,
    ssh_public_key: opts.ssh_public_key,
    idempotency_key: opts.idempotency_key,
  });
}

async function requestState(opts: {
  account_id?: string;
  id_or_name: string;
  idempotency_key: string;
  desired_state: "running" | "stopped";
}) {
  const accountId = requireAccount(opts.account_id);
  if (opts.desired_state === "running") {
    requireComputeVmStartAllowed(await getComputeVmConfig(), accountId);
  }
  const vm = await resolveOwned(accountId, opts.id_or_name);
  if (opts.desired_state === "running") {
    await requireComputeFunding({
      account_id: accountId,
      action: "start",
      funding_mode: vm.metadata?.billing?.funding_mode,
    });
  }
  if (vm.expires_at && vm.expires_at.valueOf() <= Date.now()) {
    throw new Error("compute VM lease has expired");
  }
  const action = opts.desired_state === "running" ? "start" : "stop";
  const next = (await updateComputeVm(vm.id, {
    desired_state: opts.desired_state,
    state: opts.desired_state === "running" ? "starting" : "stopping",
    error: null,
  }))!;
  await appendComputeEvent({
    vm: next,
    actor_account_id: accountId,
    actor_kind: "human",
    action,
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    old_state: vm.state,
    new_state: next.state,
    status: "requested",
  });
  await enqueueComputeWork({
    resource_id: vm.id,
    action,
    idempotency_key: opts.idempotency_key,
  });
  return publicVm(next);
}

export async function startVm(opts: {
  account_id?: string;
  id_or_name: string;
  idempotency_key: string;
}) {
  return await requestState({ ...opts, desired_state: "running" });
}

export async function stopVm(opts: {
  account_id?: string;
  id_or_name: string;
  idempotency_key: string;
}) {
  return await requestState({ ...opts, desired_state: "stopped" });
}

export async function setVmTtl(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  id_or_name: string;
  ttl_minutes?: number | null;
  extend_minutes?: number;
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  const config = await getComputeVmConfig();
  const vm = await resolveOwned(accountId, opts.id_or_name);
  if (vm.desired_state === "deleted" || vm.state === "deleting") {
    throw new Error("cannot change the TTL of a deleting VM");
  }
  if (vm.expires_at && vm.expires_at.valueOf() <= Date.now()) {
    throw new Error("cannot change the TTL of an expired VM");
  }
  const hasTtl = Object.prototype.hasOwnProperty.call(opts, "ttl_minutes");
  const hasExtension = opts.extend_minutes != null;
  if (hasTtl === hasExtension) {
    throw new Error("specify exactly one of ttl_minutes or extend_minutes");
  }

  let expiresAt: Date | null;
  if (hasExtension) {
    const minutes = Number(opts.extend_minutes);
    if (!Number.isInteger(minutes) || minutes < 1) {
      throw new Error("extend_minutes must be a positive integer");
    }
    if (!vm.expires_at) {
      throw new Error("this VM has no TTL; use ttl_minutes to set one");
    }
    expiresAt = new Date(vm.expires_at.valueOf() + minutes * 60_000);
  } else if (opts.ttl_minutes == null) {
    expiresAt = null;
  } else {
    const minutes = Number(opts.ttl_minutes);
    if (!Number.isInteger(minutes) || minutes < 5) {
      throw new Error("ttl_minutes must be null or an integer of at least 5");
    }
    expiresAt = new Date(Date.now() + minutes * 60_000);
  }
  if (
    expiresAt &&
    expiresAt.valueOf() > Date.now() + config.max_ttl_minutes * 60_000
  ) {
    throw new Error(
      `the resulting TTL must be at most ${config.max_ttl_minutes} minutes from now`,
    );
  }

  const increasesExposure =
    expiresAt == null ||
    vm.expires_at == null ||
    expiresAt.valueOf() > vm.expires_at.valueOf();
  if (increasesExposure) {
    await requireComputeFunding({
      account_id: accountId,
      action: "start",
      funding_mode: vm.metadata?.billing?.funding_mode,
    });
  }

  const next = (await updateComputeVm(vm.id, { expires_at: expiresAt }))!;
  await appendComputeEvent({
    vm: next,
    actor_account_id: accountId,
    actor_kind: "human",
    action: "set_ttl",
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    old_state: vm.state,
    new_state: next.state,
    status: "completed",
    details: {
      previous_expires_at: vm.expires_at ?? null,
      expires_at: expiresAt,
      extend_minutes: opts.extend_minutes ?? null,
    },
  });
  return publicVm(next);
}

export async function deleteVm(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  id_or_name: string;
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  const vm = await resolveOwned(accountId, opts.id_or_name);
  const next = (await updateComputeVm(vm.id, {
    desired_state: "deleted",
    state: "deleting",
  }))!;
  await appendComputeEvent({
    vm: next,
    actor_account_id: accountId,
    actor_kind: "human",
    action: "delete",
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    old_state: vm.state,
    new_state: "deleting",
    status: "requested",
  });
  await enqueueComputeWork({
    resource_id: vm.id,
    action: "delete",
    idempotency_key: opts.idempotency_key,
  });
  return publicVm(next);
}
