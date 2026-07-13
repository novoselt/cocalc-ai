import * as fs from "node:fs";

import getLogger from "@cocalc/backend/logger";
import { createHostStatusClient } from "@cocalc/conat/project-host/api";
import {
  DEFAULT_BACKUP_COUNTS,
  DEFAULT_SNAPSHOT_COUNTS,
  type SnapshotCounts,
  type SnapshotSchedule,
} from "@cocalc/util/consts/snapshots";
import { getMasterConatClient } from "./master-status";
import {
  runScheduledBackupMaintenance,
  runScheduledSnapshotMaintenance,
} from "./file-server";

const logger = getLogger("project-host:snapshot-backup-maintenance");

const DEFAULT_ACTIVE_DAYS = 2;
const DEFAULT_SWEEP_MS = 15 * 60 * 1000;
const DEFAULT_PARALLELISM = 4;
const DEFAULT_INITIAL_DELAY_MS = DEFAULT_SWEEP_MS;
const GIB = 1024 ** 3;
const DEFAULT_MEMORY_AVAILABLE_RATIO = 0.25;
const DEFAULT_MEMORY_AVAILABLE_MIN_BYTES = 2 * GIB;
const DEFAULT_MEMORY_AVAILABLE_MAX_BYTES = 16 * GIB;
const DEFAULT_MEMORY_AVAILABLE_HARD_MIN_BYTES = 4 * GIB;
const DEFAULT_MEMORY_PSI_FULL_AVG10_MAX = 5;

const inFlightProjects = new Set<string>();

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseRatio(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1
    ? parsed
    : fallback;
}

function parseMeminfo(text: string):
  | {
      totalBytes: number;
      availableBytes: number;
    }
  | undefined {
  let totalKb: number | undefined;
  let availableKb: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(MemTotal|MemAvailable):\s+(\d+)\s+kB$/);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0) continue;
    if (match[1] === "MemTotal") totalKb = value;
    if (match[1] === "MemAvailable") availableKb = value;
  }
  if (totalKb == null || availableKb == null || totalKb <= 0) {
    return undefined;
  }
  return {
    totalBytes: totalKb * 1024,
    availableBytes: availableKb * 1024,
  };
}

function memoryMaintenanceThresholdBytes(totalBytes: number): number {
  const ratio = parseRatio(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MIN_MEMORY_AVAILABLE_RATIO,
    DEFAULT_MEMORY_AVAILABLE_RATIO,
  );
  const minBytes = parseNonNegativeInteger(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MIN_MEMORY_AVAILABLE_BYTES,
    DEFAULT_MEMORY_AVAILABLE_MIN_BYTES,
  );
  const maxBytes = parseNonNegativeInteger(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MAX_MEMORY_AVAILABLE_BYTES,
    DEFAULT_MEMORY_AVAILABLE_MAX_BYTES,
  );
  const ratioBytes = Math.floor(totalBytes * ratio);
  return Math.min(Math.max(minBytes, ratioBytes), maxBytes);
}

function parsePressureFullAvg10(text: string): number | undefined {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("full ")) continue;
    const match = line.match(/\bavg10=([0-9.]+)/);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  return undefined;
}

function readMemoryPressure(): string | undefined {
  try {
    return fs.readFileSync("/proc/pressure/memory", "utf8");
  } catch {
    return undefined;
  }
}

