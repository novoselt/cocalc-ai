/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import net from "node:net";
import getLogger from "@cocalc/backend/logger";
import adminAlert from "@cocalc/server/messages/admin-alert";
import { nextCalendarMonthStartAfter } from "@cocalc/server/purchases/billing-period";
import type { HostRuntime, RemoteInstance } from "@cocalc/cloud";
import {
  computeSpotRetryDelayMs,
  DEFAULT_SPOT_RECOVERY_POLICY,
  normalizeSpotRecoveryState,
  recordProviderSpotPreemption,
  spotProbeIntervalMs,
  spotStandardHoldIsActive,
} from "@cocalc/server/cloud/spot-restore";
import {
  appendComputeEvent,
  claimComputeWork,
  enqueueComputeReconciliation,
  enqueueComputeEmergencyStops,
  enqueueComputeWork,
  enqueueExpiredComputeVms,
  finishComputeWork,
  getComputeVmById,
  insertComputeInstance,
  listComputeVmsForBillingEnforcement,
  listComputeVmsForEgressMetering,
  listComputeVmsForInventory,
  updateComputeInstance,
  updateComputeVm,
} from "./db";
import { getComputeVmConfig } from "./config";
import {
  createProviderComputeVm,
  deleteProviderComputeVolume,
  deleteProviderComputeVm,
  ensureProviderComputeVolume,
  inspectProviderComputeVm,
  inspectProviderComputeVolume,
  getProviderComputePublicEgressBytes,
  listProviderComputeInventory,
  probeProviderComputeSpot,
  resizeProviderComputeVolume,
  setProviderComputePricing,
  startProviderComputeVm,
  stopProviderComputeVm,
} from "./provider";
import type { ComputeVmRow, ComputeVolumeRow, ComputeWorkRow } from "./types";
import { ensureComputeWorkQueueSchema } from "./schema";
import {
  closeDedicatedHostPurchaseSessionForAccount,
  recordDedicatedHostMeteredUsageForAccount,
  reconcileDedicatedHostPurchaseSessionForAccount,
} from "@cocalc/server/project-host/spend";
import {
  applyDedicatedHostFundingModeOverride,
  getDedicatedHostPolicySnapshotForAccount,
  selectDedicatedHostFundingLane,
} from "@cocalc/server/project-host/admission";
import {
  DEDICATED_HOST_BILLING_DISK_GRACE_HOURS,
  evaluateDedicatedHostBillingEnforcement,
} from "@cocalc/server/project-host/spend-enforcement";
import {
  appendComputeVolumeEvent,
  detachComputeVolumeFromVm,
  enqueueComputeVolumeReconciliation,
  getComputeVolumeById,
  listComputeVolumesForInventory,
  updateComputeVolume,
} from "./volume-db";

const logger = getLogger("server:compute:worker");
const COMPUTE_PUBLIC_EGRESS_USD_PER_GB = 0.1;
const COMPUTE_EGRESS_FINALIZATION_DELAY_MS = 5 * 60_000;

function fundingLane(resource: ComputeVmRow | ComputeVolumeRow) {
  switch (resource.metadata?.billing?.funding_mode) {
    case "account-prepaid":
      return "prepaid" as const;
    case "account-postpaid":
      return "credit" as const;
    default:
      throw new Error(
        `compute resource '${resource.id}' has no billable funding lane`,
      );
  }
}

async function reconcileVmBilling(
  vm: ComputeVmRow,
  billingState: "running" | "stopped",
  startedAt = new Date(),
) {
  const billing = vm.metadata?.billing;
  const rate =
    billingState === "stopped"
      ? billing?.stopped_rate
      : billing?.running_rates?.[vm.effective_pricing_model];
  if (!rate?.hourly_cost_usd || !rate?.pricing_snapshot) {
    throw new Error(
      `compute VM '${vm.id}' has no ${billingState} pricing snapshot`,
    );
  }
  await reconcileDedicatedHostPurchaseSessionForAccount({
    account_id: vm.owner_account_id,
    host_id: vm.id,
    host_name: `VM: ${vm.name}`,
    host_bay_id: vm.owning_bay_id,
    provider: vm.provider,
    region: vm.region,
    billing_state: billingState,
    machine_type: billingState === "running" ? vm.machine_type : null,
    pricing_model:
      billingState === "running" ? vm.effective_pricing_model : null,
    funding_lane: fundingLane(vm),
    hourly_cost_usd: rate.hourly_cost_usd,
    pricing_snapshot: rate.pricing_snapshot,
    started_at: startedAt,
  });
  await updateComputeVm(vm.id, {
    billing_state: billingState,
    billing_updated_at: new Date(),
  });
}

async function closeVmBilling(vm: ComputeVmRow) {
  await closeDedicatedHostPurchaseSessionForAccount({
    account_id: vm.owner_account_id,
    host_id: vm.id,
  });
  await updateComputeVm(vm.id, {
    billing_state: "closed",
    billing_updated_at: new Date(),
  });
}

async function reconcileVolumeBilling(volume: ComputeVolumeRow) {
  const rate = volume.metadata?.billing?.rate;
  if (!rate?.hourly_cost_usd || !rate?.pricing_snapshot) {
    throw new Error(`compute volume '${volume.id}' has no pricing snapshot`);
  }
  await reconcileDedicatedHostPurchaseSessionForAccount({
    account_id: volume.owner_account_id,
    host_id: volume.id,
    host_name: `VM volume: ${volume.name}`,
    host_bay_id: volume.owning_bay_id,
    provider: volume.provider,
    region: volume.region,
    billing_state: "stopped",
    machine_type: null,
    pricing_model: null,
    funding_lane: fundingLane(volume),
    hourly_cost_usd: rate.hourly_cost_usd,
    pricing_snapshot: rate.pricing_snapshot,
    started_at: volume.ready_at ?? new Date(),
  });
  await updateComputeVolume(volume.id, {
    billing_state: "storage",
    billing_updated_at: new Date(),
  });
}

