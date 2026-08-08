/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type {
  ActiveUserMapHistoryAccount,
  ActiveUserMapHistoryReport,
} from "@cocalc/conat/inter-bay/api";
import getPool, { type PoolClient } from "@cocalc/database/pool";
import { getServerSettings } from "@cocalc/database/settings/server-settings";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { listConfiguredBaysAuthoritative } from "@cocalc/server/bay-directory";
import { getConfiguredClusterSeedBayId } from "@cocalc/server/cluster-config";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import { COOKIE_CONSENT_REVISION } from "@cocalc/util/cookie-consent";

const logger = getLogger("server:active-user-map-history");

export const ACTIVE_USER_MAP_HISTORY_WINDOWS = [60, 1440] as const;
// Country-level aggregates are small and retain long-term analytical value.
// Set this to a positive number to enable automatic pruning.
export const ACTIVE_USER_MAP_HISTORY_RETENTION_MONTHS: number | null = null;

const MAX_ACTIVITY_MINUTES = 1440;
const MAINTENANCE_INTERVAL_MS = 5 * 60_000;
const COLLECTION_LOCK = "active-user-map-history-collection";

type HistoryWindow = (typeof ACTIVE_USER_MAP_HISTORY_WINDOWS)[number];

type HistoryAccountRow = {
  account_id: string;
  last_active: Date | string;
  country_code: string | null;
  usage_metrics_enabled: boolean;
};

export interface ActiveUserMapHistoryAggregate {
  active_minutes: HistoryWindow;
  total_active: number;
  mapped_active: number;
  unknown_location: number;
  usage_metrics_not_enabled: number;
  countries: Array<{ country_code: string; active_count: number }>;
}

export async function getActiveUserMapHistoryReport({
  usage_metrics_consent_required,
  captured_at,
}: {
  usage_metrics_consent_required: boolean;
  captured_at: string;
}): Promise<ActiveUserMapHistoryReport> {
  const bay_id = getConfiguredBayId();
  const capturedAt = new Date(captured_at);
  if (!Number.isFinite(capturedAt.valueOf())) {
    throw Error("captured_at must be a valid timestamp");
  }
  const { rows } = await getPool().query<HistoryAccountRow>(
    `SELECT a.account_id, a.last_active, p.country_code,
            CASE
              WHEN NOT $2::boolean THEN TRUE
              ELSE
                COALESCE(
                  a.other_settings #>> '{cookie_consent,revision}', ''
                ) = $3
                AND COALESCE(
                  a.other_settings #>> '{cookie_consent,usage}', ''
                ) = 'true'
            END AS usage_metrics_enabled
       FROM accounts a
       LEFT JOIN account_presence_locations p
         ON p.account_id = a.account_id
        AND p.observed_at <= $5::timestamptz
        AND p.expire > $5::timestamptz
      WHERE a.last_active >= $5::timestamptz - ($4 * INTERVAL '1 minute')
        AND a.last_active <= $5::timestamptz
        AND a.deleted IS NOT TRUE
        AND (
          a.home_bay_id IS NULL
          OR BTRIM(a.home_bay_id) = ''
          OR a.home_bay_id = $1
        )
      ORDER BY a.last_active DESC`,
    [
      bay_id,
      usage_metrics_consent_required,
      `${COOKIE_CONSENT_REVISION}`,
      MAX_ACTIVITY_MINUTES,
      capturedAt,
    ],
  );
  return {
    bay_id,
    accounts: rows.map((row) => ({
      account_id: row.account_id,
      last_active: new Date(row.last_active).toISOString(),
      country_code: row.country_code,
      usage_metrics_enabled: row.usage_metrics_enabled === true,
    })),
  };
}

function shouldReplaceHistoryAccount(
  current: ActiveUserMapHistoryAccount | undefined,
  candidate: ActiveUserMapHistoryAccount,
): boolean {
  if (!current) return true;
  const currentTime = new Date(current.last_active).valueOf();
  const candidateTime = new Date(candidate.last_active).valueOf();
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  // A duplicate non-consenting home record must never be overridden by a
  // stale consenting copy from another bay.
  if (current.usage_metrics_enabled !== candidate.usage_metrics_enabled) {
    return !candidate.usage_metrics_enabled;
  }
  return current.country_code == null && candidate.country_code != null;
}