function maintenanceMemoryDecision({
  configuredParallelism,
  meminfoText = fs.readFileSync("/proc/meminfo", "utf8"),
  pressureText = readMemoryPressure(),
}: {
  configuredParallelism: number;
  meminfoText?: string;
  pressureText?: string;
}):
  | {
      skip: false;
      parallelism: number;
      availableBytes?: number;
      preferredBytes?: number;
      hardMinBytes?: number;
      pressureFullAvg10?: number;
    }
  | {
      skip: true;
      reason: "available_memory" | "memory_pressure";
      availableBytes?: number;
      preferredBytes?: number;
      hardMinBytes?: number;
      pressureFullAvg10?: number;
    } {
  const memory = parseMeminfo(meminfoText);
  if (!memory) {
    return { skip: false, parallelism: configuredParallelism };
  }
  const preferredBytes = memoryMaintenanceThresholdBytes(memory.totalBytes);
  // A zero preferred threshold is the documented escape hatch used by tests
  // and constrained development hosts to disable the memory guard.
  if (preferredBytes <= 0) {
    return {
      skip: false,
      parallelism: configuredParallelism,
      availableBytes: memory.availableBytes,
      preferredBytes,
      hardMinBytes: 0,
    };
  }
  const hardMinBytes = Math.min(
    preferredBytes,
    parseNonNegativeInteger(
      process.env
        .COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_HARD_MIN_MEMORY_AVAILABLE_BYTES,
      DEFAULT_MEMORY_AVAILABLE_HARD_MIN_BYTES,
    ),
  );
  const pressureFullAvg10 = pressureText
    ? parsePressureFullAvg10(pressureText)
    : undefined;
  const pressureMax = Number(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MEMORY_PSI_FULL_AVG10_MAX,
  );
  const effectivePressureMax =
    Number.isFinite(pressureMax) && pressureMax >= 0
      ? pressureMax
      : DEFAULT_MEMORY_PSI_FULL_AVG10_MAX;
  if (
    pressureFullAvg10 != null &&
    effectivePressureMax > 0 &&
    pressureFullAvg10 >= effectivePressureMax
  ) {
    return {
      skip: true,
      reason: "memory_pressure",
      availableBytes: memory.availableBytes,
      preferredBytes,
      hardMinBytes,
      pressureFullAvg10,
    };
  }
  if (memory.availableBytes < hardMinBytes) {
    return {
      skip: true,
      reason: "available_memory",
      availableBytes: memory.availableBytes,
      preferredBytes,
      hardMinBytes,
      pressureFullAvg10,
    };
  }
  return {
    skip: false,
    parallelism:
      memory.availableBytes < preferredBytes ? 1 : configuredParallelism,
    availableBytes: memory.availableBytes,
    preferredBytes,
    hardMinBytes,
    pressureFullAvg10,
  };
}

function mergeSchedule(
  defaults: SnapshotCounts,
  schedule: SnapshotSchedule | null | undefined,
): SnapshotSchedule {
  return {
    ...defaults,
    ...(schedule ?? {}),
  };
}

function scheduleToCounts(
  schedule: SnapshotSchedule,
  { allowFrequent = true }: { allowFrequent?: boolean } = {},
): SnapshotCounts {
  return {
    frequent: allowFrequent ? schedule.frequent : 0,
    daily: schedule.daily,
    weekly: schedule.weekly,
    monthly: schedule.monthly,
  };
}

async function runWithParallelism<T>(
  items: T[],
  parallelism: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0;
  const width = Math.max(1, parallelism);
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (true) {
        const current = index++;
        if (current >= items.length) {
          return;
        }
        await worker(items[current]);
      }
    }),
  );
}