async function closeVolumeBilling(volume: ComputeVolumeRow) {
  await closeDedicatedHostPurchaseSessionForAccount({
    account_id: volume.owner_account_id,
    host_id: volume.id,
  });
  await updateComputeVolume(volume.id, {
    billing_state: "closed",
    billing_updated_at: new Date(),
  });
}

function vmHourlyRate(vm: ComputeVmRow): string {
  const billing = vm.metadata?.billing;
  const rate =
    vm.state === "stopped" || vm.desired_state === "stopped"
      ? billing?.stopped_rate
      : billing?.running_rates?.[vm.effective_pricing_model];
  if (!rate?.hourly_cost_usd) {
    throw new Error(`compute VM '${vm.id}' has no enforceable rate`);
  }
  return rate.hourly_cost_usd;
}

async function enforceComputeVmFunding() {
  const rows = await listComputeVmsForBillingEnforcement();
  const snapshots = new Map<
    string,
    Awaited<ReturnType<typeof getDedicatedHostPolicySnapshotForAccount>>
  >();
  for (const vm of rows) {
    const fundingMode = vm.metadata?.billing?.funding_mode;
    if (
      fundingMode !== "account-prepaid" &&
      fundingMode !== "account-postpaid"
    ) {
      logger.error("compute VM has invalid funding mode", { vm_id: vm.id });
      continue;
    }
    const snapshotKey = `${vm.owner_account_id}:${fundingMode}`;
    let snapshot = snapshots.get(snapshotKey);
    if (!snapshot) {
      snapshot = await getDedicatedHostPolicySnapshotForAccount({
        account_id: vm.owner_account_id,
        funding_mode_override: fundingMode,
      });
      snapshots.set(snapshotKey, snapshot);
    }
    const effectiveSnapshot = applyDedicatedHostFundingModeOverride(
      snapshot,
      fundingMode,
    );
    const lane = fundingLane(vm);
    const decision = evaluateDedicatedHostBillingEnforcement({
      snapshot: effectiveSnapshot,
      funding_lane: lane,
      hourly_cost_usd: vmHourlyRate(vm),
      lane_allowed: selectDedicatedHostFundingLane(effectiveSnapshot) === lane,
    });
    const previous = vm.metadata?.billing?.enforcement;
    const now = new Date();
    if (decision.action === "none") {
      if (previous?.state && previous.state !== "ok") {
        await updateComputeVm(vm.id, {
          metadata: {
            ...vm.metadata,
            billing: {
              ...vm.metadata.billing,
              enforcement: { state: "ok", recovered_at: now.toISOString() },
            },
          },
        });
      }
      continue;
    }
    if (decision.action === "mark_at_risk") {
      await updateComputeVm(vm.id, {
        metadata: {
          ...vm.metadata,
          billing: {
            ...vm.metadata.billing,
            enforcement: {
              ...decision,
              first_detected_at:
                previous?.first_detected_at ?? now.toISOString(),
            },
          },
        },
      });
      continue;
    }
    const deprovisionAfter =
      previous?.deprovision_after ??
      new Date(
        now.getTime() + DEDICATED_HOST_BILLING_DISK_GRACE_HOURS * 60 * 60_000,
      ).toISOString();
    if (
      vm.state === "stopped" &&
      new Date(deprovisionAfter).getTime() <= now.getTime()
    ) {
      await updateComputeVm(vm.id, {
        desired_state: "deleted",
        state: "deleting",
        metadata: {
          ...vm.metadata,
          billing: {
            ...vm.metadata.billing,
            enforcement: {
              ...decision,
              state: "deprovision_pending",
              deprovision_after: deprovisionAfter,
            },
          },
        },
      });
      await enqueueComputeWork({
        resource_id: vm.id,
        action: "delete",
        idempotency_key: `billing-delete:${vm.id}:${deprovisionAfter}`,
      });
      continue;
    }
    await updateComputeVm(vm.id, {
      desired_state: "stopped",
      state: vm.state === "stopped" ? "stopped" : "stopping",
      metadata: {
        ...vm.metadata,
        billing: {
          ...vm.metadata.billing,
          enforcement: {
            ...decision,
            state: "stopped_billing_blocked",
            first_detected_at: previous?.first_detected_at ?? now.toISOString(),
            stopped_at:
              vm.state === "stopped"
                ? (previous?.stopped_at ?? now.toISOString())
                : previous?.stopped_at,
            deprovision_after: deprovisionAfter,
          },
        },
      },
    });
    if (vm.state !== "stopped" && vm.state !== "stopping") {
      await enqueueComputeWork({
        resource_id: vm.id,
        action: "stop",
        idempotency_key: `billing-stop:${vm.id}:${deprovisionAfter}`,
      });
    }
  }
}

