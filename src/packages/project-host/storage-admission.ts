/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type {
  HostStorageAdmissionDecision,
  HostStorageAdmissionMetrics,
  HostStorageAdmissionMode,
  HostStoragePressureState,
} from "@cocalc/conat/hub/api/hosts";
import { getBtrfsMutationLockStatus } from "@cocalc/file-server/btrfs/operation-cache";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseIoPressure } from "./io-metrics";
import { listProjects } from "./sqlite/projects";
import {
  getStorageOperationSpec,
  type StorageOperationKind,
  type StorageOperationPriority,
} from "./storage-operation-registry";

const logger = getLogger("project-host:storage-admission");

const PROJECT_POOL_IO_PRESSURE =
  "/sys/fs/cgroup/cocalc-project-pool/io.pressure";
const DEFAULT_SAMPLE_MS = 5_000;
const DEFAULT_CONTENDED_FULL_AVG10 = 5;
const DEFAULT_EMERGENCY_FULL_AVG10 = 10;
const DEFAULT_RECOVERY_FULL_AVG10 = 1;
const DEFAULT_RECOVERY_MS = 60_000;
const DEFAULT_CONTENDED_SAMPLES = 2;

type StorageAdmissionInputs = {
  sampled_at_ms: number;
  host_io_full_avg10?: number;
  project_pool_io_full_avg10?: number;
  starting_projects: number;
  stopping_projects: number;
  btrfs_mutation_locks: number;
  btrfs_mutation_waiters: number;
  error?: string;
};

export type StorageAdmissionRequest = {
  operation_kind: StorageOperationKind;
  project_id?: string;
};

export type StorageAdmissionTicket = {
  admitted: boolean;
  would_defer: boolean;
  reason?: string;
  operation_id: string;
  release: () => void;
};

type StorageAdmissionControllerOptions = {
  mode?: HostStorageAdmissionMode;
  now?: () => number;
  readInputs?: () => StorageAdmissionInputs;
  contendedFullAvg10?: number;
  emergencyFullAvg10?: number;
  recoveryFullAvg10?: number;
  recoveryMs?: number;
  contendedSamples?: number;
};

export interface StorageAdmissionController {
  sample: () => HostStorageAdmissionMetrics;
  admit: (request: StorageAdmissionRequest) => StorageAdmissionTicket;
  getStatus: () => HostStorageAdmissionMetrics;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configuredMode(value: unknown): HostStorageAdmissionMode {
  const mode = `${value ?? ""}`.trim().toLowerCase();
  if (mode === "disabled" || mode === "enforce") return mode;
  return "observe";
}

function readIoFullAvg10(path: string): number | undefined {
  try {
    return parseIoPressure(readFileSync(path, "utf8")).fullPercent;
  } catch {
    return undefined;
  }
}

function defaultReadInputs(): StorageAdmissionInputs {
  const projects = listProjects();
  const locks = getBtrfsMutationLockStatus();
  const hostIoFullAvg10 = readIoFullAvg10("/proc/pressure/io");
  return {
    sampled_at_ms: Date.now(),
    host_io_full_avg10: hostIoFullAvg10,
    project_pool_io_full_avg10: readIoFullAvg10(PROJECT_POOL_IO_PRESSURE),
    starting_projects: projects.filter((row) => row.state === "starting")
      .length,
    stopping_projects: projects.filter((row) => row.state === "stopping")
      .length,
    btrfs_mutation_locks: locks.length,
    btrfs_mutation_waiters: locks.reduce(
      (total, lock) => total + lock.queued,
      0,
    ),
    ...(hostIoFullAvg10 == null
      ? { error: "host I/O pressure is unavailable" }
      : {}),
  };
}

function maxDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  return defined.length > 0 ? Math.max(...defined) : undefined;
}

