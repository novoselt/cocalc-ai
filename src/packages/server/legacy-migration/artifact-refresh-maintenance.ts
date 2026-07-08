/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";

import {
  defaultRefreshArtifactsFromR2Options,
  refreshArtifactsFromR2,
} from "./refresh-artifacts-from-r2";

const logger = getLogger("server:legacy-migration:artifact-refresh");

const LOCK_KEY = "legacy_migration_artifact_refresh";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60_000;

let timer: NodeJS.Timeout | undefined;
let running = false;

function envBoolean(name: string, defaultValue: boolean): boolean {
  const value = `${process.env[name] ?? ""}`.trim().toLowerCase();
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value);
}

function envPositiveInteger(name: string): number | undefined {
  const value = `${process.env[name] ?? ""}`.trim();
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

function envString(name: string): string | undefined {
  const value = `${process.env[name] ?? ""}`.trim();
  return value || undefined;
}

async function withMaintenanceLock<T>(
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [LOCK_KEY],
    );
    if (!rows[0]?.locked) return undefined;
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function runLegacyMigrationArtifactRefreshMaintenanceTick() {
  if (running) return;
  running = true;
  try {
    return await withMaintenanceLock(async () => {
      const options = defaultRefreshArtifactsFromR2Options();
      options.markMissingUnavailable = false;
      options.bucket =
        envString("COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_BUCKET") ??
        options.bucket;
      options.prefix =
        envString("COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_PREFIX") ??
        options.prefix;
      options.suffix =
        envString("COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_SUFFIX") ??
        options.suffix;
      options.batchSize =
        envPositiveInteger(
          "COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_BATCH_SIZE",
        ) ?? options.batchSize;
      options.updateBatchSize =
        envPositiveInteger(
          "COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_UPDATE_BATCH_SIZE",
        ) ?? options.updateBatchSize;

      const stats = await refreshArtifactsFromR2(options);
      logger.info("legacy migration artifact refresh completed", {
        pages: stats.pages,
        listed_objects: stats.listedObjects,
        matched_objects: stats.matchedObjects,
        available_rows: stats.availableRows,
        unavailable_rows: stats.unavailableRows,
        total_compressed_bytes: stats.totalCompressedBytes,
      });
      return stats;
    });
  } catch (err) {
    logger.error("legacy migration artifact refresh failed", err);
  } finally {
    running = false;
  }
}

export function startLegacyMigrationArtifactRefreshMaintenance(): void {
  if (!envBoolean("COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_ENABLED", false)) {
    logger.info("legacy migration artifact refresh maintenance disabled");
    return;
  }
  if (timer) return;
  const intervalMs = Math.max(
    60_000,
    envPositiveInteger("COCALC_LEGACY_PROJECT_ARTIFACT_REFRESH_INTERVAL_MS") ??
      DEFAULT_INTERVAL_MS,
  );
  timer = setInterval(() => {
    void runLegacyMigrationArtifactRefreshMaintenanceTick();
  }, intervalMs);
  timer.unref?.();
  void runLegacyMigrationArtifactRefreshMaintenanceTick();
  logger.info("legacy migration artifact refresh maintenance started", {
    interval_ms: intervalMs,
    mark_missing_unavailable: false,
  });
}

export function stopLegacyMigrationArtifactRefreshMaintenanceForTests(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  running = false;
}