async function enforceComputeVolumeFunding() {
  const [volumes, config] = await Promise.all([
    listComputeVolumesForInventory(),
    getComputeVmConfig(),
  ]);
  const snapshots = new Map<
    string,
    Awaited<ReturnType<typeof getDedicatedHostPolicySnapshotForAccount>>
  >();
  for (const volume of volumes) {
    const fundingMode = volume.metadata?.billing?.funding_mode;
    if (
      fundingMode !== "account-prepaid" &&
      fundingMode !== "account-postpaid"
    ) {
      logger.error("compute volume has invalid funding mode", {
        volume_id: volume.id,
      });
      continue;
    }
    const snapshotKey = `${volume.owner_account_id}:${fundingMode}`;
    let snapshot = snapshots.get(snapshotKey);
    if (!snapshot) {
      snapshot = await getDedicatedHostPolicySnapshotForAccount({
        account_id: volume.owner_account_id,
        funding_mode_override: fundingMode,
      });
      snapshots.set(snapshotKey, snapshot);
    }
    const effectiveSnapshot = applyDedicatedHostFundingModeOverride(
      snapshot,
      fundingMode,
    );
    const lane = fundingLane(volume);
    const laneAllowed =
      selectDedicatedHostFundingLane(effectiveSnapshot) === lane;
    const previous = volume.metadata?.billing?.enforcement;
    if (laneAllowed) {
      if (previous?.state === "unfunded") {
        await updateComputeVolume(volume.id, {
          metadata: {
            ...volume.metadata,
            billing: {
              ...volume.metadata.billing,
              enforcement: {
                state: "ok",
                recovered_at: new Date().toISOString(),
              },
            },
          },
        });
      }
      continue;
    }
    const now = new Date();
    const firstDetected = new Date(
      previous?.first_detected_at ?? now.toISOString(),
    );
    const deleteAfter = new Date(
      previous?.delete_after ??
        firstDetected.getTime() +
          config.unfunded_volume_delete_days * 24 * 60 * 60_000,
    );
    const hourlyCost = Number(
      volume.metadata?.billing?.rate?.hourly_cost_usd ?? 0,
    );
    const exposureUsd =
      (hourlyCost * Math.max(0, now.getTime() - firstDetected.getTime())) /
      3_600_000;
    const shouldDelete =
      now >= deleteAfter ||
      exposureUsd >= config.unfunded_volume_max_exposure_usd;
    const enforcement = {
      state: "unfunded",
      first_detected_at: firstDetected.toISOString(),
      delete_after: deleteAfter.toISOString(),
      estimated_exposure_usd: exposureUsd.toFixed(6),
    };
    await updateComputeVolume(volume.id, {
      metadata: {
        ...volume.metadata,
        billing: { ...volume.metadata.billing, enforcement },
      },
    });
    void adminAlert({
      subject: `Managed compute volume is unfunded: ${volume.name}`,
      body: `Volume ${volume.id} (${volume.size_gb} GB, account ${volume.owner_account_id}, project ${volume.project_id}) is unfunded. Estimated storage is $${(hourlyCost * 730).toFixed(2)}/month; current unfunded exposure is $${exposureUsd.toFixed(2)}. Automatic deletion is scheduled by ${deleteAfter.toISOString()} or at $${config.unfunded_volume_max_exposure_usd.toFixed(2)} exposure. Attachment state: ${volume.attachment_state}.`,
      dedupMinutes: 4 * 60,
      dedupBySubject: true,
    });
    if (
      shouldDelete &&
      !volume.attached_vm_id &&
      volume.attachment_state === "detached"
    ) {
      await updateComputeVolume(volume.id, {
        desired_state: "deleted",
        state: "deleting",
      });
      await enqueueComputeWork({
        resource_kind: "volume",
        resource_id: volume.id,
        action: "delete_volume",
        idempotency_key: `billing-delete-volume:${volume.id}:${deleteAfter.toISOString()}`,
      });
    }
  }
}

async function meterComputeVmPublicEgress() {
  const watermark = new Date(Date.now() - COMPUTE_EGRESS_FINALIZATION_DELAY_MS);
  const rows = await listComputeVmsForEgressMetering();
  for (const vm of rows) {
    const rawStart =
      vm.metadata?.billing?.egress?.metered_through_at ?? vm.created_at;
    const start = new Date(rawStart);
    const resourceEnd =
      vm.deleted_at && vm.deleted_at < watermark ? vm.deleted_at : watermark;
    const periodEnd = nextCalendarMonthStartAfter(start);
    const end = resourceEnd < periodEnd ? resourceEnd : periodEnd;
    const finalize =
      !!vm.deleted_at &&
      vm.deleted_at <= watermark &&
      end.valueOf() === vm.deleted_at.valueOf();
    if (
      !Number.isFinite(start.getTime()) ||
      start > end ||
      (start.valueOf() === end.valueOf() &&
        (!finalize || vm.metadata?.billing?.egress?.finalized))
    ) {
      continue;
    }
    try {
      const bytes =
        end > start
          ? await getProviderComputePublicEgressBytes({ vm, start, end })
          : 0;
      const costUsd =
        (bytes / 1_000_000_000) * COMPUTE_PUBLIC_EGRESS_USD_PER_GB;
      const metered = await recordDedicatedHostMeteredUsageForAccount({
        account_id: vm.owner_account_id,
        resource_id: vm.id,
        resource_name: `VM egress: ${vm.name}`,
        resource_bay_id: vm.owning_bay_id,
        project_id: vm.project_id,
        provider: vm.provider,
        region: vm.region,
        funding_lane: fundingLane(vm),
        bytes,
        cost_usd: costUsd.toFixed(9),
        unit_cost_usd_per_gb: COMPUTE_PUBLIC_EGRESS_USD_PER_GB.toFixed(2),
        interval_start: start,
        interval_end: end,
        finalize,
      });
      const current = await getComputeVmById(vm.id);
      if (!current) continue;
      const previous = current.metadata?.billing?.egress ?? {};
      await updateComputeVm(vm.id, {
        metadata: {
          ...current.metadata,
          billing: {
            ...current.metadata.billing,
            egress: {
              ...previous,
              metered_through_at: metered.metered_through_at,
              total_bytes: metered.total_bytes,
              total_cost_usd: metered.total_cost_usd,
              unit_cost_usd_per_gb: COMPUTE_PUBLIC_EGRESS_USD_PER_GB,
              finalized: metered.finalized,
            },
          },
        },
      });
    } catch (err) {
      logger.error("failed to meter compute VM public egress", {
        vm_id: vm.id,
        start,
        end,
        err,
      });
    }
  }
}

