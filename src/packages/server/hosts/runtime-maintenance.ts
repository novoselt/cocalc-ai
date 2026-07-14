/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";

import getLogger from "@cocalc/backend/logger";
import { createHostControlClient } from "@cocalc/conat/project-host/api";
import getPool from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { enqueueCloudVmWorkOnce } from "@cocalc/server/cloud/db";
import { getExplicitHostControlClient } from "@cocalc/server/conat/route-client";
import adminAlert from "@cocalc/server/messages/admin-alert";

const logger = getLogger("server:hosts:runtime-maintenance");

const HEARTBEAT_FRESH_MS = 2 * 60_000;
const SYNTHETIC_PROBE_SUCCESS_INTERVAL_MS = Math.max(
  5 * 60_000,
  Number(process.env.COCALC_HOST_SYNTHETIC_PROBE_INTERVAL_MS ?? 30 * 60_000),
);
const SYNTHETIC_PROBE_FAILURE_RETRY_MS = Math.max(
  30_000,
  Number(process.env.COCALC_HOST_SYNTHETIC_PROBE_RETRY_MS ?? 90_000),
);
const SYNTHETIC_PROBE_CLAIM_TIMEOUT_MS = Math.max(
  5 * 60_000,
  Number(
    process.env.COCALC_HOST_SYNTHETIC_PROBE_CLAIM_TIMEOUT_MS ?? 15 * 60_000,
  ),
);
const SYNTHETIC_PROBE_RPC_TIMEOUT_MS = Math.max(
  2 * 60_000,
  Number(process.env.COCALC_HOST_SYNTHETIC_PROBE_RPC_TIMEOUT_MS ?? 15 * 60_000),
);
const SYNTHETIC_PROBE_ALERT_INTERVAL_MS = Math.max(
  60_000,
  Number(
    process.env.COCALC_HOST_SYNTHETIC_PROBE_ALERT_INTERVAL_MS ?? 15 * 60_000,
  ),
);
const SYNTHETIC_PROBE_CONCURRENCY = Math.max(
  1,
  Math.min(
    8,
    Math.floor(
      Number(process.env.COCALC_HOST_SYNTHETIC_PROBE_CONCURRENCY ?? 2),
    ) || 2,
  ),
);
const AUTO_REBOOT_WINDOW_MS = Math.max(
  60 * 60_000,
  Number(
    process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_WINDOW_MS ?? 6 * 60 * 60_000,
  ),
);
const AUTO_REBOOT_COOLDOWN_MS = Math.max(
  5 * 60_000,
  Number(
    process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_COOLDOWN_MS ?? 15 * 60_000,
  ),
);
const AUTO_REBOOT_MAX_ATTEMPTS = Math.max(
  1,
  Math.min(
    5,
    Math.floor(
      Number(process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_MAX_ATTEMPTS ?? 2),
    ) || 2,
  ),
);
const AUTO_REBOOT_MIN_FAILURES = Math.max(
  2,
  Math.floor(
    Number(process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_MIN_FAILURES ?? 2),
  ) || 2,
);
const AUTO_REBOOT_DIAGNOSTIC_SETTLE_MS = Math.max(
  10_000,
  Number(
    process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_DIAGNOSTIC_SETTLE_MS ?? 30_000,
  ),
);
const AUTO_REBOOT_FLEET_SPACING_MS = Math.max(
  5 * 60_000,
  Number(
    process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_FLEET_SPACING_MS ?? 10 * 60_000,
  ),
);
const ERROR_LIMIT = 2000;

type RuntimeHostRow = {
  id: string;
  name?: string | null;
  public_url?: string | null;
  status?: string | null;
  last_seen?: Date | string | null;
  metadata?: Record<string, any> | null;
};

type RebootAttempt = {
  at: string;
  host_boot_id: string;
  host_session_id?: string;
  work_id?: string;
};

type AutoRebootDecision =
  | { action: "wait"; reason: string }
  | { action: "exhausted"; attempts: RebootAttempt[] }
  | { action: "reboot"; attempts: RebootAttempt[] };

const RECOVERABLE_AUTO_REBOOT_STATUSES = new Set([
  "scheduled",
  "exhausted",
  "enqueue_failed",
]);

function pool() {
  return getPool();
}

