/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import type {
  ComputeVolume,
  ComputeVm,
  CreateComputeVolumeRequest,
  CreateComputeVmRequest,
} from "@cocalc/conat/hub/api/compute";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { requireDangerousSessionAuth } from "./dangerous-session-auth";
import { resolveProjectReferenceAllowRemote } from "@cocalc/server/conat/project-remote-access";
import {
  appendComputeEvent,
  enqueueComputeWork,
  insertComputeVm,
  listOwnedComputeVms,
  resolveOwnedComputeVm,
  updateComputeVm,
} from "@cocalc/server/compute/db";
import {
  COMPUTE_MACHINE_CATALOG,
  getComputeMachine,
} from "@cocalc/server/compute/catalog";
import type { ComputeVmRow } from "@cocalc/server/compute/types";
import type { ComputeVolumeRow } from "@cocalc/server/compute/types";
import { DEFAULT_SPOT_RECOVERY_POLICY } from "@cocalc/server/cloud/spot-restore";
import { computeLeaseAuthorization } from "@cocalc/server/compute/pricing";
import {
  getComputeVmConfig,
  requireComputeVmCreateAllowed,
  requireComputeVmStartAllowed,
} from "@cocalc/server/compute/config";
import {
  appendComputeVolumeEvent,
  insertComputeVolume,
  listOwnedComputeVolumes,
  resolveOwnedComputeVolume,
  updateComputeVolume,
} from "@cocalc/server/compute/volume-db";
import {
  getComputeProjectBudgetSummary,
  setComputeProjectBudget,
} from "@cocalc/server/compute/budget-db";
import type { ComputeBudgetPeriod } from "@cocalc/server/compute/types";

const MIN_BOOT_DISK_GB = 10;
const MIN_VOLUME_GB = 10;
const BALANCED_DISK_MONTHLY_USD_PER_GB = 0.1;

function requireAccount(accountId?: string) {
  const value = `${accountId ?? ""}`.trim();
  if (!value) throw new Error("must be signed in");
  return value;
}