async function reconcileComputeProviderInventory() {
  const [providerInventory, vms, volumes] = await Promise.all([
    listProviderComputeInventory(),
    listComputeVmsForInventory(),
    listComputeVolumesForInventory(),
  ]);
  const providerInstances = new Set(
    providerInventory.instances.map(({ instance_id }) => instance_id),
  );
  const providerDisks = new Set(
    providerInventory.disks.map(({ name }) => name),
  );
  const expectedInstances = new Set(
    vms.map(({ provider_instance_id }) => provider_instance_id),
  );
  const expectedDisks = new Set([
    ...vms.map(({ boot_disk_id }) => boot_disk_id),
    ...volumes.map(({ provider_disk_id }) => provider_disk_id),
  ]);
  for (const vm of vms) {
    if (!providerInstances.has(vm.provider_instance_id) && vm.ready_at) {
      await enqueueComputeWork({
        resource_id: vm.id,
        action: "reconcile",
        idempotency_key: `inventory-reconcile:${vm.id}:${Date.now()}`,
      });
    }
  }
  for (const volume of volumes) {
    if (
      providerInventory.disks_observed &&
      !providerDisks.has(volume.provider_disk_id) &&
      volume.ready_at
    ) {
      await enqueueComputeWork({
        resource_kind: "volume",
        resource_id: volume.id,
        action: "reconcile_volume",
        idempotency_key: `inventory-reconcile-volume:${volume.id}:${Date.now()}`,
      });
    }
  }
  const orphanInstances = [...providerInstances].filter(
    (name) => !expectedInstances.has(name),
  );
  const orphanDisks = providerInventory.disks_observed
    ? [...providerDisks].filter((name) => !expectedDisks.has(name))
    : [];
  if (orphanInstances.length || orphanDisks.length) {
    logger.error("managed compute provider inventory has orphan resources", {
      orphan_instances: orphanInstances,
      orphan_disks: orphanDisks,
    });
  }
  logger.info("managed compute provider inventory reconciled", {
    database_instances: expectedInstances.size,
    provider_instances: providerInstances.size,
    database_disks: expectedDisks.size,
    provider_disks: providerDisks.size,
    provider_disks_observed: providerInventory.disks_observed,
    orphan_instances: orphanInstances.length,
    orphan_disks: orphanDisks.length,
  });
}

export class RetryableComputeWorkError extends Error {
  constructor(
    message: string,
    readonly retryAt: Date,
  ) {
    super(message);
    this.name = "RetryableComputeWorkError";
  }
}

export function computeWorkFailureState(err: unknown) {
  return err instanceof RetryableComputeWorkError ? "recovering" : "failed";
}

export function isSpotCapacityError(err: unknown): boolean {
  const message = `${err ?? ""}`.toUpperCase();
  return [
    "ZONE_RESOURCE_POOL_EXHAUSTED",
    "RESOURCE_POOL_EXHAUSTED",
    "RESOURCE_NOT_READY",
    "INSUFFICIENT CAPACITY",
    "STOCKOUT",
  ].some((pattern) => message.includes(pattern));
}

function spotState(vm: ComputeVmRow) {
  return (
    normalizeSpotRecoveryState(vm.spot_recovery_state) ?? { phase: "idle" }
  );
}

async function waitForSsh(host: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "SSH is not ready";
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host, port: 22 });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("TCP 22 timeout"));
        }, 3000);
        socket.once("connect", () => {
          clearTimeout(timer);
          socket.destroy();
          resolve();
        });
        socket.once("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      return;
    } catch (err) {
      lastError = `${err}`;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`SSH readiness timed out: ${lastError}`);
}

function volumeAttachedToVm(users: string[], vm: ComputeVmRow) {
  const expected = `/instances/${vm.provider_instance_id}`;
  return users.some((user) => user.endsWith(expected));
}

async function waitForVolumeAttachment(
  volume: ComputeVolumeRow,
  vm: ComputeVmRow,
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const observed = await inspectProviderComputeVolume(volume);
    if (observed && volumeAttachedToVm(observed.users, vm)) return observed;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `persistent volume '${volume.name}' was not attached to the expected VM`,
  );
}

type ObservedRuntime = Pick<
  HostRuntime | RemoteInstance,
  "public_ip" | "private_ip" | "internal_hostname" | "metadata"
>;

export function computeRuntimeMetadata(
  current: Record<string, any> | undefined,
  runtime: ObservedRuntime,
) {
  return {
    ...(current ?? {}),
    ...(runtime.metadata ?? {}),
    private_ip: runtime.private_ip ?? current?.private_ip,
    internal_hostname: runtime.internal_hostname ?? current?.internal_hostname,
  };
}

function runtimeIdentityChanged(
  current: Record<string, any>,
  observed: ObservedRuntime,
) {
  return (
    (observed.private_ip != null &&
      observed.private_ip !== current.private_ip) ||
    (observed.internal_hostname != null &&
      observed.internal_hostname !== current.internal_hostname)
  );
}

async function markReady(vm: ComputeVmRow, runtime: ObservedRuntime) {
  const publicIp = runtime.public_ip;
  if (!publicIp) throw new Error("provider VM has no public IPv4 address");
  await waitForSsh(publicIp);
  const next = await updateComputeVm(vm.id, {
    state: "ready",
    desired_state: "running",
    public_ip: publicIp,
    metadata: {
      ...(vm.metadata ?? {}),
      runtime: computeRuntimeMetadata(vm.metadata?.runtime, runtime),
    },
    ready_at: new Date(),
    stopped_at: null,
    error: null,
    spot_recovery_state:
      vm.effective_pricing_model === "spot"
        ? {
            ...(vm.spot_recovery_state ?? {}),
            phase: "idle",
            attempt: 0,
            last_recovered_at: new Date().toISOString(),
          }
        : vm.spot_recovery_state,
  });
  await updateComputeInstance(next!, {
    public_ip: publicIp,
    running: true,
    ready: true,
  });
  await appendComputeEvent({
    vm: next!,
    actor_kind: "worker",
    action: "ready",
    idempotency_key: `ready:${vm.id}:${vm.instance_generation}`,
    old_state: vm.state,
    new_state: "ready",
    status: "success",
  });
  await reconcileVmBilling(next!, "running");
}