function emptyActiveCounts(): Record<StorageOperationPriority, number> {
  return {
    lifecycle: 0,
    interactive: 0,
    scheduled: 0,
    scavenger: 0,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function createStorageAdmissionController(
  options: StorageAdmissionControllerOptions = {},
): StorageAdmissionController {
  const mode =
    options.mode ??
    configuredMode(process.env.COCALC_PROJECT_HOST_STORAGE_ADMISSION_MODE);
  const now = options.now ?? Date.now;
  const readInputs = options.readInputs ?? defaultReadInputs;
  const contendedFullAvg10 =
    options.contendedFullAvg10 ??
    finiteNonNegative(
      process.env.COCALC_PROJECT_HOST_STORAGE_IO_CONTENDED_FULL_AVG10,
      DEFAULT_CONTENDED_FULL_AVG10,
    );
  const emergencyFullAvg10 =
    options.emergencyFullAvg10 ??
    finiteNonNegative(
      process.env.COCALC_PROJECT_HOST_STORAGE_IO_EMERGENCY_FULL_AVG10,
      DEFAULT_EMERGENCY_FULL_AVG10,
    );
  const recoveryFullAvg10 =
    options.recoveryFullAvg10 ??
    finiteNonNegative(
      process.env.COCALC_PROJECT_HOST_STORAGE_IO_RECOVERY_FULL_AVG10,
      DEFAULT_RECOVERY_FULL_AVG10,
    );
  const recoveryMs =
    options.recoveryMs ??
    finiteNonNegative(
      process.env.COCALC_PROJECT_HOST_STORAGE_IO_RECOVERY_MS,
      DEFAULT_RECOVERY_MS,
    );
  const contendedSamples =
    options.contendedSamples ??
    positiveInteger(
      process.env.COCALC_PROJECT_HOST_STORAGE_IO_CONTENDED_SAMPLES,
      DEFAULT_CONTENDED_SAMPLES,
    );

  let pressureState: HostStoragePressureState = "normal";
  let stateSince = now();
  let consecutiveContended = 0;
  let recoveryHealthySince: number | undefined;
  let transitionCount = 0;
  let lastTransitionReason: string | undefined;
  let lastInputs: StorageAdmissionInputs = {
    sampled_at_ms: stateSince,
    starting_projects: 0,
    stopping_projects: 0,
    btrfs_mutation_locks: 0,
    btrfs_mutation_waiters: 0,
  };
  let lastDecision: HostStorageAdmissionDecision | undefined;
  let admittedTotal = 0;
  let deferredTotal = 0;
  let observedDeferralTotal = 0;
  const activeByPriority = emptyActiveCounts();

  const transition = (
    next: HostStoragePressureState,
    reason: string,
    at: number,
  ) => {
    if (next === pressureState) return;
    logger.info("storage pressure gate transition", {
      from: pressureState,
      to: next,
      reason,
      effective_io_full_avg10: maxDefined(
        lastInputs.host_io_full_avg10,
        lastInputs.project_pool_io_full_avg10,
      ),
      lifecycle_active:
        lastInputs.starting_projects + lastInputs.stopping_projects,
    });
    pressureState = next;
    stateSince = at;
    transitionCount += 1;
    lastTransitionReason = reason;
  };

  const updateState = (inputs: StorageAdmissionInputs) => {
    const at = inputs.sampled_at_ms;
    const full = maxDefined(
      inputs.host_io_full_avg10,
      inputs.project_pool_io_full_avg10,
    );
    const lifecycleActive = inputs.starting_projects + inputs.stopping_projects;
    if (full == null) {
      return;
    }
    if (full >= emergencyFullAvg10) {
      consecutiveContended = 0;
      recoveryHealthySince = undefined;
      transition("emergency", "io_full_emergency", at);
      return;
    }
    if (pressureState === "normal") {
      if (full >= contendedFullAvg10) {
        consecutiveContended += 1;
        if (consecutiveContended >= contendedSamples) {
          consecutiveContended = 0;
          transition("contended", "io_full_contended", at);
        }
      } else {
        consecutiveContended = 0;
      }
      return;
    }
    if (pressureState === "contended" || pressureState === "emergency") {
      if (full < contendedFullAvg10) {
        recoveryHealthySince =
          full < recoveryFullAvg10 && lifecycleActive === 0 ? at : undefined;
        transition("recovery", "io_pressure_below_enter_threshold", at);
      }
      return;
    }
    if (full >= contendedFullAvg10) {
      recoveryHealthySince = undefined;
      transition("contended", "io_pressure_recurred", at);
      return;
    }
    if (full < recoveryFullAvg10 && lifecycleActive === 0) {
      recoveryHealthySince ??= at;
      if (at - recoveryHealthySince >= recoveryMs) {
        recoveryHealthySince = undefined;
        transition("normal", "recovery_hysteresis_complete", at);
      }
    } else {
      recoveryHealthySince = undefined;
    }
  };

  const status = (): HostStorageAdmissionMetrics => {
    const effective = maxDefined(
      lastInputs.host_io_full_avg10,
      lastInputs.project_pool_io_full_avg10,
    );
    return {
      schema_version: 1,
      collected_at: iso(lastInputs.sampled_at_ms),
      mode,
      pressure_state: pressureState,
      state_since: iso(stateSince),
      ...(lastInputs.host_io_full_avg10 != null
        ? { host_io_full_avg10: lastInputs.host_io_full_avg10 }
        : {}),
      ...(lastInputs.project_pool_io_full_avg10 != null
        ? {
            project_pool_io_full_avg10: lastInputs.project_pool_io_full_avg10,
          }
        : {}),
      ...(effective != null ? { effective_io_full_avg10: effective } : {}),
      lifecycle_active:
        lastInputs.starting_projects + lastInputs.stopping_projects,
      starting_projects: lastInputs.starting_projects,
      stopping_projects: lastInputs.stopping_projects,
      active_by_priority: { ...activeByPriority },
      btrfs_mutation_locks: lastInputs.btrfs_mutation_locks,
      btrfs_mutation_waiters: lastInputs.btrfs_mutation_waiters,
      admitted_total: admittedTotal,
      deferred_total: deferredTotal,
      observed_deferral_total: observedDeferralTotal,
      transition_count: transitionCount,
      ...(lastTransitionReason
        ? { last_transition_reason: lastTransitionReason }
        : {}),
      ...(lastDecision ? { last_decision: { ...lastDecision } } : {}),
      ...(lastInputs.error ? { sample_error: lastInputs.error } : {}),
    };
  };

  const sample = (): HostStorageAdmissionMetrics => {
    try {
      lastInputs = readInputs();
    } catch (err) {
      lastInputs = {
        ...lastInputs,
        sampled_at_ms: now(),
        error: `${err}`,
      };
    }
    updateState(lastInputs);
    return status();
  };

  const admit = ({
    operation_kind,
    project_id,
  }: StorageAdmissionRequest): StorageAdmissionTicket => {
    const current = sample();
    const spec = getStorageOperationSpec(operation_kind);
    const background =
      spec.priority === "scheduled" || spec.priority === "scavenger";
    let reason: string | undefined;
    if (background && current.lifecycle_active > 0) {
      reason = "lifecycle_active";
    } else if (background && current.sample_error) {
      reason = "io_pressure_unavailable";
    } else if (background && current.pressure_state !== "normal") {
      reason = `io_pressure_${current.pressure_state}`;
    }
    const wouldDefer = reason != null;
    const admitted = mode !== "enforce" || !wouldDefer;
    if (admitted) {
      admittedTotal += 1;
      activeByPriority[spec.priority] += 1;
    } else {
      deferredTotal += 1;
    }
    if (mode === "observe" && wouldDefer) {
      observedDeferralTotal += 1;
    }
    const decidedAt = now();
    lastDecision = {
      decided_at: iso(decidedAt),
      operation_kind,
      priority: spec.priority,
      ...(project_id ? { project_id } : {}),
      admitted,
      would_defer: wouldDefer,
      ...(reason ? { reason } : {}),
      pressure_state: current.pressure_state,
    };
    const operationId = randomUUID();
    let released = false;
    return {
      admitted,
      would_defer: wouldDefer,
      ...(reason ? { reason } : {}),
      operation_id: operationId,
      release: () => {
        if (released || !admitted) return;
        released = true;
        activeByPriority[spec.priority] = Math.max(
          0,
          activeByPriority[spec.priority] - 1,
        );
      },
    };
  };

  sample();
  return { sample, admit, getStatus: status };
}

let activeController: StorageAdmissionController | undefined;
let activeTimer: ReturnType<typeof setInterval> | undefined;

export function startStorageAdmissionController(): () => void {
  if (activeController) return () => {};
  activeController = createStorageAdmissionController();
  const sampleMs = positiveInteger(
    process.env.COCALC_PROJECT_HOST_STORAGE_IO_SAMPLE_MS,
    DEFAULT_SAMPLE_MS,
  );
  activeTimer = setInterval(() => activeController?.sample(), sampleMs);
  activeTimer.unref?.();
  logger.info("storage admission controller started", {
    mode: activeController.getStatus().mode,
    sample_ms: sampleMs,
  });
  return () => {
    if (activeTimer) clearInterval(activeTimer);
    activeTimer = undefined;
    activeController = undefined;
  };
}

function controller(): StorageAdmissionController {
  activeController ??= createStorageAdmissionController();
  return activeController;
}

export function admitStorageOperation(
  request: StorageAdmissionRequest,
): StorageAdmissionTicket {
  return controller().admit(request);
}

export function getStorageAdmissionStatus():
  | HostStorageAdmissionMetrics
  | undefined {
  return activeController?.getStatus();
}

export function resetStorageAdmissionControllerForTest(): void {
  if (activeTimer) clearInterval(activeTimer);
  activeTimer = undefined;
  activeController = undefined;
}

export const _test = {
  configuredMode,
  maxDefined,
};
