/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import getPool from "@cocalc/database/pool";

const BAY_CACHE_MS = 5_000;
const HOST_CACHE_MS = 10_000;
const HOST_SAMPLE_STALE_MS = 3 * 60_000;
const MAX_HOST_CACHE_ENTRIES = 2_048;

type CacheEntry<T> = {
  expires_at: number;
  value: T;
};

export type UxSaturationContext = {
  schema_version: 1;
  observed_at: string;
  bay: Record<string, unknown>;
  host?: Record<string, unknown>;
};

type HostSaturationResult = {
  host_id?: string;
  details?: Record<string, unknown>;
};

let bayCache: CacheEntry<Record<string, unknown>> | undefined;
let previousEventLoopUtilization = performance.eventLoopUtilization();
let previousEventLoopUtilizationAt = Date.now();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const hostCache = new Map<string, CacheEntry<HostSaturationResult>>();

function finiteNumber(value: unknown): number | undefined {
  if (value == null || value === "") return;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function rounded(value: unknown, digits = 2): number | undefined {
  const number = finiteNumber(value);
  if (number == null) return;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function ratioPercent(used: unknown, total: unknown): number | undefined {
  const usedNumber = finiteNumber(used);
  const totalNumber = finiteNumber(total);
  if (usedNumber == null || totalNumber == null || totalNumber <= 0) return;
  return rounded((100 * usedNumber) / totalNumber);
}

function positiveInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (number == null || number < 0) return;
  return Math.round(number);
}

function compactIoContainment(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return;
  const metrics = value as Record<string, unknown>;
  return {
    policy_mode: metrics.policy_mode,
    capacity_mode: metrics.capacity_mode,
    capability: metrics.capability,
    pressure_some_percent: rounded(metrics.pressure_some_percent),
    pressure_full_percent: rounded(metrics.pressure_full_percent),
    sampled_project_count: positiveInteger(metrics.sampled_project_count),
    stale_project_count: positiveInteger(metrics.stale_project_count),
    maintenance_pressure_some_percent: rounded(
      metrics.maintenance_pressure_some_percent,
    ),
    maintenance_pressure_full_percent: rounded(
      metrics.maintenance_pressure_full_percent,
    ),
    maintenance_process_count: positiveInteger(
      metrics.maintenance_process_count,
    ),
    sampling_error: metrics.sampling_error,
  };
}

function compactConatPersist(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return;
  const metrics = value as Record<string, unknown>;
  return {
    available: metrics.available,
    ready: metrics.ready,
    rss_bytes: positiveInteger(metrics.rss_bytes),
    heap_used_bytes: positiveInteger(metrics.heap_used_bytes),
    event_loop_utilization: rounded(metrics.event_loop_utilization, 4),
    open_streams: positiveInteger(metrics.open_streams),
    open_disk_streams: positiveInteger(metrics.open_disk_streams),
    cached_streams: positiveInteger(metrics.cached_streams),
    maintenance_catalog_healthy: metrics.maintenance_catalog_healthy,
    maintenance_tracking_coverage: metrics.maintenance_tracking_coverage,
    maintenance_pause_reason: metrics.maintenance_pause_reason,
    error: metrics.error,
  };
}

export function hostSaturationFromRow({
  row,
  observed_at_ms,
}: {
  row: Record<string, unknown>;
  observed_at_ms: number;
}): HostSaturationResult {
  const hostId = `${row.host_id ?? ""}`.trim() || undefined;
  if (!hostId) return {};
  const resolution = row.explicit_host_id ? "event" : "project_projection";
  if (row.collected_at == null) {
    return {
      host_id: hostId,
      details: {
        host_id: hostId,
        resolution,
        available: false,
        reason: "no_metrics_sample",
      },
    };
  }
  const collectedAt = new Date(`${row.collected_at}`);
  const ageMs = Math.max(0, observed_at_ms - collectedAt.getTime());
  return {
    host_id: hostId,
    details: {
      host_id: hostId,
      resolution,
      available: true,
      collected_at: collectedAt.toISOString(),
      sample_age_ms: ageMs,
      stale: ageMs > HOST_SAMPLE_STALE_MS,
      cpu_percent: rounded(row.cpu_percent),
      load_1: rounded(row.load_1),
      load_5: rounded(row.load_5),
      load_15: rounded(row.load_15),
      memory_used_percent: rounded(row.memory_used_percent),
      swap_used_percent: ratioPercent(
        row.swap_used_bytes,
        row.swap_total_bytes,
      ),
      disk_device_used_percent: ratioPercent(
        row.disk_device_used_bytes,
        row.disk_device_total_bytes,
      ),
      shared_scratch_used_percent: ratioPercent(
        row.shared_scratch_used_bytes,
        row.shared_scratch_total_bytes,
      ),
      disk_available_for_admission_bytes: positiveInteger(
        row.disk_available_for_admission_bytes,
      ),
      assigned_project_count: positiveInteger(row.assigned_project_count),
      running_project_count: positiveInteger(row.running_project_count),
      starting_project_count: positiveInteger(row.starting_project_count),
      stopping_project_count: positiveInteger(row.stopping_project_count),
      io_containment: compactIoContainment(row.io_containment),
      conat_persist: compactConatPersist(row.conat_persist),
    },
  };
}

function captureBaySaturation(now = Date.now()): Record<string, unknown> {
  if (bayCache != null && bayCache.expires_at > now) return bayCache.value;
  const cpuCount = Math.max(1, os.cpus().length);
  const [load1, load5, load15] = os.loadavg();
  const memory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const eventLoopUtilization = performance.eventLoopUtilization(
    previousEventLoopUtilization,
  );
  const intervalMs = Math.max(0, now - previousEventLoopUtilizationAt);
  previousEventLoopUtilization = performance.eventLoopUtilization();
  previousEventLoopUtilizationAt = now;
  const delayP95 = finiteNumber(eventLoopDelay.percentile(95) / 1e6);
  const delayMax = finiteNumber(eventLoopDelay.max / 1e6);
  eventLoopDelay.reset();
  const value = {
    collected_at: new Date(now).toISOString(),
    cpu_count: cpuCount,
    load_1: rounded(load1),
    load_5: rounded(load5),
    load_15: rounded(load15),
    load_1_per_cpu: rounded(load1 / cpuCount, 4),
    memory_used_percent: ratioPercent(totalMemory - freeMemory, totalMemory),
    process_rss_bytes: memory.rss,
    process_heap_used_bytes: memory.heapUsed,
    process_external_bytes: memory.external,
    process_uptime_seconds: rounded(process.uptime()),
    event_loop_interval_ms: intervalMs,
    event_loop_utilization: rounded(eventLoopUtilization.utilization, 4),
    event_loop_delay_p95_ms: rounded(delayP95),
    event_loop_delay_max_ms: rounded(delayMax),
  };
  bayCache = { expires_at: now + BAY_CACHE_MS, value };
  return value;
}

async function loadHostSaturation({
  host_id,
  project_id,
  observed_at_ms,
}: {
  host_id?: string;
  project_id?: string;
  observed_at_ms: number;
}): Promise<HostSaturationResult> {
  if (!host_id && !project_id) return {};
  const cacheKey = host_id ? `host:${host_id}` : `project:${project_id}`;
  const cached = hostCache.get(cacheKey);
  if (cached != null && cached.expires_at > observed_at_ms) {
    return cached.value;
  }
  const { rows } = await getPool().query(
    `
      WITH target AS (
        SELECT COALESCE(
          $1::UUID,
          (SELECT host_id FROM projects WHERE project_id=$2::UUID LIMIT 1)
        ) AS host_id,
        ($1::UUID IS NOT NULL) AS explicit_host_id
      )
      SELECT target.host_id, target.explicit_host_id,
             sample.collected_at, sample.cpu_percent,
             sample.load_1, sample.load_5, sample.load_15,
             sample.memory_used_percent,
             sample.swap_total_bytes, sample.swap_used_bytes,
             sample.disk_device_total_bytes, sample.disk_device_used_bytes,
             sample.shared_scratch_total_bytes,
             sample.shared_scratch_used_bytes,
             sample.disk_available_for_admission_bytes,
             sample.assigned_project_count, sample.running_project_count,
             sample.starting_project_count, sample.stopping_project_count,
             sample.io_containment, sample.conat_persist
        FROM target
        LEFT JOIN LATERAL (
          SELECT *
            FROM project_host_metrics_samples
           WHERE host_id=target.host_id
             AND collected_at <= $3::TIMESTAMPTZ
           ORDER BY collected_at DESC
           LIMIT 1
        ) sample ON TRUE
    `,
    [host_id ?? null, project_id ?? null, new Date(observed_at_ms)],
  );
  const value = hostSaturationFromRow({
    row: rows[0] ?? {},
    observed_at_ms,
  });
  if (hostCache.size >= MAX_HOST_CACHE_ENTRIES) {
    hostCache.delete(hostCache.keys().next().value);
  }
  hostCache.set(cacheKey, {
    expires_at: observed_at_ms + HOST_CACHE_MS,
    value,
  });
  return value;
}

export async function getUxSaturationContext({
  host_id,
  project_id,
  now = Date.now(),
}: {
  host_id?: string;
  project_id?: string;
  now?: number;
}): Promise<{ context: UxSaturationContext; host_id?: string }> {
  const context: UxSaturationContext = {
    schema_version: 1,
    observed_at: new Date(now).toISOString(),
    bay: captureBaySaturation(now),
  };
  try {
    const host = await loadHostSaturation({
      host_id,
      project_id,
      observed_at_ms: now,
    });
    if (host.details != null) context.host = host.details;
    return { context, host_id: host.host_id ?? host_id };
  } catch {
    if (host_id || project_id) {
      context.host = {
        ...(host_id ? { host_id } : {}),
        resolution: host_id ? "event" : "project_projection",
        available: false,
        reason: "metrics_lookup_failed",
      };
    }
    return { context, host_id };
  }
}

export function resetUxSaturationCachesForTests(): void {
  bayCache = undefined;
  hostCache.clear();
  previousEventLoopUtilization = performance.eventLoopUtilization();
  previousEventLoopUtilizationAt = Date.now();
  eventLoopDelay.reset();
}