async function provision(vm: ComputeVmRow) {
  if (vm.desired_state === "deleted") return await remove(vm);
  if (vm.desired_state === "stopped") {
    await updateComputeVm(vm.id, { state: "stopped", error: null });
    return;
  }
  const provisioning = (await updateComputeVm(vm.id, {
    state: "provisioning",
    error: null,
  }))!;
  let volume: ComputeVolumeRow | undefined;
  if (provisioning.attached_volume_id) {
    volume = await getComputeVolumeById(provisioning.attached_volume_id);
    if (!volume || volume.deleted_at || volume.desired_state !== "ready") {
      throw new Error("attached compute volume is unavailable");
    }
    const disk = volume.ready_at
      ? await inspectProviderComputeVolume(volume)
      : await ensureProviderComputeVolume(volume);
    if (!disk) {
      throw new Error(
        `previously ready compute volume '${volume.name}' is missing at the provider`,
      );
    }
    volume = (await updateComputeVolume(volume.id, {
      state: "ready",
      size_gb: disk.size_gb,
      ready_at: volume.ready_at ?? new Date(),
      error: null,
      metadata: { ...(volume.metadata ?? {}), provider: disk },
    }))!;
  }
  await insertComputeInstance(provisioning);
  let runtime;
  try {
    runtime = await createProviderComputeVm(provisioning, volume);
  } catch (err) {
    if (
      provisioning.desired_pricing_model === "spot" &&
      provisioning.effective_pricing_model === "spot" &&
      isSpotCapacityError(err)
    ) {
      const attempt =
        Number(provisioning.spot_recovery_state?.attempt ?? 0) + 1;
      const retryAt = new Date(
        Date.now() +
          computeSpotRetryDelayMs({
            attempt,
            policy: provisioning.spot_recovery_policy,
          }),
      );
      if (
        attempt >=
          DEFAULT_SPOT_RECOVERY_POLICY.max_restore_attempts_before_fallback &&
        provisioning.allow_on_demand_fallback
      ) {
        const fallback = (await updateComputeVm(provisioning.id, {
          state: "provisioning",
          effective_pricing_model: "on_demand",
          error: null,
          spot_recovery_state: {
            ...(provisioning.spot_recovery_state ?? {}),
            phase: "running_standard_fallback",
            attempt: 0,
            fallback_started_at: new Date().toISOString(),
            standard_hold_until: new Date(
              Date.now() +
                DEFAULT_SPOT_RECOVERY_POLICY.rapid_preemption_standard_hold_minutes *
                  60_000,
            ).toISOString(),
          },
        }))!;
        return await provision(fallback);
      }
      await updateComputeVm(provisioning.id, {
        state: "recovering",
        error: `${err}`.slice(0, 4000),
        spot_recovery_state: {
          ...(provisioning.spot_recovery_state ?? {}),
          phase: "retrying_spot",
          attempt,
          next_retry_at: retryAt.toISOString(),
        },
      });
      throw new RetryableComputeWorkError(`${err}`, retryAt);
    }
    throw err;
  }
  const metadata = {
    ...(provisioning.metadata ?? {}),
    runtime: computeRuntimeMetadata(provisioning.metadata?.runtime, runtime),
  };
  const starting = (await updateComputeVm(vm.id, {
    state: "starting",
    public_ip: runtime.public_ip ?? null,
    metadata,
  }))!;
  await reconcileVmBilling(starting, "running");
  if (volume) {
    const observedVolume = await waitForVolumeAttachment(volume, provisioning);
    await updateComputeVolume(volume.id, {
      attachment_state: "attached",
      error: null,
      metadata: {
        ...(volume.metadata ?? {}),
        provider: observedVolume,
      },
    });
  }
  await markReady(starting, runtime);
}

async function start(vm: ComputeVmRow) {
  if (vm.expires_at && vm.expires_at.valueOf() <= Date.now()) {
    return await remove(vm);
  }
  if (vm.desired_state === "stopped") return await reconcile(vm);
  await updateComputeVm(vm.id, { state: "starting", error: null });
  try {
    await startProviderComputeVm(vm);
    const observed = await inspectProviderComputeVm(vm);
    if (vm.attached_volume_id) {
      const volume = await getComputeVolumeById(vm.attached_volume_id);
      if (!volume) throw new Error("attached compute volume is unavailable");
      const observedVolume = await waitForVolumeAttachment(volume, vm);
      await updateComputeVolume(volume.id, {
        attachment_state: "attached",
        error: null,
        metadata: {
          ...(volume.metadata ?? {}),
          provider: observedVolume,
        },
      });
    }
    await markReady(vm, observed.instance ?? {});
  } catch (err) {
    if (
      vm.desired_pricing_model === "spot" &&
      vm.effective_pricing_model === "spot"
    ) {
      const attempt = Number(vm.spot_recovery_state?.attempt ?? 0) + 1;
      const recoveryState = {
        ...(vm.spot_recovery_state ?? {}),
        phase: "retrying_spot",
        attempt,
        next_retry_at: new Date(
          Date.now() +
            computeSpotRetryDelayMs({
              attempt,
              policy: vm.spot_recovery_policy,
            }),
        ).toISOString(),
      };
      const next = (await updateComputeVm(vm.id, {
        state: "recovering",
        spot_recovery_state: recoveryState,
        error: `${err}`.slice(0, 4000),
      }))!;
      if (
        attempt >=
          DEFAULT_SPOT_RECOVERY_POLICY.max_restore_attempts_before_fallback &&
        vm.allow_on_demand_fallback
      ) {
        return await switchToOnDemand(next);
      }
      throw new RetryableComputeWorkError(
        `${err}`,
        new Date(recoveryState.next_retry_at),
      );
    }
    throw err;
  }
}