export function aggregateActiveUserMapHistoryReports({
  reports,
  captured_at,
}: {
  reports: ActiveUserMapHistoryReport[];
  captured_at: Date;
}): ActiveUserMapHistoryAggregate[] {
  const accounts = new Map<string, ActiveUserMapHistoryAccount>();
  for (const report of reports) {
    for (const account of report.accounts) {
      if (
        shouldReplaceHistoryAccount(accounts.get(account.account_id), account)
      ) {
        accounts.set(account.account_id, account);
      }
    }
  }

  return ACTIVE_USER_MAP_HISTORY_WINDOWS.map((active_minutes) => {
    const cutoff = captured_at.valueOf() - active_minutes * 60_000;
    const countries = new Map<string, number>();
    let total_active = 0;
    let unknown_location = 0;
    let usage_metrics_not_enabled = 0;
    for (const account of accounts.values()) {
      const lastActive = new Date(account.last_active).valueOf();
      if (!Number.isFinite(lastActive) || lastActive < cutoff) continue;
      total_active += 1;
      if (!account.usage_metrics_enabled) {
        usage_metrics_not_enabled += 1;
        continue;
      }
      const countryCode = `${account.country_code ?? ""}`.trim().toUpperCase();
      if (
        !/^[A-Z0-9]{2}$/.test(countryCode) ||
        countryCode === "XX" ||
        countryCode === "K1"
      ) {
        unknown_location += 1;
        continue;
      }
      countries.set(countryCode, (countries.get(countryCode) ?? 0) + 1);
    }
    const countryRows = [...countries.entries()]
      .map(([country_code, active_count]) => ({
        country_code,
        active_count,
      }))
      .sort((a, b) => a.country_code.localeCompare(b.country_code));
    const mapped_active = countryRows.reduce(
      (sum, country) => sum + country.active_count,
      0,
    );
    return {
      active_minutes,
      total_active,
      mapped_active,
      unknown_location,
      usage_metrics_not_enabled,
      countries: countryRows,
    };
  });
}

function snapshotHour(capturedAt: Date): Date {
  const value = new Date(capturedAt);
  value.setUTCMinutes(0, 0, 0);
  return value;
}

