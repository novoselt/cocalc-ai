/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { isIP } from "node:net";
import getLogger from "@cocalc/backend/logger";
import { conatPassword } from "@cocalc/backend/data";
import getPool, { type PoolClient } from "@cocalc/database/pool";
import type {
  HostExamConfig,
  HostExamConfigInput,
  HostExamRun,
  HostExamRunStatus,
  HostExamRuntimeStatus,
  HostExamState,
} from "@cocalc/conat/hub/api/hosts";
import { ensureProxiedAddressDns } from "@cocalc/server/cloud/dns";
import { getRoutedHostControlClient } from "@cocalc/server/project-host/client";
import adminAlert from "@cocalc/server/messages/admin-alert";

const logger = getLogger("server:project-host:exam");

const CONFIG_TABLE = "project_host_exam_configs";
const RUN_TABLE = "project_host_exam_runs";
const ACTIVE_RUN_STATUSES: HostExamRunStatus[] = [
  "preparing",
  "ready",
  "open",
  "closing",
  "cleaning",
  "error",
];
const PROJECT_HOST_RPC_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_EXAM_CONFIG: Omit<HostExamConfigInput, "enabled"> = {
  max_workspaces: 100,
  workspace_cpu: 1,
  workspace_memory_mb: 2_000,
  workspace_disk_mb: 5_000,
  workspace_ttl_minutes: 6 * 60,
  cleanup_grace_minutes: 10,
  terminal_enabled: false,
  network_mode: "disabled",
};

let schemaPromise: Promise<void> | undefined;

export interface ExamHostRow {
  id: string;
  name?: string;
  status?: string;
  public_ip?: string | null;
  public_url?: string | null;
  metadata?: Record<string, any>;
}

function dateString(value: unknown): string | undefined {
  if (value == null) return;
  const date = value instanceof Date ? value : new Date(`${value}`);
  if (!Number.isFinite(date.valueOf())) return;
  return date.toISOString();
}

function mapConfig(row: any): HostExamConfig {
  return {
    host_id: row.host_id,
    enabled: row.enabled === true,
    hostname: row.hostname,
    dns_record_id: row.dns_record_id ?? null,
    dns_target: row.dns_target ?? null,
    generation: Number(row.generation),
    max_workspaces: Number(row.max_workspaces),
    workspace_cpu: Number(row.workspace_cpu),
    workspace_memory_mb: Number(row.workspace_memory_mb),
    workspace_disk_mb: Number(row.workspace_disk_mb),
    workspace_ttl_minutes: Number(row.workspace_ttl_minutes),
    cleanup_grace_minutes: Number(row.cleanup_grace_minutes),
    terminal_enabled: row.terminal_enabled === true,
    network_mode: "disabled",
    created_at: dateString(row.created_at)!,
    updated_at: dateString(row.updated_at)!,
    created_by: row.created_by,
    updated_by: row.updated_by,
  };
}

function mapRun(row: any): HostExamRun {
  return {
    run_id: row.run_id,
    host_id: row.host_id,
    config_generation: Number(row.config_generation),
    status: row.status,
    rootfs_image: row.rootfs_image,
    rootfs_digest: row.rootfs_digest,
    run_quota:
      typeof row.run_quota === "string"
        ? JSON.parse(row.run_quota)
        : row.run_quota,
    max_workspaces: Number(row.max_workspaces),
    terminal_enabled: row.terminal_enabled === true,
    network_mode: "disabled",
    scheduled_stop_at: dateString(row.scheduled_stop_at)!,
    owner_account_id: row.owner_account_id,
    opened_at: dateString(row.opened_at) ?? null,
    admission_closed_at: dateString(row.admission_closed_at) ?? null,
    cleanup_started_at: dateString(row.cleanup_started_at) ?? null,
    cleaned_at: dateString(row.cleaned_at) ?? null,
    stopped_at: dateString(row.stopped_at) ?? null,
    last_error: row.last_error ?? null,
    created_at: dateString(row.created_at)!,
    updated_at: dateString(row.updated_at)!,
    created_by: row.created_by,
  };
}