async function switchToOnDemand(vm: ComputeVmRow) {
  if (!vm.allow_on_demand_fallback) {
    throw new Error("Standard fallback is not authorized");
  }
  const holdUntil =
    vm.spot_recovery_state?.standard_hold_until ??
    new Date(
      Date.now() +
        DEFAULT_SPOT_RECOVERY_POLICY.rapid_preemption_standard_hold_minutes *
          60_000,
    ).toISOString();
  await setProviderComputePricing(vm, "on_demand");
  const fallback = (await updateComputeVm(vm.id, {
    state: "starting",
    effective_pricing_model: "on_demand",
    spot_recovery_state: {
      ...(vm.spot_recovery_state ?? {}),
      phase: "running_standard_fallback",
      fallback_started_at: new Date().toISOString(),
      standard_hold_until: holdUntil,
      attempt: 0,
    },
    error: null,
  }))!;
  await startProviderComputeVm(fallback);
  const observed = await inspectProviderComputeVm(fallback);
  await markReady(fallback, observed.instance ?? {});
}

async function probeAndReturnToSpot(vm: ComputeVmRow) {
  if (spotStandardHoldIsActive(spotState(vm))) return;
  const available = await probeProviderComputeSpot(vm);
  if (!available) {
    const nextProbe = new Date(
      Date.now() + spotProbeIntervalMs(vm.spot_recovery_policy),
    );
    await updateComputeVm(vm.id, {
      spot_recovery_state: {
        ...(vm.spot_recovery_state ?? {}),
        phase: "running_standard_fallback",
        last_probe_at: new Date().toISOString(),
        last_probe_result: "failure",
      },
    });
    await enqueueComputeWork({
      resource_id: vm.id,
      action: "probe_spot",
      idempotency_key: `probe-spot:${vm.id}:${nextProbe.toISOString()}`,
      not_before: nextProbe,
    });
    return;
  }
  await updateComputeVm(vm.id, {
    state: "stopping",
    spot_recovery_state: {
      ...(vm.spot_recovery_state ?? {}),
      phase: "returning_to_spot",
      last_probe_at: new Date().toISOString(),
      last_probe_result: "success",
    },
  });
  await setProviderComputePricing(vm, "spot");
  const spot = (await updateComputeVm(vm.id, {
    state: "starting",
    effective_pricing_model: "spot",
  }))!;
  await start(spot);
}

export function computePostStopTransition(
  desiredState: ComputeVmRow["desired_state"],
) {
  if (desiredState === "running") {
    return { state: "starting" as const, action: "start" as const };
  }
  if (desiredState === "deleted") {
    return { state: "deleting" as const, action: "delete" as const };
  }
  return { state: "stopped" as const, action: undefined };
}

async function stop(vm: ComputeVmRow) {
  await updateComputeVm(vm.id, { state: "stopping", error: null });
  await stopProviderComputeVm(vm);
  const current = await getComputeVmById(vm.id);
  if (!current) return;
  const transition = computePostStopTransition(current.desired_state);
  const next = (await updateComputeVm(vm.id, {
    state: transition.state,
    stopped_at: new Date(),
    public_ip: null,
    error: null,
  }))!;
  await updateComputeInstance(next, { stopped: true });
  await reconcileVmBilling(next, "stopped");
  if (transition.action) {
    await enqueueComputeWork({
      resource_id: vm.id,
      action: transition.action,
      idempotency_key: `resume-after-stop:${vm.id}:${current.updated_at.toISOString()}`,
    });
  }
}

async function remove(vm: ComputeVmRow) {
  await updateComputeVm(vm.id, {
    state: "deleting",
    desired_state: "deleted",
  });
  await deleteProviderComputeVm(vm);
  if (vm.attached_volume_id) {
    const volume = await getComputeVolumeById(vm.attached_volume_id);
    if (volume) {
      const observed = await inspectProviderComputeVolume(volume);
      if (!observed) {
        await updateComputeVolume(volume.id, {
          state: "failed",
          attachment_state: "unknown",
          error: "previously ready volume is missing at the provider",
        });
        throw new Error(
          `persistent volume '${volume.name}' is missing at the provider`,
        );
      }
      if (observed.users.length) {
        await updateComputeVolume(volume.id, {
          attachment_state: "unknown",
          error: `provider still reports volume users after VM deletion: ${observed.users.join(", ")}`,
          metadata: { ...(volume.metadata ?? {}), provider: observed },
        });
        throw new Error(
          `persistent volume '${volume.name}' detach is not yet confirmed`,
        );
      }
    }
  }
  await detachComputeVolumeFromVm(vm.id);
  const next = (await updateComputeVm(vm.id, {
    state: "deleted",
    desired_state: "deleted",
    public_ip: null,
    deleted_at: new Date(),
    error: null,
  }))!;
  await updateComputeInstance(next, { deleted: true });
  await closeVmBilling(next);
}

async function provisionVolume(volume: ComputeVolumeRow) {
  if (volume.ready_at) {
    throw new Error(
      `refusing to recreate previously ready compute volume '${volume.name}'`,
    );
  }
  const provisioning = (await updateComputeVolume(volume.id, {
    state: "provisioning",
    error: null,
  }))!;
  const disk = await ensureProviderComputeVolume(provisioning);
  const next = (await updateComputeVolume(volume.id, {
    state: "ready",
    size_gb: disk.size_gb,
    ready_at: volume.ready_at ?? new Date(),
    error: null,
    metadata: { ...(volume.metadata ?? {}), provider: disk },
  }))!;
  await appendComputeVolumeEvent({
    volume: next,
    actor_kind: "worker",
    action: "ready",
    idempotency_key: `volume-ready:${volume.id}`,
    old_state: volume.state,
    new_state: "ready",
    status: "success",
  });
  await reconcileVolumeBilling(next);
}

