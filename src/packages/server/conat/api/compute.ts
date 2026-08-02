/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import type {
  ComputeVm,
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
import { getComputeMachine } from "@cocalc/server/compute/catalog";
import type { ComputeVmRow } from "@cocalc/server/compute/types";
import { DEFAULT_SPOT_RECOVERY_POLICY } from "@cocalc/server/cloud/spot-restore";
import { computeLeaseAuthorization } from "@cocalc/server/compute/pricing";

const MAX_STAGING_TTL_MINUTES = 24 * 60;
const MIN_BOOT_DISK_GB = 10;
const MAX_BOOT_DISK_GB = 200;

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

export async function createVm(opts: CreateComputeVmRequest) {
  const accountId = requireAccount(opts.account_id);
  await requireStagingAdmin(accountId);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  await requireProjectMembership(accountId, opts.project_id);

  const name = normalizeName(opts.name);
  const zone = normalizeZone(opts.zone);
  const machine = getComputeMachine(opts.machine_type);
  const pricingModel = opts.pricing_model;
  if (pricingModel !== "spot" && pricingModel !== "on_demand") {
    throw new Error("pricing_model must be spot or on_demand");
  }
  const ttlMinutes = Number(opts.ttl_minutes);
  if (
    !Number.isInteger(ttlMinutes) ||
    ttlMinutes < 5 ||
    ttlMinutes > MAX_STAGING_TTL_MINUTES
  ) {
    throw new Error(
      `ttl_minutes must be an integer from 5 to ${MAX_STAGING_TTL_MINUTES}`,
    );
  }
  const bootDiskGb = Number(opts.boot_disk_gb ?? 20);
  if (
    !Number.isInteger(bootDiskGb) ||
    bootDiskGb < MIN_BOOT_DISK_GB ||
    bootDiskGb > MAX_BOOT_DISK_GB
  ) {
    throw new Error(
      `boot_disk_gb must be an integer from ${MIN_BOOT_DISK_GB} to ${MAX_BOOT_DISK_GB}`,
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
  const authorizedCost = Number(opts.authorized_cost);
  if (!Number.isFinite(authorizedCost) || authorizedCost < maximumCostUsd) {
    throw new Error(
      `authorized_cost must be at least ${maximumCostUsd.toFixed(4)} USD for this staging lease`,
    );
  }
  const id = randomUUID();
  const providerInstanceId = `cocalc-vm-${id.replaceAll("-", "").slice(0, 24)}`;
  const vm = await insertComputeVm({
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
    billing_state: "staging_admin_unbilled",
    spot_recovery_policy: {
      ...DEFAULT_SPOT_RECOVERY_POLICY,
      standard_fallback_enabled: opts.allow_on_demand_fallback === true,
    },
    spot_recovery_state: { phase: "idle" },
    idempotency_key: normalizeIdempotencyKey(opts.idempotency_key),
    error: null,
    metadata: {
      staging_credentials: "project-host-provider-context",
      price_snapshot_kind: "staging-static-unbilled",
      max_staging_ttl_minutes: MAX_STAGING_TTL_MINUTES,
    },
  });
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
    },
  });
  await enqueueComputeWork({
    resource_id: vm.id,
    action: "provision",
    idempotency_key: `provision:${vm.id}:1`,
  });
  return publicVm(vm);
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
