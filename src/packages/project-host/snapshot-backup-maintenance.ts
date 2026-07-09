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

function shouldSkipForMemoryPressure(
  meminfoText = fs.readFileSync("/proc/meminfo", "utf8"),
):
  | {
      skip: false;
      availableBytes?: number;
      thresholdBytes?: number;
    }
  | {
      skip: true;
      availableBytes: number;
      thresholdBytes: number;
    } {
  const memory = parseMeminfo(meminfoText);
  if (!memory) return { skip: false };
  const thresholdBytes = memoryMaintenanceThresholdBytes(memory.totalBytes);
  if (memory.availableBytes < thresholdBytes) {
    return {
      skip: true,
      availableBytes: memory.availableBytes,
      thresholdBytes,
    };
  }
  return {
    skip: false,
    availableBytes: memory.availableBytes,
    thresholdBytes,
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
  const memoryGuard = shouldSkipForMemoryPressure();
  if (memoryGuard.skip) {
    logger.info("skipping snapshot/backup maintenance under memory pressure", {
      hostId,
      memory_available_bytes: memoryGuard.availableBytes,
      threshold_bytes: memoryGuard.thresholdBytes,
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
  const parallelism = parsePositiveInteger(
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_PARALLELISM,
    DEFAULT_PARALLELISM,
  );
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
  shouldSkipForMemoryPressure,
};