async function resizeVolume(volume: ComputeVolumeRow) {
  if (volume.desired_size_gb < volume.size_gb) {
    throw new Error("compute volumes cannot be shrunk");
  }
  if (volume.desired_size_gb === volume.size_gb) return;
  await updateComputeVolume(volume.id, { state: "resizing", error: null });
  await resizeProviderComputeVolume(volume);
  const next = (await updateComputeVolume(volume.id, {
    state: "ready",
    size_gb: volume.desired_size_gb,
    resized_at: new Date(),
    error: null,
    metadata: {
      ...(volume.metadata ?? {}),
      filesystem_resize_pending: !!volume.attached_vm_id,
    },
  }))!;
  await appendComputeVolumeEvent({
    volume: next,
    actor_kind: "worker",
    action: "resize",
    idempotency_key: `volume-resize:${volume.id}:${volume.desired_size_gb}`,
    old_state: volume.state,
    new_state: "ready",
    status: "success",
    details: { size_gb: volume.desired_size_gb },
  });
  await reconcileVolumeBilling(next);
}

async function deleteVolume(volume: ComputeVolumeRow) {
  if (volume.attached_vm_id || volume.attachment_state !== "detached") {
    throw new Error("cannot delete an attached or uncertain compute volume");
  }
  await updateComputeVolume(volume.id, { state: "deleting", error: null });
  await deleteProviderComputeVolume(volume);
  const next = (await updateComputeVolume(volume.id, {
    state: "deleted",
    desired_state: "deleted",
    deleted_at: new Date(),
    error: null,
  }))!;
  await appendComputeVolumeEvent({
    volume: next,
    actor_kind: "worker",
    action: "delete",
    idempotency_key: `volume-delete:${volume.id}`,
    old_state: volume.state,
    new_state: "deleted",
    status: "success",
  });
  await closeVolumeBilling(next);
}

async function reconcileVolume(volume: ComputeVolumeRow) {
  if (volume.desired_state === "deleted") return await deleteVolume(volume);
  const observed = await inspectProviderComputeVolume(volume);
  if (!observed) {
    if (!volume.ready_at) return await provisionVolume(volume);
    await updateComputeVolume(volume.id, {
      state: "failed",
      attachment_state: "unknown",
      error: "previously ready volume is missing at the provider",
    });
    return;
  }
  if (observed.size_gb < volume.desired_size_gb) {
    return await resizeVolume(volume);
  }
  const attachedVm = volume.attached_vm_id
    ? await getComputeVmById(volume.attached_vm_id)
    : undefined;
  const attachedToExpectedVm = !!(
    attachedVm && volumeAttachedToVm(observed.users, attachedVm)
  );
  const attachedElsewhere = observed.users.length > 0 && !attachedToExpectedVm;
  await updateComputeVolume(volume.id, {
    state: "ready",
    size_gb: observed.size_gb,
    attachment_state: attachedElsewhere
      ? "unknown"
      : attachedToExpectedVm
        ? "attached"
        : volume.attached_vm_id
          ? "reserved"
          : "detached",
    error: null,
    metadata: { ...(volume.metadata ?? {}), provider: observed },
  });
}

async function reconcile(vm: ComputeVmRow) {
  if (
    (vm.expires_at && vm.expires_at.valueOf() <= Date.now()) ||
    vm.desired_state === "deleted"
  ) {
    return await remove(vm);
  }
  const observed = await inspectProviderComputeVm(vm);
  if (vm.desired_state === "stopped") {
    if (observed.status === "running" || observed.status === "starting") {
      return await stop(vm);
    }
    if (vm.state !== "stopped") {
      await updateComputeVm(vm.id, {
        state: "stopped",
        public_ip: null,
        stopped_at: new Date(),
      });
    }
    return;
  }
  const nextRetryAt = vm.spot_recovery_state?.next_retry_at;
  if (
    vm.state === "recovering" &&
    nextRetryAt &&
    new Date(nextRetryAt).valueOf() > Date.now()
  ) {
    return;
  }
  if (observed.status === "running") {
    if (
      vm.desired_pricing_model === "spot" &&
      vm.effective_pricing_model === "on_demand" &&
      !spotStandardHoldIsActive(spotState(vm))
    ) {
      await enqueueComputeWork({
        resource_id: vm.id,
        action: "probe_spot",
        idempotency_key: `probe-spot:${vm.id}:${Date.now()}`,
      });
    }
    const runtimeMetadata = vm.metadata?.runtime ?? {};
    if (
      vm.state !== "ready" ||
      observed.instance?.public_ip !== vm.public_ip ||
      runtimeIdentityChanged(runtimeMetadata, observed.instance ?? {})
    ) {
      await markReady(vm, observed.instance ?? {});
    }
    return;
  }
  if (observed.status === "missing") {
    return await provision(vm);
  }
  // Spot preemption leaves the persistent-root instance terminated. Record it
  // only on the ready -> terminated edge so repeated provider observations do
  // not inflate the circuit-breaker counter.
  if (
    vm.state === "ready" &&
    vm.desired_pricing_model === "spot" &&
    vm.effective_pricing_model === "spot"
  ) {
    const recorded = recordProviderSpotPreemption({
      state: spotState(vm),
      policy: vm.spot_recovery_policy,
    });
    const interrupted = (await updateComputeVm(vm.id, {
      state: "recovering",
      public_ip: null,
      spot_recovery_state: {
        ...recorded.state,
        phase: "retrying_spot",
        attempt: 0,
      },
    }))!;
    if (recorded.circuit_breaker_triggered && vm.allow_on_demand_fallback) {
      return await switchToOnDemand(interrupted);
    }
    vm = interrupted;
  }
  // Starting the same instance preserves the named root disk and is
  // idempotent.
  await updateComputeVm(vm.id, {
    state: vm.desired_pricing_model === "spot" ? "recovering" : "starting",
    public_ip: null,
  });
  await enqueueComputeWork({
    resource_id: vm.id,
    action: "start",
    idempotency_key: `reconcile-start:${vm.id}:${Date.now()}`,
    not_before: new Date(Date.now() + 5000),
  });
}

