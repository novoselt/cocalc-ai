/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type {
  ActiveUserMapHistoryAccount,
  ActiveUserMapHistoryPoint,
  ActiveUserMapHistoryReport,
  ActiveUserMapHistorySeries,
  ActiveUserMapHistorySnapshot,
  ActiveUserMapHistoryWindowMinutes,
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
export const ACTIVE_USER_MAP_DAILY_HISTORY_DAYS = 2 * 364;
export const ACTIVE_USER_MAP_HOURLY_HISTORY_DAYS = 2 * 28;
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

type HistoryPointRow = Omit<
  ActiveUserMapHistoryPoint,
  "snapshot_hour" | "captured_at"
> & {
  snapshot_hour: Date | string;
  captured_at: Date | string;
};

function normalizeHistoryCountryCode(countryCode?: string): string | null {
  if (countryCode == null || !countryCode.trim()) return null;
  const normalized = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw Error("country_code must be a two-letter country code");
  }
  return normalized;
}

function validateHistoryWindow(
  activeMinutes: number,
): asserts activeMinutes is ActiveUserMapHistoryWindowMinutes {
  if (
    !ACTIVE_USER_MAP_HISTORY_WINDOWS.includes(activeMinutes as HistoryWindow)
  ) {
    throw Error("active_minutes must be 60 or 1440");
  }
}

export async function getActiveUserMapHistorySeries({
  client,
  active_minutes,
  days = active_minutes === 1440
    ? ACTIVE_USER_MAP_DAILY_HISTORY_DAYS
    : ACTIVE_USER_MAP_HOURLY_HISTORY_DAYS,
  country_code,
  now = new Date(),
}: {
  client?: PoolClient;
  active_minutes: ActiveUserMapHistoryWindowMinutes;
  days?: number;
  country_code?: string;
  now?: Date;
}): Promise<ActiveUserMapHistorySeries> {
  validateHistoryWindow(active_minutes);
  if (!Number.isInteger(days) || days < 1 || days > 10 * 365) {
    throw Error("days must be an integer between 1 and 3650");
  }
  if (!Number.isFinite(now.valueOf())) {
    throw Error("now must be a valid date");
  }
  const countryCode = normalizeHistoryCountryCode(country_code);
  const pool = client ?? getPool();
  const sampleQuery =
    active_minutes === 1440
      ? `SELECT DISTINCT ON ((snapshot_hour AT TIME ZONE 'UTC')::date)
                snapshot_hour, captured_at, total_active, mapped_active,
                unknown_location, usage_metrics_not_enabled, bay_count
           FROM active_user_map_history_snapshots
          WHERE active_minutes = $1
            AND snapshot_hour > $2::timestamptz - ($3::int * INTERVAL '1 day')
            AND snapshot_hour <= $2::timestamptz
          ORDER BY (snapshot_hour AT TIME ZONE 'UTC')::date,
                   snapshot_hour DESC`
      : `SELECT snapshot_hour, captured_at, total_active, mapped_active,
                unknown_location, usage_metrics_not_enabled, bay_count
           FROM active_user_map_history_snapshots
          WHERE active_minutes = $1
            AND snapshot_hour > $2::timestamptz - ($3::int * INTERVAL '1 day')
            AND snapshot_hour <= $2::timestamptz`;
  const { rows } = await pool.query<HistoryPointRow>(
    `WITH samples AS (${sampleQuery})
     SELECT s.snapshot_hour, s.captured_at, s.total_active, s.mapped_active,
            s.unknown_location, s.usage_metrics_not_enabled, s.bay_count,
            CASE WHEN $4::text IS NULL THEN s.total_active
                 ELSE COALESCE(c.active_count, 0)
             END AS active_count
       FROM samples s
       LEFT JOIN active_user_map_history_countries c
         ON c.snapshot_hour = s.snapshot_hour
        AND c.active_minutes = $1
        AND c.country_code = $4
      ORDER BY s.snapshot_hour`,
    [active_minutes, now, days, countryCode],
  );
  const countryRows = await pool.query<{ country_code: string }>(
    `SELECT DISTINCT country_code
       FROM active_user_map_history_countries
      WHERE active_minutes = $1
        AND snapshot_hour > $2::timestamptz - ($3::int * INTERVAL '1 day')
        AND snapshot_hour <= $2::timestamptz
      ORDER BY country_code`,
    [active_minutes, now, days],
  );
  return {
    active_minutes,
    days,
    country_code: countryCode,
    country_codes: countryRows.rows.map(({ country_code }) => country_code),
    points: rows.map((row) => ({
      ...row,
      snapshot_hour: new Date(row.snapshot_hour).toISOString(),
      captured_at: new Date(row.captured_at).toISOString(),
    })),
  };
}

type HistorySnapshotRow = Omit<
  ActiveUserMapHistorySnapshot,
  "snapshot_hour" | "captured_at" | "active_minutes" | "countries"
> & {
  snapshot_hour: Date | string;
  captured_at: Date | string;
};

export async function getActiveUserMapHistorySnapshot({
  client,
  active_minutes,
  snapshot_hour,
  direction = "nearest",
}: {
  client?: PoolClient;
  active_minutes: ActiveUserMapHistoryWindowMinutes;
  snapshot_hour?: string;
  direction?: "backward" | "forward" | "nearest";
}): Promise<ActiveUserMapHistorySnapshot | null> {
  validateHistoryWindow(active_minutes);
  const requested = snapshot_hour == null ? null : new Date(snapshot_hour);
  if (requested && !Number.isFinite(requested.valueOf())) {
    throw Error("snapshot_hour must be a valid timestamp");
  }
  if (!(["backward", "forward", "nearest"] as const).includes(direction)) {
    throw Error("invalid snapshot direction");
  }
  const pool = client ?? getPool();
  const boundary =
    requested == null
      ? ""
      : direction === "backward"
        ? "AND snapshot_hour <= $2::timestamptz"
        : direction === "forward"
          ? "AND snapshot_hour >= $2::timestamptz"
          : "";
  const ordering =
    requested == null
      ? "snapshot_hour DESC"
      : direction === "nearest"
        ? "ABS(EXTRACT(EPOCH FROM snapshot_hour - $2::timestamptz)), snapshot_hour DESC"
        : direction === "backward"
          ? "snapshot_hour DESC"
          : "snapshot_hour ASC";
  const { rows } = await pool.query<HistorySnapshotRow>(
    `SELECT snapshot_hour, captured_at, total_active, mapped_active,
            unknown_location, usage_metrics_not_enabled, bay_count
       FROM active_user_map_history_snapshots
      WHERE active_minutes = $1
        ${boundary}
      ORDER BY ${ordering}
      LIMIT 1`,
    requested == null ? [active_minutes] : [active_minutes, requested],
  );
  const row = rows[0];
  if (!row) return null;
  const countryRows = await pool.query<{
    country_code: string;
    count: number;
  }>(
    `SELECT country_code, active_count AS count
       FROM active_user_map_history_countries
      WHERE snapshot_hour = $1
        AND active_minutes = $2
      ORDER BY country_code`,
    [row.snapshot_hour, active_minutes],
  );
  return {
    ...row,
    active_minutes,
    snapshot_hour: new Date(row.snapshot_hour).toISOString(),
    captured_at: new Date(row.captured_at).toISOString(),
    countries: countryRows.rows,
  };
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