async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS ${CONFIG_TABLE} (
          host_id UUID PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          hostname TEXT NOT NULL UNIQUE,
          dns_record_id TEXT,
          dns_target TEXT,
          generation BIGINT NOT NULL DEFAULT 1,
          max_workspaces INTEGER NOT NULL,
          workspace_cpu DOUBLE PRECISION NOT NULL,
          workspace_memory_mb INTEGER NOT NULL,
          workspace_disk_mb INTEGER NOT NULL,
          workspace_ttl_minutes INTEGER NOT NULL,
          cleanup_grace_minutes INTEGER NOT NULL,
          terminal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          network_mode TEXT NOT NULL DEFAULT 'disabled',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by UUID NOT NULL,
          updated_by UUID NOT NULL
        )
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS ${RUN_TABLE} (
          run_id UUID PRIMARY KEY,
          host_id UUID NOT NULL,
          config_generation BIGINT NOT NULL,
          status TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          create_idempotency_key TEXT NOT NULL,
          token_idempotency_key TEXT NOT NULL,
          rootfs_image TEXT NOT NULL,
          rootfs_digest TEXT NOT NULL,
          run_quota JSONB NOT NULL,
          max_workspaces INTEGER NOT NULL,
          terminal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          network_mode TEXT NOT NULL DEFAULT 'disabled',
          scheduled_stop_at TIMESTAMPTZ NOT NULL,
          owner_account_id UUID NOT NULL,
          opened_at TIMESTAMPTZ,
          admission_closed_at TIMESTAMPTZ,
          cleanup_started_at TIMESTAMPTZ,
          cleaned_at TIMESTAMPTZ,
          stopped_at TIMESTAMPTZ,
          last_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_by UUID NOT NULL
        )
      `);
      await getPool().query(`
        CREATE UNIQUE INDEX IF NOT EXISTS project_host_exam_runs_active_host_idx
        ON ${RUN_TABLE}(host_id)
        WHERE status <> 'stopped'
      `);
      await getPool().query(`
        CREATE UNIQUE INDEX IF NOT EXISTS project_host_exam_runs_create_key_idx
        ON ${RUN_TABLE}(host_id, created_by, create_idempotency_key)
      `);
      await getPool().query(`
        CREATE INDEX IF NOT EXISTS project_host_exam_runs_due_idx
        ON ${RUN_TABLE}(scheduled_stop_at)
        WHERE status <> 'stopped'
      `);
    })().catch((err) => {
      schemaPromise = undefined;
      throw err;
    });
  }
  await schemaPromise;
}

function requireFiniteRange(
  value: unknown,
  {
    label,
    min,
    max,
    integer = false,
  }: { label: string; min: number; max: number; integer?: boolean },
): number {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error(
      `${label} must be ${integer ? "an integer " : ""}between ${min} and ${max}`,
    );
  }
  return parsed;
}

function normalizeConfig(input: HostExamConfigInput): HostExamConfigInput {
  if (input.network_mode != null && input.network_mode !== "disabled") {
    throw new Error("the exam MVP supports only disabled project networking");
  }
  return {
    enabled: input.enabled === true,
    max_workspaces: requireFiniteRange(input.max_workspaces, {
      label: "max_workspaces",
      min: 1,
      max: 1_000,
      integer: true,
    }),
    workspace_cpu: requireFiniteRange(input.workspace_cpu, {
      label: "workspace_cpu",
      min: 0.1,
      max: 128,
    }),
    workspace_memory_mb: requireFiniteRange(input.workspace_memory_mb, {
      label: "workspace_memory_mb",
      min: 256,
      max: 1_048_576,
      integer: true,
    }),
    workspace_disk_mb: requireFiniteRange(input.workspace_disk_mb, {
      label: "workspace_disk_mb",
      min: 1_000,
      max: 4_000_000,
      integer: true,
    }),
    workspace_ttl_minutes: requireFiniteRange(input.workspace_ttl_minutes, {
      label: "workspace_ttl_minutes",
      min: 180,
      max: 2 * 24 * 60,
      integer: true,
    }),
    cleanup_grace_minutes: requireFiniteRange(input.cleanup_grace_minutes, {
      label: "cleanup_grace_minutes",
      min: 1,
      max: 60,
      integer: true,
    }),
    terminal_enabled: input.terminal_enabled === true,
    network_mode: "disabled",
  };
}

function publicHostname(host: ExamHostRow): string {
  const raw = `${host.public_url ?? host.metadata?.public_url ?? ""}`.trim();
  if (!raw) {
    throw new Error("host must have a public URL before exam mode is enabled");
  }
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    throw new Error("host public URL is invalid");
  }
}

function examHostnameForHost(host: ExamHostRow): string {
  const target = publicHostname(host);
  const labels = target.split(".");
  const first = labels[0] ?? "";
  labels[0] = first.startsWith("host-")
    ? `exam-${first.slice("host-".length)}`
    : `exam-${host.id}`;
  return labels.join(".");
}

function publicIp(host: ExamHostRow): string {
  const value = `${
    host.public_ip ??
    host.metadata?.runtime?.public_ip ??
    host.metadata?.public_ip ??
    host.metadata?.ip_address ??
    ""
  }`.trim();
  if (isIP(value) !== 4) {
    throw new Error(
      "host must have a reconciled public IPv4 address before exam mode is enabled",
    );
  }
  return value;
}

function isHostOnDemand(host: ExamHostRow): boolean {
  const metadata = host.metadata ?? {};
  const pricing = `${
    metadata.effective_pricing_model ??
    metadata.desired_pricing_model ??
    metadata.pricing_model ??
    "on_demand"
  }`
    .trim()
    .toLowerCase();
  return pricing !== "spot";
}

function ownerAccountId(host: ExamHostRow): string {
  const owner = `${
    host.metadata?.owner ?? host.metadata?.owner_account_id ?? ""
  }`.trim();
  if (!owner) {
    throw new Error("project host has no billing owner");
  }
  return owner;
}

function validateIdempotencyKey(value: string): string {
  const key = `${value ?? ""}`.trim();
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(key)) {
    throw new Error("idempotency_key must contain 8 to 200 safe characters");
  }
  return key;
}

function deterministicToken({
  run_id,
  idempotency_key,
}: {
  run_id: string;
  idempotency_key: string;
}): string {
  return createHmac("sha256", conatPassword)
    .update(`project-host-exam-token-v1:${run_id}:${idempotency_key}`)
    .digest("base64url");
}

function hashToken(token: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(token, salt, 32);
  return `scrypt-v1$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function validateDeadline(
  scheduled_stop_at: string,
  workspace_ttl_minutes: number,
): string {
  const deadline = new Date(scheduled_stop_at);
  const now = Date.now();
  if (!Number.isFinite(deadline.valueOf())) {
    throw new Error("scheduled_stop_at must be a valid timestamp");
  }
  if (deadline.valueOf() < now + 60_000) {
    throw new Error(
      "scheduled_stop_at must be at least one minute in the future",
    );
  }
  if (deadline.valueOf() > now + workspace_ttl_minutes * 60_000) {
    throw new Error(
      `scheduled_stop_at exceeds the configured ${workspace_ttl_minutes}-minute run limit`,
    );
  }
  return deadline.toISOString();
}

