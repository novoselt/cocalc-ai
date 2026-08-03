/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import net from "node:net";
import getLogger from "@cocalc/backend/logger";
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
  enqueueComputeWork,
  enqueueExpiredComputeVms,
  finishComputeWork,
  getComputeVmById,
  insertComputeInstance,
  updateComputeInstance,
  updateComputeVm,
} from "./db";
import {
  createProviderComputeVm,
  deleteProviderComputeVm,
  inspectProviderComputeVm,
  probeProviderComputeSpot,
  setProviderComputePricing,
  startProviderComputeVm,
  stopProviderComputeVm,
} from "./provider";
import type { ComputeVmRow, ComputeWorkRow } from "./types";

const logger = getLogger("server:compute:worker");

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

async function markReady(vm: ComputeVmRow, publicIp?: string) {
  if (!publicIp) throw new Error("provider VM has no public IPv4 address");
  await waitForSsh(publicIp);
  const next = await updateComputeVm(vm.id, {
    state: "ready",
    desired_state: "running",
    public_ip: publicIp,
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
}

async function provision(vm: ComputeVmRow) {
  if (vm.desired_state === "deleted") return await remove(vm);
  const provisioning = (await updateComputeVm(vm.id, {
    state: "provisioning",
    error: null,
  }))!;
  await insertComputeInstance(provisioning);
  const runtime = await createProviderComputeVm(provisioning);
  const metadata = {
    ...(provisioning.metadata ?? {}),
    runtime: runtime.metadata ?? {},
  };
  const starting = (await updateComputeVm(vm.id, {
    state: "starting",
    public_ip: runtime.public_ip ?? null,
    metadata,
  }))!;
  await markReady(starting, runtime.public_ip);
}

async function start(vm: ComputeVmRow) {
  if (vm.expires_at.valueOf() <= Date.now()) return await remove(vm);
  await updateComputeVm(vm.id, { state: "starting", error: null });
  try {
    await startProviderComputeVm(vm);
    const observed = await inspectProviderComputeVm(vm);
    await markReady(vm, observed.instance?.public_ip);
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
    throw new Error("on-demand fallback is not authorized");
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
  await markReady(fallback, observed.instance?.public_ip);
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

async function stop(vm: ComputeVmRow) {
  await updateComputeVm(vm.id, { state: "stopping", error: null });
  await stopProviderComputeVm(vm);
  const next = (await updateComputeVm(vm.id, {
    state: "stopped",
    desired_state: "stopped",
    stopped_at: new Date(),
    public_ip: null,
    error: null,
  }))!;
  await updateComputeInstance(next, { stopped: true });
}

async function remove(vm: ComputeVmRow) {
  await updateComputeVm(vm.id, {
    state: "deleting",
    desired_state: "deleted",
  });
  await deleteProviderComputeVm(vm);
  const next = (await updateComputeVm(vm.id, {
    state: "deleted",
    desired_state: "deleted",
    public_ip: null,
    deleted_at: new Date(),
    error: null,
  }))!;
  await updateComputeInstance(next, { deleted: true });
}

async function reconcile(vm: ComputeVmRow) {
  if (vm.expires_at.valueOf() <= Date.now() || vm.desired_state === "deleted") {
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
    if (vm.state !== "ready" || observed.instance?.public_ip !== vm.public_ip) {
      await markReady(vm, observed.instance?.public_ip);
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
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await enqueueExpiredComputeVms();
      if (Date.now() - lastReconcile >= 15_000) {
        lastReconcile = Date.now();
        await enqueueComputeReconciliation();
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
            const vm = await getComputeVmById(row.resource_id);
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
