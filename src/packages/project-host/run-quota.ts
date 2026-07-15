/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Configuration } from "@cocalc/conat/project/runner/types";

const MB = 1_000_000;

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function nonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function normalizeRunQuota(run_quota?: any): any | undefined {
  if (run_quota == null) return undefined;
  if (typeof run_quota === "string") {
    try {
      return JSON.parse(run_quota);
    } catch {
      return undefined;
    }
  }
  if (typeof run_quota === "object") {
    return run_quota;
  }
  return undefined;
}

export function runnerConfigFromQuota(
  rawRunQuota?: any,
): Partial<Configuration> {
  const run_quota = normalizeRunQuota(rawRunQuota);
  const limits: Partial<Configuration> = {
    pids: positiveIntegerEnv("COCALC_PROJECT_PIDS_LIMIT", 4096),
    nofile: positiveIntegerEnv("COCALC_PROJECT_NOFILE_LIMIT", 8192),
    core: nonNegativeIntegerEnv("COCALC_PROJECT_CORE_LIMIT", 0),
    shmSize: process.env.COCALC_PROJECT_SHM_SIZE?.trim() || "64m",
  };
  if (!run_quota) return limits;

  if (run_quota.cpu_limit != null) {
    limits.cpu = run_quota.cpu_limit;
  }
  if (run_quota.memory_limit != null) {
    const memory = Math.floor(run_quota.memory_limit * MB);
    limits.memory = memory;
    limits.tmp = Math.floor(memory / 2);
    limits.swap = true;
  }
  if (run_quota.pids_limit != null) {
    limits.pids = run_quota.pids_limit;
  }
  if (run_quota.disk_quota != null) {
    const disk = Math.floor(run_quota.disk_quota * MB);
    limits.disk = disk;
    limits.scratch = disk;
  }
  if (run_quota.gpu === true || (run_quota.gpu_count ?? 0) > 0) {
    limits.gpu = true;
  }
  return limits;
}