export async function storeActiveUserMapHistorySnapshots({
  client,
  captured_at,
  bay_count,
  snapshots,
}: {
  client: PoolClient;
  captured_at: Date;
  bay_count: number;
  snapshots: ActiveUserMapHistoryAggregate[];
}): Promise<void> {
  const snapshot_hour = snapshotHour(captured_at);
  await client.query("BEGIN");
  try {
    for (const snapshot of snapshots) {
      await client.query(
        `INSERT INTO active_user_map_history_snapshots
           (snapshot_hour, active_minutes, captured_at, total_active,
            mapped_active, unknown_location, usage_metrics_not_enabled,
            bay_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (snapshot_hour, active_minutes) DO UPDATE SET
           captured_at = EXCLUDED.captured_at,
           total_active = EXCLUDED.total_active,
           mapped_active = EXCLUDED.mapped_active,
           unknown_location = EXCLUDED.unknown_location,
           usage_metrics_not_enabled = EXCLUDED.usage_metrics_not_enabled,
           bay_count = EXCLUDED.bay_count`,
        [
          snapshot_hour,
          snapshot.active_minutes,
          captured_at,
          snapshot.total_active,
          snapshot.mapped_active,
          snapshot.unknown_location,
          snapshot.usage_metrics_not_enabled,
          bay_count,
        ],
      );
      await client.query(
        `DELETE FROM active_user_map_history_countries
          WHERE snapshot_hour = $1 AND active_minutes = $2`,
        [snapshot_hour, snapshot.active_minutes],
      );
      if (snapshot.countries.length) {
        const params: unknown[] = [];
        const values = snapshot.countries.map((country, index) => {
          const offset = index * 4;
          params.push(
            snapshot_hour,
            snapshot.active_minutes,
            country.country_code,
            country.active_count,
          );
          return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
        });
        await client.query(
          `INSERT INTO active_user_map_history_countries
             (snapshot_hour, active_minutes, country_code, active_count)
           VALUES ${values.join(", ")}`,
          params,
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

export async function pruneActiveUserMapHistory({
  client,
  now = new Date(),
  retentionMonths = ACTIVE_USER_MAP_HISTORY_RETENTION_MONTHS,
}: {
  client: PoolClient;
  now?: Date;
  retentionMonths?: number | null;
}): Promise<{ countries: number; snapshots: number }> {
  if (retentionMonths == null) {
    return { countries: 0, snapshots: 0 };
  }
  if (!Number.isInteger(retentionMonths) || retentionMonths <= 0) {
    throw Error("retentionMonths must be a positive integer or null");
  }
  const countryResult = await client.query(
    `DELETE FROM active_user_map_history_countries
      WHERE snapshot_hour <
        $1::timestamptz - ($2::int * INTERVAL '1 month')`,
    [now, retentionMonths],
  );
  const snapshotResult = await client.query(
    `DELETE FROM active_user_map_history_snapshots
      WHERE snapshot_hour <
        $1::timestamptz - ($2::int * INTERVAL '1 month')`,
    [now, retentionMonths],
  );
  return {
    countries: countryResult.rowCount ?? 0,
    snapshots: snapshotResult.rowCount ?? 0,
  };
}

async function collectHistoryReports({
  usage_metrics_consent_required,
  captured_at,
}: {
  usage_metrics_consent_required: boolean;
  captured_at: Date;
}): Promise<
  | { complete: true; reports: ActiveUserMapHistoryReport[] }
  | { complete: false; failed_bays: string[] }
> {
  const currentBayId = getConfiguredBayId();
  const bayIds = [
    ...new Set(
      (await listConfiguredBaysAuthoritative())
        .map(({ bay_id }) => `${bay_id ?? ""}`.trim())
        .filter(Boolean)
        .concat(currentBayId),
    ),
  ].sort();
  const settled = await Promise.allSettled(
    bayIds.map(async (bay_id) =>
      bay_id === currentBayId
        ? await getActiveUserMapHistoryReport({
            usage_metrics_consent_required,
            captured_at: captured_at.toISOString(),
          })
        : await getInterBayBridge()
            .bayOps(bay_id, { timeout_ms: 10_000 })
            .getActiveUserMapHistoryReport({
              usage_metrics_consent_required,
              captured_at: captured_at.toISOString(),
            }),
    ),
  );
  const reports: ActiveUserMapHistoryReport[] = [];
  const failed_bays: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      reports.push(result.value);
    } else {
      failed_bays.push(bayIds[index]);
    }
  });
  return failed_bays.length
    ? { complete: false, failed_bays }
    : { complete: true, reports };
}

export type ActiveUserMapHistoryMaintenanceResult =
  | { status: "not-seed" | "locked" | "disabled" | "already-recorded" }
  | { status: "incomplete"; failed_bays: string[] }
  | { status: "recorded"; active_minutes: HistoryWindow[]; bay_count: number };

export async function runActiveUserMapHistoryMaintenanceOnce({
  now = new Date(),
}: {
  now?: Date;
} = {}): Promise<ActiveUserMapHistoryMaintenanceResult> {
  if (getConfiguredBayId() !== getConfiguredClusterSeedBayId()) {
    return { status: "not-seed" };
  }
  const client = await getPool().connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [COLLECTION_LOCK],
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { status: "locked" };

    const deleted = await pruneActiveUserMapHistory({ client, now });
    if (deleted.countries || deleted.snapshots) {
      logger.info("pruned active user map history", deleted);
    }

    const settings = await getServerSettings();
    if (settings.active_user_map_enabled !== true) {
      return { status: "disabled" };
    }

    const hour = snapshotHour(now);
    const existing = await client.query<{ active_minutes: number }>(
      `SELECT active_minutes
         FROM active_user_map_history_snapshots
        WHERE snapshot_hour = $1
          AND active_minutes = ANY($2::int[])`,
      [hour, [...ACTIVE_USER_MAP_HISTORY_WINDOWS]],
    );
    const existingWindows = new Set(
      existing.rows.map(({ active_minutes }) => Number(active_minutes)),
    );
    const missingWindows = ACTIVE_USER_MAP_HISTORY_WINDOWS.filter(
      (window) => !existingWindows.has(window),
    );
    if (!missingWindows.length) return { status: "already-recorded" };

    const collected = await collectHistoryReports({
      usage_metrics_consent_required: settings.cookie_banner_enabled === true,
      captured_at: now,
    });
    if (!collected.complete) {
      logger.warn("active user map history snapshot skipped", {
        snapshot_hour: hour.toISOString(),
        failed_bays: collected.failed_bays,
      });
      return { status: "incomplete", failed_bays: collected.failed_bays };
    }

    const snapshots = aggregateActiveUserMapHistoryReports({
      reports: collected.reports,
      captured_at: now,
    }).filter(({ active_minutes }) => missingWindows.includes(active_minutes));
    await storeActiveUserMapHistorySnapshots({
      client,
      captured_at: now,
      bay_count: collected.reports.length,
      snapshots,
    });
    logger.info("recorded active user map history snapshot", {
      snapshot_hour: hour.toISOString(),
      active_minutes: missingWindows,
      bay_count: collected.reports.length,
    });
    return {
      status: "recorded",
      active_minutes: [...missingWindows],
      bay_count: collected.reports.length,
    };
  } finally {
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [COLLECTION_LOCK])
        .catch((err) => {
          logger.warn("failed to release active user map history lock", {
            err: `${err}`,
          });
        });
    }
    client.release();
  }
}

let maintenanceStarted = false;
let maintenanceRunning = false;

async function runMaintenanceTick(): Promise<void> {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    await runActiveUserMapHistoryMaintenanceOnce();
  } catch (err) {
    logger.warn("active user map history maintenance failed", {
      err: `${err}`,
    });
  } finally {
    maintenanceRunning = false;
  }
}

export function startActiveUserMapHistoryMaintenance(): void {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  const timer = setInterval(() => {
    void runMaintenanceTick();
  }, MAINTENANCE_INTERVAL_MS);
  timer.unref?.();
  void runMaintenanceTick();
}