function enabled(value: string | undefined, defaultValue = true): boolean {
  if (value == null || !value.trim()) return defaultValue;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function timestampMs(value: unknown): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}`).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorText(err: unknown): string {
  return (`${err}`.trim() || "unknown runtime probe error").slice(
    0,
    ERROR_LIMIT,
  );
}

function hostName(row: RuntimeHostRow): string {
  return `${row.name ?? row.metadata?.name ?? row.id}`.trim() || row.id;
}

function cloudProvider(row: RuntimeHostRow): string | undefined {
  const provider = `${row.metadata?.machine?.cloud ?? ""}`.trim();
  if (!provider || provider === "local" || provider === "self-host") {
    return undefined;
  }
  return provider;
}

function syntheticProbeDue(row: RuntimeHostRow, nowMs = Date.now()): boolean {
  const probe = row.metadata?.runtime_synthetic_probe ?? {};
  const currentBootId = `${row.metadata?.host_boot_id ?? ""}`.trim();
  const probeBootId = `${probe.host_boot_id ?? ""}`.trim();
  if (!probeBootId || (currentBootId && probeBootId !== currentBootId)) {
    return true;
  }
  const status = `${probe.status ?? ""}`.trim();
  const checkedAt = timestampMs(probe.checked_at ?? probe.claimed_at) ?? 0;
  if (status === "running") {
    return nowMs - checkedAt >= SYNTHETIC_PROBE_CLAIM_TIMEOUT_MS;
  }
  if (status === "failed") {
    return nowMs - checkedAt >= SYNTHETIC_PROBE_FAILURE_RETRY_MS;
  }
  return nowMs - checkedAt >= SYNTHETIC_PROBE_SUCCESS_INTERVAL_MS;
}

function syntheticProbeFailureAlertDue(
  row: RuntimeHostRow,
  nowMs = Date.now(),
): boolean {
  const alertedAt = timestampMs(
    row.metadata?.runtime_synthetic_probe?.alerted_at,
  );
  return (
    alertedAt == null || nowMs - alertedAt >= SYNTHETIC_PROBE_ALERT_INTERVAL_MS
  );
}

function recentRebootAttempts(metadata: any, nowMs: number): RebootAttempt[] {
  const attempts = Array.isArray(metadata?.runtime_auto_recovery?.attempts)
    ? metadata.runtime_auto_recovery.attempts
    : [];
  return attempts.filter((attempt: any) => {
    const at = timestampMs(attempt?.at);
    return at != null && nowMs - at < AUTO_REBOOT_WINDOW_MS;
  });
}

function recoveredAutoRebootState(
  row: RuntimeHostRow,
  nowMs = Date.now(),
): Record<string, any> | undefined {
  const current = row.metadata?.runtime_auto_recovery ?? {};
  const status = `${current.status ?? ""}`.trim();
  const currentBootId = `${row.metadata?.host_boot_id ?? ""}`.trim();
  const recoveryBootId = `${current.host_boot_id ?? ""}`.trim();
  if (
    !RECOVERABLE_AUTO_REBOOT_STATUSES.has(status) ||
    !currentBootId ||
    !recoveryBootId ||
    currentBootId === recoveryBootId
  ) {
    return undefined;
  }
  return {
    status: "recovered",
    recovered_at: new Date(nowMs).toISOString(),
    host_boot_id: currentBootId,
    host_session_id: row.metadata?.host_session_id,
    previous_status: status,
    previous_host_boot_id: recoveryBootId,
    work_id: current.work_id,
    cooldown_until: current.cooldown_until,
    attempts: recentRebootAttempts(row.metadata, nowMs),
  };
}

function autoRebootDecision(
  row: RuntimeHostRow,
  nowMs = Date.now(),
): AutoRebootDecision {
  if (!enabled(process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_ENABLED)) {
    return { action: "wait", reason: "automatic reboot is disabled" };
  }
  if (!cloudProvider(row)) {
    return { action: "wait", reason: "host is not cloud-backed" };
  }
  if (`${row.status ?? ""}`.trim() !== "running") {
    return { action: "wait", reason: "host is not running" };
  }
  const lastSeen = timestampMs(row.last_seen);
  if (lastSeen == null || nowMs - lastSeen > HEARTBEAT_FRESH_MS) {
    return { action: "wait", reason: "host heartbeat is stale" };
  }
  if (`${row.metadata?.desired_state ?? "running"}` !== "running") {
    return { action: "wait", reason: "host is not desired running" };
  }
  const runtime = row.metadata?.runtime_health ?? {};
  if (`${runtime.status ?? ""}` !== "degraded" || runtime.ready === true) {
    return { action: "wait", reason: "runtime is not degraded" };
  }
  const failures = Math.max(
    Number(runtime.consecutive_failures) || 0,
    Number(runtime.synthetic_probe?.consecutive_failures) || 0,
  );
  if (failures < AUTO_REBOOT_MIN_FAILURES) {
    return { action: "wait", reason: "failure threshold is not met" };
  }
  const diagnosticsCompletedAt = timestampMs(runtime.diagnostics_completed_at);
  if (diagnosticsCompletedAt == null) {
    return { action: "wait", reason: "forensic capture is not complete" };
  }
  if (nowMs - diagnosticsCompletedAt < AUTO_REBOOT_DIAGNOSTIC_SETTLE_MS) {
    return { action: "wait", reason: "forensic capture is still settling" };
  }
  const current = row.metadata?.runtime_auto_recovery ?? {};
  const cooldownUntil = timestampMs(current.cooldown_until);
  if (cooldownUntil != null && cooldownUntil > nowMs) {
    return { action: "wait", reason: "automatic reboot is in cooldown" };
  }
  const claimExpiresAt = timestampMs(current.claim_expires_at);
  if (
    `${current.status ?? ""}` === "claiming" &&
    claimExpiresAt != null &&
    claimExpiresAt > nowMs
  ) {
    return { action: "wait", reason: "automatic reboot is already claimed" };
  }
  const attempts = recentRebootAttempts(row.metadata, nowMs);
  if (attempts.length >= AUTO_REBOOT_MAX_ATTEMPTS) {
    return { action: "exhausted", attempts };
  }
  return { action: "reboot", attempts };
}

async function listRuntimeHosts(): Promise<RuntimeHostRow[]> {
  const { rows } = await pool().query<RuntimeHostRow>(
    `
      SELECT id, name, public_url, status, last_seen, metadata
      FROM project_hosts
      WHERE deleted IS NULL
        AND status='running'
        AND COALESCE(NULLIF(BTRIM(bay_id), ''), $1)=$1
        AND COALESCE(last_seen, to_timestamp(0)) >=
          NOW() - ($2::double precision * INTERVAL '1 millisecond')
      ORDER BY last_seen DESC
      LIMIT 1000
    `,
    [getConfiguredBayId(), HEARTBEAT_FRESH_MS],
  );
  return rows;
}

async function claimSyntheticProbe(
  row: RuntimeHostRow,
): Promise<{ claim_id: string; previous_failures: number } | undefined> {
  const claimId = randomUUID();
  const previousFailures =
    Number(row.metadata?.runtime_synthetic_probe?.consecutive_failures) || 0;
  const probe = {
    status: "running",
    claim_id: claimId,
    claimed_at: new Date().toISOString(),
    host_boot_id: row.metadata?.host_boot_id,
    host_session_id: row.metadata?.host_session_id,
    consecutive_failures: previousFailures,
  };
  const { rowCount } = await pool().query(
    `
      UPDATE project_hosts
      SET metadata=jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{runtime_synthetic_probe}',
        $3::jsonb,
        true
      ), updated=NOW()
      WHERE id=$1
        AND deleted IS NULL
        AND status='running'
        AND COALESCE(last_seen, to_timestamp(0)) >=
          NOW() - ($2::double precision * INTERVAL '1 millisecond')
        AND (
          metadata -> 'runtime_synthetic_probe' ->> 'status' IS DISTINCT FROM 'running'
          OR COALESCE(
            (metadata -> 'runtime_synthetic_probe' ->> 'claimed_at')::timestamptz,
            to_timestamp(0)
          ) < NOW() - ($4::double precision * INTERVAL '1 millisecond')
        )
    `,
    [
      row.id,
      HEARTBEAT_FRESH_MS,
      JSON.stringify(probe),
      SYNTHETIC_PROBE_CLAIM_TIMEOUT_MS,
    ],
  );
  return rowCount
    ? { claim_id: claimId, previous_failures: previousFailures }
    : undefined;
}

async function finishSyntheticProbe({
  row,
  claim_id,
  previous_failures,
  startedAt,
  error,
  result,
  alerted_at,
}: {
  row: RuntimeHostRow;
  claim_id: string;
  previous_failures: number;
  startedAt: number;
  error?: unknown;
  result?: Record<string, any>;
  alerted_at?: string;
}): Promise<void> {
  const failed = error != null;
  const probe = {
    status: failed ? "failed" : "passed",
    claim_id,
    checked_at: new Date().toISOString(),
    host_boot_id: row.metadata?.host_boot_id,
    host_session_id: row.metadata?.host_session_id,
    duration_ms: Date.now() - startedAt,
    consecutive_failures: failed ? previous_failures + 1 : 0,
    error: failed ? errorText(error) : undefined,
    result: failed ? undefined : result,
    alerted_at: failed
      ? (alerted_at ?? row.metadata?.runtime_synthetic_probe?.alerted_at)
      : undefined,
  };
  await pool().query(
    `
      UPDATE project_hosts
      SET metadata=jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{runtime_synthetic_probe}',
        $3::jsonb,
        true
      ), updated=NOW()
      WHERE id=$1
        AND metadata -> 'runtime_synthetic_probe' ->> 'claim_id'=$2
    `,
    [row.id, claim_id, JSON.stringify(probe)],
  );
}

async function markAutoRebootRecovered(row: RuntimeHostRow): Promise<void> {
  const state = recoveredAutoRebootState(row);
  if (!state) return;
  const { rowCount } = await pool().query(
    `
      UPDATE project_hosts
      SET metadata=jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{runtime_auto_recovery}',
        $4::jsonb,
        true
      ), updated=NOW()
      WHERE id=$1
        AND deleted IS NULL
        AND metadata ->> 'host_boot_id'=$2
        AND metadata -> 'runtime_auto_recovery' ->> 'host_boot_id'=$3
        AND metadata -> 'runtime_auto_recovery' ->> 'status' = ANY($5::text[])
    `,
    [
      row.id,
      row.metadata?.host_boot_id,
      row.metadata?.runtime_auto_recovery?.host_boot_id,
      JSON.stringify(state),
      Array.from(RECOVERABLE_AUTO_REBOOT_STATUSES),
    ],
  );
  if (rowCount) {
    logger.info("project-host automatic reboot recovery completed", {
      host_id: row.id,
      host_name: hostName(row),
      previous_status: state.previous_status,
      previous_host_boot_id: state.previous_host_boot_id,
      host_boot_id: state.host_boot_id,
    });
  }
}

async function executeSyntheticProbe(
  row: RuntimeHostRow,
  claim: { claim_id: string; previous_failures: number },
): Promise<boolean> {
  const startedAt = Date.now();
  try {
    const client = createHostControlClient({
      host_id: row.id,
      client: await getExplicitHostControlClient({
        host_id: row.id,
        fresh: true,
      }),
      timeout: SYNTHETIC_PROBE_RPC_TIMEOUT_MS,
    });
    if (typeof client.runSyntheticRuntimeProbe !== "function") {
      throw new Error("host does not support synthetic runtime probes");
    }
    const result = await client.runSyntheticRuntimeProbe();
    await finishSyntheticProbe({
      row,
      ...claim,
      startedAt,
      result,
    });
    await markAutoRebootRecovered(row);
    logger.info("project-host synthetic runtime probe passed", {
      host_id: row.id,
      host_name: hostName(row),
      duration_ms: Date.now() - startedAt,
    });
    return true;
  } catch (err) {
    const alertDue = syntheticProbeFailureAlertDue(row);
    await finishSyntheticProbe({
      row,
      ...claim,
      startedAt,
      error: err,
      alerted_at: alertDue ? new Date().toISOString() : undefined,
    });
    logger.warn("project-host synthetic runtime probe failed", {
      host_id: row.id,
      host_name: hostName(row),
      duration_ms: Date.now() - startedAt,
      err: errorText(err),
    });
    if (alertDue) {
      await adminAlert({
        subject: `Project-host synthetic probe failed: ${hostName(row)}`,
        body: [
          `A full synthetic project lifecycle probe failed on ${hostName(row)}.`,
          `host_id=${row.id}`,
          `error=${errorText(err)}`,
          row.public_url ? `url=${row.public_url}` : undefined,
          "The host is quarantined from placement until a later probe succeeds.",
        ]
          .filter(Boolean)
          .join("\n"),
        dedupMinutes: 15,
      });
    }
    return false;
  }
}

export async function runSyntheticProjectHostProbes(): Promise<{
  attempted: number;
  passed: number;
  failed: number;
}> {
  if (!enabled(process.env.COCALC_HOST_SYNTHETIC_PROBES_ENABLED)) {
    return { attempted: 0, passed: 0, failed: 0 };
  }
  const rows = (await listRuntimeHosts())
    .filter((row) => {
      const runtime = row.metadata?.runtime_health ?? {};
      const passiveRuntimeReady =
        runtime.ready === true ||
        (runtime.status === "degraded" &&
          Number(runtime.consecutive_failures) === 0 &&
          runtime.synthetic_probe?.status === "failed");
      return (
        passiveRuntimeReady &&
        runtime.synthetic_probe_supported === true &&
        !["queued", "running"].includes(
          `${row.metadata?.host_restart_recovery?.status ?? ""}`,
        ) &&
        syntheticProbeDue(row)
      );
    })
    .slice(0, SYNTHETIC_PROBE_CONCURRENCY);
  const claimed = (
    await Promise.all(
      rows.map(async (row) => ({ row, claim: await claimSyntheticProbe(row) })),
    )
  ).filter(
    (
      entry,
    ): entry is {
      row: RuntimeHostRow;
      claim: { claim_id: string; previous_failures: number };
    } => entry.claim != null,
  );
  const results = await Promise.all(
    claimed.map(({ row, claim }) => executeSyntheticProbe(row, claim)),
  );
  const passed = results.filter(Boolean).length;
  return {
    attempted: results.length,
    passed,
    failed: results.length - passed,
  };
}

async function updateAutoRecoveryState({
  host_id,
  state,
  expected_claim_id,
}: {
  host_id: string;
  state: Record<string, any>;
  expected_claim_id?: string;
}): Promise<boolean> {
  const params: any[] = [host_id, JSON.stringify(state)];
  const claimCondition = expected_claim_id
    ? `AND metadata -> 'runtime_auto_recovery' ->> 'claim_id'=$3`
    : "";
  if (expected_claim_id) params.push(expected_claim_id);
  const { rowCount } = await pool().query(
    `
      UPDATE project_hosts
      SET metadata=jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{runtime_auto_recovery}',
        $2::jsonb,
        true
      ), updated=NOW()
      WHERE id=$1 AND deleted IS NULL ${claimCondition}
    `,
    params,
  );
  return !!rowCount;
}

async function claimAutoReboot(
  row: RuntimeHostRow,
  attempts: RebootAttempt[],
): Promise<string | undefined> {
  const claimId = randomUUID();
  const now = Date.now();
  const state = {
    status: "claiming",
    claim_id: claimId,
    claimed_at: new Date(now).toISOString(),
    claim_expires_at: new Date(now + 5 * 60_000).toISOString(),
    host_boot_id: row.metadata?.host_boot_id,
    host_session_id: row.metadata?.host_session_id,
    attempts,
  };
  const { rowCount } = await pool().query(
    `
      UPDATE project_hosts
      SET metadata=jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{runtime_auto_recovery}',
        $3::jsonb,
        true
      ), updated=NOW()
      WHERE id=$1
        AND deleted IS NULL
        AND status='running'
        AND metadata -> 'runtime_health' ->> 'status'='degraded'
        AND metadata ->> 'host_boot_id'=$2
        AND (
          metadata -> 'runtime_auto_recovery' ->> 'status' IS DISTINCT FROM 'claiming'
          OR COALESCE(
            (metadata -> 'runtime_auto_recovery' ->> 'claim_expires_at')::timestamptz,
            to_timestamp(0)
          ) < NOW()
        )
    `,
    [row.id, row.metadata?.host_boot_id, JSON.stringify(state)],
  );
  return rowCount ? claimId : undefined;
}

async function scheduleAutoReboot(
  row: RuntimeHostRow,
  attempts: RebootAttempt[],
): Promise<boolean> {
  const claimId = await claimAutoReboot(row, attempts);
  if (!claimId) return false;
  const now = Date.now();
  try {
    const workId = await enqueueCloudVmWorkOnce({
      vm_id: row.id,
      action: "hard_restart",
      payload: {
        source: "runtime-health-auto-recovery",
        runtime_health: row.metadata?.runtime_health,
        claim_id: claimId,
      },
    });
    const nextAttempts = [
      ...attempts,
      {
        at: new Date(now).toISOString(),
        host_boot_id: `${row.metadata?.host_boot_id}`,
        host_session_id: row.metadata?.host_session_id,
        work_id: workId,
      },
    ];
    await updateAutoRecoveryState({
      host_id: row.id,
      expected_claim_id: claimId,
      state: {
        status: "scheduled",
        claim_id: claimId,
        scheduled_at: new Date(now).toISOString(),
        cooldown_until: new Date(now + AUTO_REBOOT_COOLDOWN_MS).toISOString(),
        host_boot_id: row.metadata?.host_boot_id,
        host_session_id: row.metadata?.host_session_id,
        work_id: workId,
        attempts: nextAttempts,
      },
    });
    await adminAlert({
      subject: `Automatically rebooting degraded project host: ${hostName(row)}`,
      body: [
        `CoCalc captured runtime diagnostics and scheduled a bounded hard reboot for ${hostName(row)}.`,
        `host_id=${row.id}`,
        `provider=${cloudProvider(row)}`,
        `attempt=${nextAttempts.length}/${AUTO_REBOOT_MAX_ATTEMPTS} within ${Math.round(AUTO_REBOOT_WINDOW_MS / 3_600_000)}h`,
        `work_id=${workId ?? "already queued"}`,
        `runtime_error=${row.metadata?.runtime_health?.error ?? "unknown"}`,
      ].join("\n"),
      dedupMinutes: 10,
    });
    logger.error("scheduled automatic hard reboot for degraded project host", {
      host_id: row.id,
      host_name: hostName(row),
      work_id: workId,
      attempt: nextAttempts.length,
    });
    return true;
  } catch (err) {
    await updateAutoRecoveryState({
      host_id: row.id,
      expected_claim_id: claimId,
      state: {
        status: "enqueue_failed",
        failed_at: new Date().toISOString(),
        host_boot_id: row.metadata?.host_boot_id,
        host_session_id: row.metadata?.host_session_id,
        attempts,
        error: errorText(err),
      },
    });
    throw err;
  }
}

async function automaticRebootFleetGateOpen(): Promise<boolean> {
  const { rows } = await pool().query<{ count: string | number }>(
    `
      SELECT COUNT(*) AS count
      FROM cloud_vm_work
      WHERE action='hard_restart'
        AND payload ->> 'source'='runtime-health-auto-recovery'
        AND created_at >=
          NOW() - ($1::double precision * INTERVAL '1 millisecond')
    `,
    [AUTO_REBOOT_FLEET_SPACING_MS],
  );
  return Number(rows[0]?.count ?? 0) === 0;
}

async function markRecoveryExhausted(
  row: RuntimeHostRow,
  attempts: RebootAttempt[],
): Promise<void> {
  if (`${row.metadata?.runtime_auto_recovery?.status ?? ""}` === "exhausted") {
    return;
  }
  await updateAutoRecoveryState({
    host_id: row.id,
    state: {
      status: "exhausted",
      exhausted_at: new Date().toISOString(),
      host_boot_id: row.metadata?.host_boot_id,
      host_session_id: row.metadata?.host_session_id,
      attempts,
    },
  });
  await adminAlert({
    subject: `Automatic project-host recovery exhausted: ${hostName(row)}`,
    body: [
      `${hostName(row)} remains degraded after ${attempts.length} automatic hard reboots.`,
      `host_id=${row.id}`,
      `runtime_error=${row.metadata?.runtime_health?.error ?? "unknown"}`,
      "The host remains quarantined and requires operator investigation.",
    ].join("\n"),
    dedupMinutes: 60,
  });
}

export async function runBoundedRuntimeAutoRecovery(): Promise<{
  scheduled: number;
  exhausted: number;
}> {
  if (!enabled(process.env.COCALC_HOST_RUNTIME_AUTO_REBOOT_ENABLED)) {
    return { scheduled: 0, exhausted: 0 };
  }
  const rows = await listRuntimeHosts();
  let fleetGateOpen = await automaticRebootFleetGateOpen();
  let scheduled = 0;
  let exhausted = 0;
  for (const row of rows) {
    const decision = autoRebootDecision(row);
    if (decision.action === "reboot" && fleetGateOpen) {
      if (await scheduleAutoReboot(row, decision.attempts)) {
        scheduled += 1;
        fleetGateOpen = false;
      }
    } else if (decision.action === "exhausted") {
      await markRecoveryExhausted(row, decision.attempts);
      exhausted += 1;
    }
  }
  return { scheduled, exhausted };
}

let maintenanceInflight: Promise<void> | undefined;

export async function runProjectHostRuntimeMaintenance(): Promise<void> {
  if (maintenanceInflight) return await maintenanceInflight;
  maintenanceInflight = (async () => {
    const recovery = await runBoundedRuntimeAutoRecovery();
    const probes = await runSyntheticProjectHostProbes();
    logger.debug("project-host runtime maintenance complete", {
      recovery,
      probes,
    });
  })();
  try {
    await maintenanceInflight;
  } finally {
    maintenanceInflight = undefined;
  }
}

export const _test = {
  autoRebootDecision,
  recentRebootAttempts,
  recoveredAutoRebootState,
  syntheticProbeFailureAlertDue,
  syntheticProbeDue,
};