export async function runProjectSnapshotBackupMaintenanceSweepOnce({
  hostId,
}: {
  hostId: string;
}) {
  const configuredParallelism = parsePositiveInteger(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_PARALLELISM,
    DEFAULT_PARALLELISM,
  );
  const memoryDecision = maintenanceMemoryDecision({ configuredParallelism });
  if (memoryDecision.skip) {
    logger.info("skipping snapshot/backup maintenance under memory pressure", {
      hostId,
      reason: memoryDecision.reason,
      memory_available_bytes: memoryDecision.availableBytes,
      preferred_bytes: memoryDecision.preferredBytes,
      hard_min_bytes: memoryDecision.hardMinBytes,
      memory_psi_full_avg10: memoryDecision.pressureFullAvg10,
    });
    return;
  }
  const client = getMasterConatClient();
  if (!client) {
    logger.debug("skipping maintenance sweep without master conat client");
    return;
  }
  const statusClient = createHostStatusClient({
    client,
    timeout: 60_000,
  });
  const activeDays = parseNonNegativeInteger(
    process.env.COCALC_PROJECT_HOST_MAINTENANCE_ACTIVE_DAYS,
    DEFAULT_ACTIVE_DAYS,
  );
  const parallelism = memoryDecision.parallelism;
  if (parallelism < configuredParallelism) {
    logger.info("reducing snapshot/backup maintenance parallelism", {
      hostId,
      configured_parallelism: configuredParallelism,
      effective_parallelism: parallelism,
      memory_available_bytes: memoryDecision.availableBytes,
      preferred_bytes: memoryDecision.preferredBytes,
      hard_min_bytes: memoryDecision.hardMinBytes,
    });
  }
  const rows = await statusClient.listProjectMaintenanceSchedules({
    host_id: hostId,
    active_days: activeDays,
  });
  if (!rows.length) {
    logger.debug("no active projects eligible for maintenance", { hostId });
    return;
  }
  await runWithParallelism(rows, parallelism, async (row) => {
    const project_id = `${row.project_id ?? ""}`.trim();
    if (!project_id) {
      return;
    }
    if (inFlightProjects.has(project_id)) {
      logger.debug("skipping overlapping maintenance sweep", { project_id });
      return;
    }
    inFlightProjects.add(project_id);
    try {
      const snapshotSchedule = mergeSchedule(
        DEFAULT_SNAPSHOT_COUNTS,
        row.snapshots,
      );
      if (!snapshotSchedule.disabled) {
        try {
          await runScheduledSnapshotMaintenance({
            project_id,
            counts: scheduleToCounts(snapshotSchedule),
            limit: row.max_snapshots_per_project ?? undefined,
          });
        } catch (err) {
          logger.warn("scheduled snapshot maintenance failed", {
            hostId,
            project_id,
            err: `${err}`,
          });
        }
      }
      const backupSchedule = mergeSchedule(DEFAULT_BACKUP_COUNTS, row.backups);
      if (!backupSchedule.disabled) {
        try {
          await runScheduledBackupMaintenance({
            project_id,
            counts: scheduleToCounts(backupSchedule, { allowFrequent: false }),
            limit: row.max_backups_per_project ?? undefined,
          });
        } catch (err) {
          logger.warn("scheduled backup maintenance failed", {
            hostId,
            project_id,
            err: `${err}`,
          });
        }
      }
    } catch (err) {
      logger.warn("snapshot/backup maintenance failed", {
        hostId,
        project_id,
        err: `${err}`,
      });
    } finally {
      inFlightProjects.delete(project_id);
    }
  });
}

export function startProjectSnapshotBackupMaintenance({
  hostId,
}: {
  hostId: string;
}) {
  if (parseBoolean(process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_DISABLE)) {
    logger.info("snapshot/backup maintenance disabled by env", { hostId });
    return () => {};
  }
  const sweepMs = parsePositiveInteger(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_SWEEP_MS,
    DEFAULT_SWEEP_MS,
  );
  const initialDelayMs = parseNonNegativeInteger(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_INITIAL_DELAY_MS,
    DEFAULT_INITIAL_DELAY_MS,
  );
  let closed = false;
  const runSweep = async () => {
    if (closed) {
      return;
    }
    try {
      await runProjectSnapshotBackupMaintenanceSweepOnce({ hostId });
    } catch (err) {
      logger.warn("snapshot/backup maintenance sweep failed", {
        hostId,
        err: `${err}`,
      });
    }
  };
  logger.info("snapshot/backup maintenance scheduled", {
    hostId,
    initial_delay_ms: initialDelayMs,
    sweep_ms: sweepMs,
  });
  const startRepeatingSweep = () => {
    if (closed) return;
    const timer = setInterval(() => {
      void runSweep();
    }, sweepMs);
    timer.unref();
    return timer;
  };
  const initialTimer = setTimeout(() => {
    if (closed) {
      return;
    }
    void runSweep();
    repeatingTimer = startRepeatingSweep();
  }, initialDelayMs);
  initialTimer.unref();
  let repeatingTimer: ReturnType<typeof setInterval> | undefined;
  return () => {
    closed = true;
    clearTimeout(initialTimer);
    if (repeatingTimer) {
      clearInterval(repeatingTimer);
    }
  };
}

export const _test = {
  parseMeminfo,
  parsePressureFullAvg10,
  maintenanceMemoryDecision,
};