async function loadConfig(
  host_id: string,
  client: PoolClient | ReturnType<typeof getPool> = getPool(),
): Promise<HostExamConfig | undefined> {
  await ensureSchema();
  const { rows } = await client.query(
    `SELECT * FROM ${CONFIG_TABLE} WHERE host_id=$1`,
    [host_id],
  );
  return rows[0] ? mapConfig(rows[0]) : undefined;
}

async function loadCurrentRun(
  host_id: string,
  client: PoolClient | ReturnType<typeof getPool> = getPool(),
): Promise<HostExamRun | undefined> {
  await ensureSchema();
  const { rows } = await client.query(
    `
      SELECT *
      FROM ${RUN_TABLE}
      WHERE host_id=$1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [host_id],
  );
  return rows[0] ? mapRun(rows[0]) : undefined;
}

async function loadRuntimeStatus(
  host: ExamHostRow,
  run?: HostExamRun,
): Promise<HostExamRuntimeStatus | undefined> {
  if (host.status !== "running") return;
  try {
    const client = await getRoutedHostControlClient({
      host_id: host.id,
      timeout: 15_000,
      fresh: true,
    });
    return await client.getExamRunStatus({ run_id: run?.run_id });
  } catch (err) {
    logger.warn("unable to load project-host exam runtime status", {
      host_id: host.id,
      run_id: run?.run_id,
      err: `${err}`,
    });
    return {
      run_id: run?.run_id,
      status: run?.status,
      admission_open: false,
      active_workspaces: 0,
      max_workspaces: run?.max_workspaces,
      scheduled_stop_at: run?.scheduled_stop_at,
      last_error: `project-host status unavailable: ${err}`,
    };
  }
}

export async function getExamStateLocal({
  host,
  eligible,
  eligibility_reason,
}: {
  host: ExamHostRow;
  eligible: boolean;
  eligibility_reason?: string;
}): Promise<HostExamState> {
  const [config, run] = await Promise.all([
    loadConfig(host.id),
    loadCurrentRun(host.id),
  ]);
  return {
    eligible,
    eligibility_reason,
    config,
    run,
    runtime: await loadRuntimeStatus(host, run),
  };
}

async function ensureExamDns({
  host,
  config,
}: {
  host: ExamHostRow;
  config: HostExamConfig;
}): Promise<HostExamConfig> {
  const target = publicIp(host);
  const { record_id } = await ensureProxiedAddressDns({
    name: config.hostname,
    ipAddress: target,
    record_id: config.dns_record_id ?? undefined,
  });
  const { rows } = await getPool().query(
    `
      UPDATE ${CONFIG_TABLE}
      SET dns_record_id=$2, dns_target=$3, updated_at=NOW()
      WHERE host_id=$1
      RETURNING *
    `,
    [host.id, record_id, target],
  );
  return mapConfig(rows[0]);
}

export async function setExamConfigLocal({
  host,
  actor_account_id,
  input,
}: {
  host: ExamHostRow;
  actor_account_id: string;
  input: HostExamConfigInput;
}): Promise<HostExamConfig> {
  await ensureSchema();
  const config = normalizeConfig(input);
  const activeRun = await loadCurrentRun(host.id);
  if (activeRun && activeRun.status !== "stopped") {
    throw new Error(
      "exam configuration cannot change while an exam run is active",
    );
  }
  const hostname = examHostnameForHost(host);
  const { rows } = await getPool().query(
    `
      INSERT INTO ${CONFIG_TABLE} (
        host_id, enabled, hostname, generation, max_workspaces,
        workspace_cpu, workspace_memory_mb, workspace_disk_mb,
        workspace_ttl_minutes, cleanup_grace_minutes, terminal_enabled,
        network_mode, created_by, updated_by
      )
      VALUES (
        $1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, 'disabled', $11, $11
      )
      ON CONFLICT (host_id) DO UPDATE SET
        enabled=EXCLUDED.enabled,
        max_workspaces=EXCLUDED.max_workspaces,
        workspace_cpu=EXCLUDED.workspace_cpu,
        workspace_memory_mb=EXCLUDED.workspace_memory_mb,
        workspace_disk_mb=EXCLUDED.workspace_disk_mb,
        workspace_ttl_minutes=EXCLUDED.workspace_ttl_minutes,
        cleanup_grace_minutes=EXCLUDED.cleanup_grace_minutes,
        terminal_enabled=EXCLUDED.terminal_enabled,
        network_mode='disabled',
        generation=${CONFIG_TABLE}.generation + 1,
        updated_by=EXCLUDED.updated_by,
        updated_at=NOW()
      RETURNING *
    `,
    [
      host.id,
      config.enabled,
      hostname,
      config.max_workspaces,
      config.workspace_cpu,
      config.workspace_memory_mb,
      config.workspace_disk_mb,
      config.workspace_ttl_minutes,
      config.cleanup_grace_minutes,
      config.terminal_enabled,
      actor_account_id,
    ],
  );
  const saved = mapConfig(rows[0]);
  if (!saved.enabled) return saved;
  return await ensureExamDns({ host, config: saved });
}

async function updateRunFromRuntime({
  run_id,
  runtime,
}: {
  run_id: string;
  runtime: HostExamRuntimeStatus;
}): Promise<HostExamRun> {
  const status = runtime.status ?? "error";
  const { rows } = await getPool().query(
    `
      UPDATE ${RUN_TABLE}
      SET status=$2,
          opened_at=CASE WHEN $2='open' THEN COALESCE(opened_at, NOW()) ELSE opened_at END,
          admission_closed_at=CASE
            WHEN $2 IN ('closing', 'cleaning', 'stopped') THEN COALESCE(admission_closed_at, NOW())
            ELSE admission_closed_at
          END,
          cleanup_started_at=CASE
            WHEN $2 IN ('cleaning', 'stopped') THEN COALESCE(cleanup_started_at, NOW())
            ELSE cleanup_started_at
          END,
          cleaned_at=CASE WHEN $2='stopped' THEN COALESCE(cleaned_at, NOW()) ELSE cleaned_at END,
          last_error=$3,
          updated_at=NOW()
      WHERE run_id=$1
      RETURNING *
    `,
    [run_id, status, runtime.last_error ?? null],
  );
  if (!rows[0]) throw new Error("exam run not found");
  return mapRun(rows[0]);
}

export async function createExamRunLocal({
  host,
  actor_account_id,
  rootfs_image,
  scheduled_stop_at,
  idempotency_key,
}: {
  host: ExamHostRow;
  actor_account_id: string;
  rootfs_image: string;
  scheduled_stop_at: string;
  idempotency_key: string;
}): Promise<{ run: HostExamRun; token: string }> {
  await ensureSchema();
  if (host.status !== "running") {
    throw new Error(
      "the project host must be running before preparing an exam",
    );
  }
  if (!isHostOnDemand(host)) {
    throw new Error("exam mode requires an on-demand project host");
  }
  const config = await loadConfig(host.id);
  if (!config?.enabled) {
    throw new Error("exam mode is not enabled for this project host");
  }
  const key = validateIdempotencyKey(idempotency_key);
  const deadline = validateDeadline(
    scheduled_stop_at,
    config.workspace_ttl_minutes,
  );
  const control = await getRoutedHostControlClient({
    host_id: host.id,
    timeout: PROJECT_HOST_RPC_TIMEOUT_MS,
    fresh: true,
  });
  const cached = await control.listRootfsImages();
  const selected = cached.find((entry) => entry.image === rootfs_image);
  if (!selected?.digest) {
    throw new Error(
      "the selected RootFS must already be cached with an immutable digest",
    );
  }

  const existingByKey = await getPool().query(
    `
      SELECT *
      FROM ${RUN_TABLE}
      WHERE host_id=$1 AND created_by=$2 AND create_idempotency_key=$3
      LIMIT 1
    `,
    [host.id, actor_account_id, key],
  );
  if (existingByKey.rows[0]) {
    const run = mapRun(existingByKey.rows[0]);
    return {
      run,
      token: deterministicToken({
        run_id: run.run_id,
        idempotency_key: key,
      }),
    };
  }

  const run_id = randomUUID();
  const token = deterministicToken({ run_id, idempotency_key: key });
  const token_hash = hashToken(token);
  const run_quota = {
    cpu_limit: config.workspace_cpu,
    memory_limit: config.workspace_memory_mb,
    disk_quota: config.workspace_disk_mb,
    pids_limit: 4_096,
  };
  const { rows } = await getPool().query(
    `
      INSERT INTO ${RUN_TABLE} (
        run_id, host_id, config_generation, status, token_hash,
        create_idempotency_key, token_idempotency_key, rootfs_image,
        rootfs_digest, run_quota, max_workspaces, terminal_enabled,
        network_mode, scheduled_stop_at, owner_account_id, created_by
      )
      VALUES (
        $1, $2, $3, 'preparing', $4, $5, $5, $6, $7, $8::JSONB,
        $9, $10, 'disabled', $11, $12, $13
      )
      RETURNING *
    `,
    [
      run_id,
      host.id,
      config.generation,
      token_hash,
      key,
      selected.image,
      selected.digest,
      JSON.stringify(run_quota),
      config.max_workspaces,
      config.terminal_enabled,
      deadline,
      ownerAccountId(host),
      actor_account_id,
    ],
  );
  let run = mapRun(rows[0]);
  try {
    const runtime = await control.applyExamRun({
      config,
      run,
      token_hash,
    });
    run = await updateRunFromRuntime({ run_id, runtime });
  } catch (err) {
    await getPool().query(
      `
        UPDATE ${RUN_TABLE}
        SET status='error', last_error=$2, updated_at=NOW()
        WHERE run_id=$1
      `,
      [run_id, `${err}`],
    );
    throw err;
  }
  return { run, token };
}

async function requireRunForMutation({
  host_id,
  run_id,
}: {
  host_id: string;
  run_id: string;
}): Promise<HostExamRun> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `SELECT * FROM ${RUN_TABLE} WHERE run_id=$1 AND host_id=$2`,
    [run_id, host_id],
  );
  if (!rows[0]) throw new Error("exam run not found");
  return mapRun(rows[0]);
}

export async function rotateExamTokenLocal({
  host,
  run_id,
  idempotency_key,
}: {
  host: ExamHostRow;
  run_id: string;
  idempotency_key: string;
}): Promise<{ run: HostExamRun; token: string }> {
  const run = await requireRunForMutation({ host_id: host.id, run_id });
  if (
    run.status === "closing" ||
    run.status === "cleaning" ||
    run.status === "stopped"
  ) {
    throw new Error("cannot rotate the token after exam cleanup has started");
  }
  const key = validateIdempotencyKey(idempotency_key);
  const token = deterministicToken({ run_id, idempotency_key: key });
  const token_hash = hashToken(token);
  const control = await getRoutedHostControlClient({
    host_id: host.id,
    timeout: 30_000,
    fresh: true,
  });
  const runtime = await control.rotateExamRunToken({
    run_id,
    config_generation: run.config_generation,
    token_hash,
  });
  const { rows } = await getPool().query(
    `
      UPDATE ${RUN_TABLE}
      SET token_hash=$2, token_idempotency_key=$3, updated_at=NOW()
      WHERE run_id=$1
      RETURNING *
    `,
    [run_id, token_hash, key],
  );
  if (runtime.last_error) {
    throw new Error(runtime.last_error);
  }
  return { run: mapRun(rows[0]), token };
}

export async function openExamRunLocal({
  host,
  run_id,
}: {
  host: ExamHostRow;
  run_id: string;
}): Promise<HostExamRun> {
  const run = await requireRunForMutation({ host_id: host.id, run_id });
  if (new Date(run.scheduled_stop_at).valueOf() <= Date.now()) {
    throw new Error("the exam deadline has already passed");
  }
  const control = await getRoutedHostControlClient({
    host_id: host.id,
    timeout: 60_000,
    fresh: true,
  });
  const runtime = await control.openExamRun({
    run_id,
    config_generation: run.config_generation,
  });
  return await updateRunFromRuntime({ run_id, runtime });
}

export async function updateExamDeadlineLocal({
  host,
  run_id,
  scheduled_stop_at,
}: {
  host: ExamHostRow;
  run_id: string;
  scheduled_stop_at: string;
}): Promise<HostExamRun> {
  const [run, config] = await Promise.all([
    requireRunForMutation({ host_id: host.id, run_id }),
    loadConfig(host.id),
  ]);
  if (!config) throw new Error("exam configuration not found");
  if (
    run.status === "closing" ||
    run.status === "cleaning" ||
    run.status === "stopped"
  ) {
    throw new Error("cannot change the deadline after cleanup has started");
  }
  const deadline = validateDeadline(
    scheduled_stop_at,
    config.workspace_ttl_minutes,
  );
  const control = await getRoutedHostControlClient({
    host_id: host.id,
    timeout: 30_000,
    fresh: true,
  });
  await control.updateExamRunDeadline({
    run_id,
    config_generation: run.config_generation,
    scheduled_stop_at: deadline,
  });
  const { rows } = await getPool().query(
    `
      UPDATE ${RUN_TABLE}
      SET scheduled_stop_at=$2, updated_at=NOW()
      WHERE run_id=$1
      RETURNING *
    `,
    [run_id, deadline],
  );
  return mapRun(rows[0]);
}

export async function stopAndEraseExamRunLocal({
  host,
  run_id,
  poweroff,
}: {
  host: ExamHostRow;
  run_id: string;
  poweroff: boolean;
}): Promise<HostExamRun> {
  const run = await requireRunForMutation({ host_id: host.id, run_id });
  if (run.status === "stopped") return run;
  await getPool().query(
    `
      UPDATE ${RUN_TABLE}
      SET status='closing',
          admission_closed_at=COALESCE(admission_closed_at, NOW()),
          updated_at=NOW()
      WHERE run_id=$1 AND status <> 'stopped'
    `,
    [run_id],
  );
  const control = await getRoutedHostControlClient({
    host_id: host.id,
    timeout: PROJECT_HOST_RPC_TIMEOUT_MS,
    fresh: true,
  });
  const runtime = await control.closeAndCleanupExamRun({
    run_id,
    config_generation: run.config_generation,
    poweroff,
  });
  return await updateRunFromRuntime({ run_id, runtime });
}

export async function eraseActiveExamRunBeforeHostStopLocal({
  host,
}: {
  host: ExamHostRow;
}): Promise<boolean> {
  const run = await loadCurrentRun(host.id);
  if (!run || run.status === "stopped") return false;
  if (host.status !== "running") {
    throw new Error(
      "the exam host must be running so its temporary workspaces can be erased before stopping",
    );
  }
  await stopAndEraseExamRunLocal({
    host,
    run_id: run.run_id,
    poweroff: false,
  });
  return true;
}

export async function reconcileExamDnsOnce(): Promise<void> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `
      SELECT c.*, h.public_url, h.metadata, h.status, h.name
      FROM ${CONFIG_TABLE} c
      JOIN project_hosts h ON h.id=c.host_id
      WHERE c.enabled=TRUE AND h.deleted IS NULL
    `,
  );
  for (const row of rows) {
    try {
      await ensureExamDns({
        host: row as ExamHostRow,
        config: mapConfig(row),
      });
    } catch (err) {
      logger.warn("exam DNS reconciliation failed", {
        host_id: row.host_id,
        hostname: row.hostname,
        err: `${err}`,
      });
    }
  }
}

export async function reconcileDueExamRunsOnce(): Promise<void> {
  await ensureSchema();
  const { rows } = await getPool().query(
    `
      SELECT r.*, h.public_url, h.metadata, h.status AS host_status, h.name
      FROM ${RUN_TABLE} r
      JOIN project_hosts h ON h.id=r.host_id
      WHERE r.status = ANY($1::TEXT[])
        AND r.scheduled_stop_at <= NOW()
      ORDER BY r.scheduled_stop_at
      LIMIT 16
    `,
    [ACTIVE_RUN_STATUSES],
  );
  for (const row of rows) {
    const lockKey = `project-host-exam-run:${row.run_id}`;
    const db = await getPool().connect();
    let acquired = false;
    try {
      const lock = await db.query(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        [lockKey],
      );
      acquired = lock.rows[0]?.acquired === true;
      if (!acquired) continue;
      const host: ExamHostRow = {
        id: row.host_id,
        name: row.name,
        status: row.host_status,
        public_url: row.public_url,
        metadata: row.metadata,
      };
      await db.query("BEGIN");
      try {
        await db.query(
          `
            UPDATE ${RUN_TABLE}
            SET status='closing',
                admission_closed_at=COALESCE(admission_closed_at, NOW()),
                updated_at=NOW()
            WHERE run_id=$1 AND status <> 'stopped'
          `,
          [row.run_id],
        );
        await db.query(
          `
            UPDATE project_hosts
            SET metadata=jsonb_set(
              COALESCE(metadata, '{}'::JSONB),
              '{desired_state}',
              '"stopped"'::JSONB,
              true
            )
            WHERE id=$1
          `,
          [row.host_id],
        );
        await db.query("COMMIT");
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
      await stopAndEraseExamRunLocal({
        host,
        run_id: row.run_id,
        poweroff: true,
      });
      const { stopHostInternal } =
        await import("@cocalc/server/conat/api/hosts");
      await stopHostInternal({
        id: row.host_id,
        account_id: row.owner_account_id,
      });
    } catch (err) {
      logger.error("scheduled exam cleanup failed", {
        host_id: row.host_id,
        run_id: row.run_id,
        err: `${err}`,
      });
      await getPool().query(
        `
          UPDATE ${RUN_TABLE}
          SET status='error', last_error=$2, updated_at=NOW()
          WHERE run_id=$1 AND status <> 'stopped'
        `,
        [row.run_id, `${err}`],
      );
      void adminAlert({
        subject: `Exam cleanup failed on ${row.name ?? row.host_id}`,
        body: `Run ${row.run_id} reached its deadline but cleanup or host stop failed:\n\n${err}`,
        dedupMinutes: 15,
      });
    } finally {
      if (acquired) {
        await db
          .query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey])
          .catch((err) => {
            logger.warn("unable to release exam reconciliation lock", {
              run_id: row.run_id,
              err: `${err}`,
            });
          });
      }
      db.release();
    }
  }
}

let maintenanceStarted = false;

export function startExamHostMaintenance(): void {
  if (maintenanceStarted) return;
  maintenanceStarted = true;
  const run = async () => {
    await reconcileExamDnsOnce();
    await reconcileDueExamRunsOnce();
  };
  void run().catch((err) => {
    logger.error("initial exam host maintenance failed", { err: `${err}` });
  });
  const timer = setInterval(() => {
    void run().catch((err) => {
      logger.error("exam host maintenance failed", { err: `${err}` });
    });
  }, 30_000);
  timer.unref?.();
}

export const __test__ = {
  DEFAULT_EXAM_CONFIG,
  examHostnameForHost,
  hashToken,
  isHostOnDemand,
  normalizeConfig,
  publicIp,
  validateDeadline,
};