async function requireStagingAdmin(accountId: string) {
  if (!(await isAdmin(accountId))) {
    throw Object.assign(
      new Error("managed compute VM CLI is currently staging-admin-only"),
      { code: 403 },
    );
  }
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

function regionFromZone(zone: string) {
  return zone.replace(/-[a-z]$/, "");
}

function normalizeSshPublicKey(value: string) {
  const key = `${value ?? ""}`.trim();
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
  return result;
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

function volumeAuthorization(opts: {
  size_gb: number;
  authorized_monthly_cost?: string;
  max_volume_gb: number;
  budget_remaining_usd?: number;
  budget_period?: ComputeBudgetPeriod;
}) {
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
  const minimumMonthlyCost = sizeGb * BALANCED_DISK_MONTHLY_USD_PER_GB;
  const budgetPeriodCost =
    opts.budget_period === "week"
      ? (minimumMonthlyCost * 12) / 52
      : minimumMonthlyCost;
  if (
    opts.authorized_monthly_cost == null &&
    opts.budget_remaining_usd == null
  ) {
    throw new Error(
      "set a project compute budget or provide authorized_monthly_cost",
    );
  }
  if (
    opts.budget_remaining_usd != null &&
    opts.budget_remaining_usd < budgetPeriodCost
  ) {
    throw new Error(
      `project compute budget has ${opts.budget_remaining_usd.toFixed(2)} USD remaining, but this volume requires about ${budgetPeriodCost.toFixed(2)} USD per ${opts.budget_period}`,
    );
  }
  const authorizedMonthlyCost =
    opts.authorized_monthly_cost == null
      ? minimumMonthlyCost
      : Number(opts.authorized_monthly_cost);
  if (
    !Number.isFinite(authorizedMonthlyCost) ||
    authorizedMonthlyCost < minimumMonthlyCost
  ) {
    throw new Error(
      `authorized_monthly_cost must be at least ${minimumMonthlyCost.toFixed(2)} USD for ${sizeGb} GB`,
    );
  }
  const maximumMonthlyCost =
    opts.max_volume_gb * BALANCED_DISK_MONTHLY_USD_PER_GB;
  if (authorizedMonthlyCost > maximumMonthlyCost) {
    throw new Error(
      `authorized_monthly_cost must not exceed ${maximumMonthlyCost.toFixed(2)} USD for this canary`,
    );
  }
  return { sizeGb, authorizedMonthlyCost };
}

async function budgetForAdmission(accountId: string, projectId: string) {
  const budget = await getComputeProjectBudgetSummary({
    owner_account_id: accountId,
    project_id: projectId,
  });
  return budget?.enabled ? budget : undefined;
}

export async function getCatalog(opts: { account_id?: string }) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  const config = await getComputeVmConfig();
  return {
    machines: Object.values(COMPUTE_MACHINE_CATALOG).filter(
      ({ cpu }) => cpu <= config.max_vcpus,
    ),
    defaults: {
      zone: "us-central1-a",
      machine_type: "e2-standard-2",
      ttl_minutes: 30,
      boot_disk_gb: 20,
    },
    limits: {
      max_ttl_minutes: config.max_ttl_minutes,
      max_boot_disk_gb: config.max_boot_disk_gb,
      max_volume_gb: config.max_volume_gb,
    },
  };
}

export async function getProjectBudget(opts: {
  account_id?: string;
  project_id: string;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  await requireProjectMembership(accountId, opts.project_id);
  return (
    (await getComputeProjectBudgetSummary({
      owner_account_id: accountId,
      project_id: opts.project_id,
    })) ?? null
  );
}

export async function setProjectBudget(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  project_id: string;
  period: ComputeBudgetPeriod;
  limit_usd: string;
  enabled?: boolean;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  await requireProjectMembership(accountId, opts.project_id);
  if (opts.period !== "week" && opts.period !== "month") {
    throw new Error("compute budget period must be week or month");
  }
  const limitUsd = Number(opts.limit_usd);
  if (
    !Number.isFinite(limitUsd) ||
    limitUsd <= 0 ||
    limitUsd > config.max_project_budget_usd
  ) {
    throw new Error(
      `compute budget must be greater than zero and at most ${config.max_project_budget_usd.toFixed(2)} USD`,
    );
  }
  const budget = await setComputeProjectBudget({
    owner_account_id: accountId,
    owning_bay_id: getConfiguredBayId(),
    project_id: opts.project_id,
    period: opts.period,
    limit_usd: limitUsd,
    enabled: opts.enabled,
  });
  const summary = await getComputeProjectBudgetSummary({
    owner_account_id: budget.owner_account_id,
    project_id: budget.project_id,
  });
  if (!summary) throw new Error("compute project budget was not persisted");
  return summary;
}

export async function createVm(opts: CreateComputeVmRequest) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  await requireProjectMembership(accountId, opts.project_id);

  const name = normalizeName(opts.name);
  const zone = normalizeZone(opts.zone);
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
      `compute volume '${attachedVolume.name}' belongs to a different project budget`,
    );
  }
  if (attachedVolume && !attachedVolume.project_id) {
    attachedVolume = (await updateComputeVolume(attachedVolume.id, {
      project_id: opts.project_id,
    }))!;
  }
  const machine = getComputeMachine(opts.machine_type);
  if (machine.cpu > config.max_vcpus) {
    throw new Error(
      `machine_type exceeds the ${config.max_vcpus} vCPU managed compute VM limit`,
    );
  }
  const pricingModel = opts.pricing_model;
  if (pricingModel !== "spot" && pricingModel !== "on_demand") {
    throw new Error("pricing_model must be spot or on_demand");
  }
  const ttlMinutes = Number(opts.ttl_minutes);
  if (
    !Number.isInteger(ttlMinutes) ||
    ttlMinutes < 5 ||
    ttlMinutes > config.max_ttl_minutes
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
  const { authorizedFallbackHours, maximumCostUsd } = computeLeaseAuthorization(
    {
      pricingModel,
      allowOnDemandFallback: opts.allow_on_demand_fallback === true,
      ttlMinutes,
      spotHourlyUsd: machine.spot_hourly_usd,
      onDemandHourlyUsd: machine.on_demand_hourly_usd,
    },
  );
  const budget = await budgetForAdmission(accountId, opts.project_id);
  if (budget && Number(budget.remaining_usd) < maximumCostUsd) {
    throw new Error(
      `project compute budget has ${Number(budget.remaining_usd).toFixed(2)} USD remaining, but this lease can cost up to ${maximumCostUsd.toFixed(2)} USD`,
    );
  }
  const authorizedCost =
    opts.authorized_cost == null
      ? budget
        ? maximumCostUsd
        : Number.NaN
      : Number(opts.authorized_cost);
  if (!Number.isFinite(authorizedCost) || authorizedCost < maximumCostUsd) {
    throw new Error(
      `set a project compute budget or provide authorized_cost of at least ${maximumCostUsd.toFixed(4)} USD for this staging lease`,
    );
  }
  if (authorizedCost > config.max_authorized_cost_usd) {
    throw new Error(
      `authorized_cost must not exceed ${config.max_authorized_cost_usd.toFixed(2)} USD for this canary`,
    );
  }
  const id = randomUUID();
  const providerInstanceId = `cocalc-vm-${id.replaceAll("-", "").slice(0, 24)}`;
  const vm = await insertComputeVm(
    {
      id,
      name,
      owner_account_id: accountId,
      owning_bay_id: getConfiguredBayId(),
      project_id: opts.project_id,
      provider: "gcp",
      region: regionFromZone(zone),
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
      ssh_public_key: normalizeSshPublicKey(opts.ssh_public_key),
      expires_at: new Date(Date.now() + ttlMinutes * 60_000),
      allow_on_demand_fallback: opts.allow_on_demand_fallback === true,
      authorized_fallback_hours: authorizedFallbackHours,
      spot_hourly_price: machine.spot_hourly_usd.toFixed(6),
      on_demand_hourly_price: machine.on_demand_hourly_usd.toFixed(6),
      authorized_cost: authorizedCost.toFixed(6),
      accrued_cost: "0.000000",
      billing_state: `${config.environment}_admin_unbilled`,
      spot_recovery_policy: {
        ...DEFAULT_SPOT_RECOVERY_POLICY,
        standard_fallback_enabled: opts.allow_on_demand_fallback === true,
      },
      spot_recovery_state: { phase: "idle" },
      idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
      error: null,
      metadata: {
        provider_context: config.staging_legacy_provider
          ? "project-host-provider-context"
          : "dedicated-compute-provider-context",
        price_snapshot_kind: `${config.environment}-static-unbilled`,
        max_ttl_minutes: config.max_ttl_minutes,
      },
    },
    {
      max_active_per_account: config.max_active_per_account,
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
      authorized_cost: vm.authorized_cost,
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
  await requireStagingAdmin(accountId);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  if (opts.project_id) {
    await requireProjectMembership(accountId, opts.project_id);
  }
  const name = normalizeVolumeName(opts.name);
  const zone = normalizeZone(opts.zone);
  const budget = opts.project_id
    ? await budgetForAdmission(accountId, opts.project_id)
    : undefined;
  const { sizeGb, authorizedMonthlyCost } = volumeAuthorization({
    size_gb: opts.size_gb,
    authorized_monthly_cost: opts.authorized_monthly_cost,
    max_volume_gb: config.max_volume_gb,
    budget_remaining_usd: budget ? Number(budget.remaining_usd) : undefined,
    budget_period: budget?.period,
  });
  const id = randomUUID();
  const volume = await insertComputeVolume(
    {
      id,
      name,
      owner_account_id: accountId,
      owning_bay_id: getConfiguredBayId(),
      project_id: opts.project_id ?? null,
      provider: "gcp",
      region: regionFromZone(zone),
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
      monthly_price_per_gb: BALANCED_DISK_MONTHLY_USD_PER_GB.toFixed(6),
      authorized_monthly_cost: authorizedMonthlyCost.toFixed(6),
      billing_state: `${config.environment}_admin_unbilled`,
      idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
      error: null,
      metadata: {
        provider_context: config.staging_legacy_provider
          ? "project-host-provider-context"
          : "dedicated-compute-provider-context",
        price_snapshot_kind: `${config.environment}-static-unbilled`,
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
      authorized_monthly_cost: volume.authorized_monthly_cost,
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
  await requireStagingAdmin(accountId);
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
  await requireStagingAdmin(accountId);
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
  authorized_monthly_cost?: string;
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  const config = await getComputeVmConfig();
  requireComputeVmCreateAllowed(config, accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  const volume = await resolveOwnedVolume(accountId, opts.id_or_name);
  const budget = volume.project_id
    ? await budgetForAdmission(accountId, volume.project_id)
    : undefined;
  const { sizeGb, authorizedMonthlyCost } = volumeAuthorization({
    size_gb: opts.size_gb,
    authorized_monthly_cost: opts.authorized_monthly_cost,
    max_volume_gb: config.max_volume_gb,
    budget_remaining_usd: budget ? Number(budget.remaining_usd) : undefined,
    budget_period: budget?.period,
  });
  if (sizeGb < volume.size_gb) {
    throw new Error("compute volumes cannot be shrunk");
  }
  const next = (await updateComputeVolume(volume.id, {
    desired_size_gb: sizeGb,
    authorized_monthly_cost: authorizedMonthlyCost.toFixed(6),
    state: sizeGb === volume.size_gb ? volume.state : "resizing",
    error: null,
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
  await requireStagingAdmin(accountId);
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
  await requireStagingAdmin(accountId);
  const rows = await listOwnedComputeVms({
    owner_account_id: accountId,
    project_id: opts.project_id,
    include_deleted: opts.include_deleted,
  });
  return rows.map(publicVm);
}

export async function getVm(opts: { account_id?: string; id_or_name: string }) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  return publicVm(await resolveOwned(accountId, opts.id_or_name, true));
}

async function requestState(opts: {
  account_id?: string;
  id_or_name: string;
  idempotency_key: string;
  desired_state: "running" | "stopped";
}) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  if (opts.desired_state === "running") {
    requireComputeVmStartAllowed(await getComputeVmConfig(), accountId);
  }
  const vm = await resolveOwned(accountId, opts.id_or_name);
  if (vm.expires_at.valueOf() <= Date.now()) {
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

export async function deleteVm(opts: {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  id_or_name: string;
  idempotency_key: string;
}) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
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