async function handleWork(row: ComputeWorkRow) {
  if (row.resource_kind === "volume") {
    const volume = await getComputeVolumeById(row.resource_id);
    if (!volume) return;
    switch (row.action) {
      case "provision_volume":
        return await provisionVolume(volume);
      case "resize_volume":
        return await resizeVolume(volume);
      case "delete_volume":
        return await deleteVolume(volume);
      case "reconcile_volume":
        return await reconcileVolume(volume);
      default:
        throw new Error(
          `unsupported compute volume work action '${row.action}'`,
        );
    }
  }
  const vm = await getComputeVmById(row.resource_id);
  if (!vm) return;
  switch (row.action) {
    case "provision":
      return await provision(vm);
    case "start":
      return await start(vm);
    case "stop":
      return await stop(vm);
    case "delete":
      return await remove(vm);
    case "reconcile":
      return await reconcile(vm);
    case "probe_spot":
      return await probeAndReturnToSpot(vm);
    default:
      throw new Error(`unsupported compute work action '${row.action}'`);
  }
}

export function startComputeVmWorker(opts: { interval_ms?: number } = {}) {
  const workerId = `compute-${process.pid}-${randomUUID().slice(0, 8)}`;
  const intervalMs = opts.interval_ms ?? 2000;
  let running = false;
  let stopped = false;
  let lastReconcile = 0;
  let lastEgressMeter = 0;
  let lastProviderInventory = 0;
  let queueSchemaReady = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      if (!queueSchemaReady) {
        await ensureComputeWorkQueueSchema();
        queueSchemaReady = true;
        logger.info("managed compute work queue schema is ready");
      }
      await enqueueExpiredComputeVms();
      if (Date.now() - lastReconcile >= 15_000) {
        lastReconcile = Date.now();
        const config = await getComputeVmConfig();
        if (Date.now() - lastEgressMeter >= 5 * 60_000) {
          lastEgressMeter = Date.now();
          try {
            await meterComputeVmPublicEgress();
          } catch (err) {
            logger.warn("managed compute egress metering pass failed", { err });
          }
        }
        if (Date.now() - lastProviderInventory >= 15 * 60_000) {
          lastProviderInventory = Date.now();
          try {
            await reconcileComputeProviderInventory();
          } catch (err) {
            logger.warn("managed compute inventory pass failed", { err });
          }
        }
        await enforceComputeVmFunding();
        await enforceComputeVolumeFunding();
        if (config.emergency_stop) {
          await enqueueComputeEmergencyStops();
        }
        await enqueueComputeReconciliation();
        await enqueueComputeVolumeReconciliation();
      }
      const rows = await claimComputeWork({ worker_id: workerId, limit: 2 });
      await Promise.all(
        rows.map(async (row) => {
          try {
            await handleWork(row);
            await finishComputeWork({ id: row.id, state: "done" });
          } catch (err) {
            const error = `${err}`.slice(0, 4000);
            logger.warn("compute work failed", {
              id: row.id,
              resource_id: row.resource_id,
              action: row.action,
              err,
            });
            if (
              row.resource_kind === "vm" &&
              computeWorkFailureState(err) === "recovering" &&
              err instanceof RetryableComputeWorkError
            ) {
              const vm = await getComputeVmById(row.resource_id);
              if (vm) {
                await appendComputeEvent({
                  vm,
                  actor_kind: "worker",
                  action: row.action,
                  idempotency_key: row.idempotency_key,
                  old_state: vm.state,
                  new_state: "recovering",
                  status: "retrying",
                  details: {
                    error,
                    retry_at: err.retryAt.toISOString(),
                  },
                });
              }
              // Close this work item before enqueueing its replacement so the
              // per-resource work deduplication does not suppress the retry.
              await finishComputeWork({
                id: row.id,
                state: "failed",
                error,
              });
              await enqueueComputeWork({
                resource_id: row.resource_id,
                action: row.action,
                idempotency_key: `retry:${row.resource_id}:${row.action}:${err.retryAt.toISOString()}`,
                payload: row.payload,
                not_before: err.retryAt,
              });
              return;
            }
            const vm =
              row.resource_kind === "vm"
                ? await getComputeVmById(row.resource_id)
                : undefined;
            if (vm) {
              await updateComputeVm(vm.id, { state: "failed", error });
              await appendComputeEvent({
                vm,
                actor_kind: "worker",
                action: row.action,
                idempotency_key: row.idempotency_key,
                old_state: vm.state,
                new_state: "failed",
                status: "failure",
                details: { error },
              });
            }
            if (row.resource_kind === "volume") {
              const volume = await getComputeVolumeById(row.resource_id);
              if (volume) {
                await updateComputeVolume(volume.id, {
                  state: "failed",
                  error,
                });
                await appendComputeVolumeEvent({
                  volume,
                  actor_kind: "worker",
                  action: row.action,
                  idempotency_key: row.idempotency_key,
                  old_state: volume.state,
                  new_state: "failed",
                  status: "failure",
                  details: { error },
                });
              }
            }
            await finishComputeWork({ id: row.id, state: "failed", error });
          }
        }),
      );
    } catch (err) {
      logger.warn("compute worker tick failed", { err });
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  logger.info("compute VM worker started", { worker_id: workerId, intervalMs });
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
