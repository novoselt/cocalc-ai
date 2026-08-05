/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const PROJECT_POOL = "/sys/fs/cgroup/cocalc-project-pool";

export type ProjectWorkloadSample = {
  project_id: string;
  sampled_at_ms: number;
  cpu_usage_usec?: number;
  io_bytes?: number;
  io_operations?: number;
  io_full_pressure_usec?: number;
};

export type ProjectWorkloadRates = {
  cpu_cores: number;
  io_bytes_per_second: number;
  io_operations_per_second: number;
  io_full_pressure_percent: number;
};

export function parseCpuUsageUsec(raw: string): number | undefined {
  const value = Number(raw.match(/(?:^|\n)usage_usec\s+(\d+)/u)?.[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseIoTotals(raw: string): {
  bytes: number;
  operations: number;
} {
  let bytes = 0;
  let operations = 0;
  for (const line of raw.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (!fields[0]?.includes(":")) continue;
    for (const field of fields.slice(1)) {
      const [key, text] = field.split("=", 2);
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0) continue;
      if (key === "rbytes" || key === "wbytes") bytes += value;
      if (key === "rios" || key === "wios") operations += value;
    }
  }
  return { bytes, operations };
}

export function parseIoFullPressureUsec(raw: string): number | undefined {
  const value = Number(raw.match(/(?:^|\n)full\s+[^\n]*\btotal=(\d+)/u)?.[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function sampleProjectWorkloads({
  now = Date.now(),
  projectPool = PROJECT_POOL,
}: {
  now?: number;
  projectPool?: string;
} = {}): Promise<ProjectWorkloadSample[]> {
  const entries = (await readdir(projectPool, { withFileTypes: true })).filter(
    (entry) =>
      entry.isDirectory() && /^project-[0-9a-f-]{36}$/u.test(entry.name),
  );
  return await Promise.all(
    entries.map(async (entry): Promise<ProjectWorkloadSample> => {
      const project_id = entry.name.slice("project-".length);
      try {
        const [cpuRaw, ioRaw, ioPressureRaw] = await Promise.all([
          readFile(join(projectPool, entry.name, "cpu.stat"), "utf8"),
          readFile(join(projectPool, entry.name, "io.stat"), "utf8"),
          readFile(join(projectPool, entry.name, "io.pressure"), "utf8"),
        ]);
        const io = parseIoTotals(ioRaw);
        return {
          project_id,
          sampled_at_ms: now,
          cpu_usage_usec: parseCpuUsageUsec(cpuRaw),
          io_bytes: io.bytes,
          io_operations: io.operations,
          io_full_pressure_usec: parseIoFullPressureUsec(ioPressureRaw),
        };
      } catch {
        return { project_id, sampled_at_ms: now };
      }
    }),
  );
}

export class ProjectWorkloadActivityTracker {
  private readonly previous = new Map<string, ProjectWorkloadSample>();
  private readonly lastActiveMs = new Map<string, number>();
  private readonly latestRates = new Map<string, ProjectWorkloadRates>();

  constructor(
    private readonly opts: {
      protectionMs: number;
      activeCpuCores: number;
      activeBytesPerSecond: number;
      activeOperationsPerSecond: number;
    },
  ) {}

  update(samples: ProjectWorkloadSample[], now: number): Set<string> {
    const currentIds = new Set(samples.map(({ project_id }) => project_id));
    for (const projectId of this.previous.keys()) {
      if (!currentIds.has(projectId)) {
        this.previous.delete(projectId);
        this.lastActiveMs.delete(projectId);
        this.latestRates.delete(projectId);
      }
    }

    const protectedProjects = new Set<string>();
    for (const sample of samples) {
      const previous = this.previous.get(sample.project_id);
      const rates = this.rates(previous, sample);
      if (rates) {
        this.latestRates.set(sample.project_id, rates);
      } else {
        this.latestRates.delete(sample.project_id);
      }
      const active = rates == null || this.isActive(rates);
      if (active) {
        this.lastActiveMs.set(sample.project_id, now);
      }
      this.previous.set(sample.project_id, sample);
      const lastActive = this.lastActiveMs.get(sample.project_id);
      if (lastActive == null || now - lastActive < this.opts.protectionMs) {
        protectedProjects.add(sample.project_id);
      }
    }
    return protectedProjects;
  }

  ratesByProject(): ReadonlyMap<string, ProjectWorkloadRates> {
    return this.latestRates;
  }

  private rates(
    previous: ProjectWorkloadSample | undefined,
    current: ProjectWorkloadSample,
  ): ProjectWorkloadRates | undefined {
    if (
      !previous ||
      previous.cpu_usage_usec == null ||
      previous.io_bytes == null ||
      previous.io_operations == null ||
      previous.io_full_pressure_usec == null ||
      current.cpu_usage_usec == null ||
      current.io_bytes == null ||
      current.io_operations == null ||
      current.io_full_pressure_usec == null
    ) {
      return undefined;
    }
    const elapsedSeconds =
      (current.sampled_at_ms - previous.sampled_at_ms) / 1000;
    if (!(elapsedSeconds > 0)) return undefined;
    const cpuUsec = current.cpu_usage_usec - previous.cpu_usage_usec;
    const ioBytes = current.io_bytes - previous.io_bytes;
    const ioOperations = current.io_operations - previous.io_operations;
    const ioFullPressureUsec =
      current.io_full_pressure_usec - previous.io_full_pressure_usec;
    if (
      cpuUsec < 0 ||
      ioBytes < 0 ||
      ioOperations < 0 ||
      ioFullPressureUsec < 0
    ) {
      return undefined;
    }
    return {
      cpu_cores: cpuUsec / 1_000_000 / elapsedSeconds,
      io_bytes_per_second: ioBytes / elapsedSeconds,
      io_operations_per_second: ioOperations / elapsedSeconds,
      io_full_pressure_percent: Math.min(
        100,
        (ioFullPressureUsec / 1_000_000 / elapsedSeconds) * 100,
      ),
    };
  }

  private isActive(rates: ProjectWorkloadRates): boolean {
    return (
      rates.cpu_cores >= this.opts.activeCpuCores ||
      rates.io_bytes_per_second >= this.opts.activeBytesPerSecond ||
      rates.io_operations_per_second >= this.opts.activeOperationsPerSecond
    );
  }
}
