/*
Read-only BEES progress telemetry. This deliberately never restarts or signals
BEES: low deduplication yield is not evidence that its deterministic crawl is
stalled.
*/

import { sudo } from "./util";

const STALL_OBSERVATION_MS = 90 * 60 * 1000;
const ACTIVE_CPU_CORES = 0.05;
const PROGRESS_COUNTERS = [
  "block_bytes",
  "scan_extent",
  "scan_forward",
  "scanf_extent",
] as const;
const DELTA_COUNTERS = ["dedup_bytes", ...PROGRESS_COUNTERS] as const;

export interface BeesTelemetrySnapshot {
  sampled_at: string;
  pid?: number | null;
  process_cgroup?: string | null;
  stats?: {
    exists?: boolean;
    mtime_ms?: number;
    size_bytes?: number;
    total?: Record<string, number | string>;
    progress?: string;
  };
  crawl?: {
    exists?: boolean;
    mtime_ms?: number;
    size_bytes?: number;
    sha256?: string;
    root_count?: number;
  };
  cgroup?: {
    path?: string;
    cpu_max?: string | null;
    cpu_weight?: number | string;
    cpu_stat?: Record<string, number | string>;
    cpu_pressure?: string | null;
    io_weight?: string | null;
    io_max?: string | null;
    io_stat?: string | null;
    io_pressure?: string | null;
    memory_current?: number | string;
    memory_high?: number | string;
    memory_max?: number | string;
    memory_peak?: number | string;
    memory_events?: Record<string, number | string>;
    memory_pressure?: string | null;
    pids_current?: number | string;
    pids_max?: number | string;
  };
}

export type BeesTelemetryAssessment =
  | "observing"
  | "active"
  | "idle"
  | "possible_stall"
  | "unavailable";

export interface BeesTelemetryStatus {
  assessment: BeesTelemetryAssessment;
  sample?: BeesTelemetrySnapshot;
  previous_sampled_at?: string;
  interval_ms?: number;
  average_cpu_cores?: number;
  crawl_changed?: boolean;
  stats_changed?: boolean;
  counter_delta?: Record<string, number>;
  last_progress_at?: string;
  progress_age_ms?: number;
  stall_observation_ms: number;
  error?: string;
  error_at?: string;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function counter(
  sample: BeesTelemetrySnapshot | undefined,
  name: string,
): number | undefined {
  return finiteNumber(sample?.stats?.total?.[name]);
}

function positiveDelta(
  previous: BeesTelemetrySnapshot,
  current: BeesTelemetrySnapshot,
  name: string,
): number | undefined {
  const before = counter(previous, name);
  const after = counter(current, name);
  if (before == null || after == null || after < before) return undefined;
  return after - before;
}

function cpuUsageUsec(
  sample: BeesTelemetrySnapshot | undefined,
): number | undefined {
  return finiteNumber(sample?.cgroup?.cpu_stat?.usage_usec);
}

export function updateBeesTelemetry(
  previous: BeesTelemetryStatus | undefined,
  sample: BeesTelemetrySnapshot,
): BeesTelemetryStatus {
  const nowMs = Date.parse(sample.sampled_at);
  const previousSample = previous?.sample;
  const previousMs = previousSample
    ? Date.parse(previousSample.sampled_at)
    : NaN;
  const sameProcess =
    sample.pid != null &&
    previousSample?.pid != null &&
    sample.pid === previousSample.pid;
  const intervalMs =
    sameProcess && Number.isFinite(nowMs) && Number.isFinite(previousMs)
      ? Math.max(0, nowMs - previousMs)
      : undefined;
  const counterDelta: Record<string, number> = {};
  if (sameProcess && previousSample) {
    for (const name of DELTA_COUNTERS) {
      const delta = positiveDelta(previousSample, sample, name);
      if (delta != null) counterDelta[name] = delta;
    }
  }
  const crawlChanged =
    sameProcess &&
    previousSample?.crawl?.sha256 != null &&
    sample.crawl?.sha256 != null
      ? previousSample.crawl.sha256 !== sample.crawl.sha256
      : undefined;
  const statsChanged =
    sameProcess &&
    previousSample?.stats?.mtime_ms != null &&
    sample.stats?.mtime_ms != null
      ? previousSample.stats.mtime_ms !== sample.stats.mtime_ms
      : undefined;
  const previousCpu = cpuUsageUsec(previousSample);
  const currentCpu = cpuUsageUsec(sample);
  const cpuDelta =
    sameProcess &&
    previousCpu != null &&
    currentCpu != null &&
    currentCpu >= previousCpu
      ? currentCpu - previousCpu
      : undefined;
  const averageCpuCores =
    intervalMs != null && intervalMs > 0 && cpuDelta != null
      ? cpuDelta / (intervalMs * 1000)
      : undefined;
  const madeProgress =
    crawlChanged === true ||
    PROGRESS_COUNTERS.some((name) => (counterDelta[name] ?? 0) > 0);
  const active = averageCpuCores != null && averageCpuCores >= ACTIVE_CPU_CORES;

  let lastProgressAt = previous?.last_progress_at;
  let assessment: BeesTelemetryAssessment = "observing";
  if (sample.pid == null) {
    assessment = "unavailable";
    lastProgressAt = undefined;
  } else if (!sameProcess || intervalMs == null) {
    lastProgressAt = sample.sampled_at;
  } else if (madeProgress) {
    assessment = "active";
    lastProgressAt = sample.sampled_at;
  } else if (!active) {
    assessment = "idle";
    // Idle is a healthy baseline. Do not let a later active interval inherit
    // an old progress age and immediately look stalled.
    lastProgressAt = sample.sampled_at;
  }
  const lastProgressMs = lastProgressAt ? Date.parse(lastProgressAt) : NaN;
  const progressAgeMs =
    Number.isFinite(nowMs) && Number.isFinite(lastProgressMs)
      ? Math.max(0, nowMs - lastProgressMs)
      : undefined;
  if (
    assessment === "observing" &&
    active &&
    progressAgeMs != null &&
    progressAgeMs >= STALL_OBSERVATION_MS
  ) {
    assessment = "possible_stall";
  }

  return {
    assessment,
    sample,
    previous_sampled_at: previousSample?.sampled_at,
    interval_ms: intervalMs,
    average_cpu_cores: averageCpuCores,
    crawl_changed: crawlChanged,
    stats_changed: statsChanged,
    counter_delta:
      Object.keys(counterDelta).length > 0 ? counterDelta : undefined,
    last_progress_at: lastProgressAt,
    progress_age_ms: progressAgeMs,
    stall_observation_ms: STALL_OBSERVATION_MS,
  };
}

export function recordBeesTelemetryError(
  previous: BeesTelemetryStatus | undefined,
  err: unknown,
): BeesTelemetryStatus {
  return {
    ...(previous ?? {
      assessment: "unavailable" as const,
      stall_observation_ms: STALL_OBSERVATION_MS,
    }),
    error: `${err}`,
    error_at: new Date().toISOString(),
  };
}

export async function collectBeesTelemetry(
  mountpoint: string,
): Promise<BeesTelemetrySnapshot> {
  const result = await sudo({
    command: "bees-status",
    args: [mountpoint],
    err_on_exit: true,
    verbose: false,
  });
  const sample = JSON.parse(result.stdout) as BeesTelemetrySnapshot;
  if (!sample?.sampled_at) {
    throw new Error("BEES telemetry did not include sampled_at");
  }
  return sample;
}
