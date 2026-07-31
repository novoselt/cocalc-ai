/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { executeCode } from "@cocalc/backend/execute-code";
import getLogger from "@cocalc/backend/logger";
import type {
  HostExamConfig,
  HostExamReadinessCheck,
  HostExamRun,
  HostExamRunStatus,
  HostExamRuntimeStatus,
} from "@cocalc/conat/hub/api/hosts";
import type { ApplyHostExamRunRequest } from "@cocalc/conat/project-host/api";
import { hubApi } from "@cocalc/lite/hub/api";
import {
  deleteRow,
  getDatabase,
  getRow,
  initDatabase,
  upsertRow,
} from "@cocalc/lite/hub/sqlite/database";
import { isValidUUID } from "@cocalc/util/misc";
import { sandboxExec } from "@cocalc/project-runner/run/sandbox-exec";
import { deleteVolume, getVolume } from "../file-server";
import { listRootfsCacheEntries } from "../rootfs-cache";
import {
  deleteProjectLocal,
  getProject,
  upsertProject,
} from "../sqlite/projects";
import {
  setExamProjectNetworkPolicy,
  verifyExamProjectNetworkPolicy,
} from "./network-policy";
import { verifyExamPublicRoute } from "./public-route";
import { verifyExamTokenHash } from "./token";

const logger = getLogger("project-host:exam:controller");
const STORAGE_WRAPPER = "/usr/local/sbin/cocalc-runtime-storage";
const WATCHDOG_INTERVAL_MS = 5_000;
const POWEROFF_RESPONSE_GRACE_MS = 5_000;
const TOKEN_FAILURE_WINDOW_MS = 10 * 60_000;
const TOKEN_FAILURE_LIMIT = 12;

interface LocalExamRunRow {
  run_id: string;
  config_generation: number;
  status: HostExamRunStatus;
  config_json: string;
  run_json: string;
  token_hash: string;
  admission_open: number;
  scheduled_stop_at_ms: number;
  cleanup_deadline_at_ms: number;
  last_error: string | null;
  updated_at_ms: number;
}

interface LocalExamSessionRow {
  account_id: string;
  project_id: string;
  run_id: string;
  status: "provisioning" | "active" | "cleaning" | "deleted" | "error";
  created_at_ms: number;
  expires_at_ms: number;
  last_error: string | null;
}

const tokenFailures = new Map<string, number[]>();
let watchdogStarted = false;
let cleanupInFlight: Promise<HostExamRuntimeStatus> | undefined;

function ensureSchema(): void {
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_runs (
      run_id TEXT PRIMARY KEY,
      config_generation INTEGER NOT NULL,
      status TEXT NOT NULL,
      config_json TEXT NOT NULL,
      run_json TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      admission_open INTEGER NOT NULL DEFAULT 0,
      scheduled_stop_at_ms INTEGER NOT NULL,
      cleanup_deadline_at_ms INTEGER NOT NULL,
      last_error TEXT,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS exam_runs_current_idx
      ON exam_runs((1))
      WHERE status <> 'stopped';
    CREATE TABLE IF NOT EXISTS exam_sessions (
      account_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS exam_sessions_run_status_idx
      ON exam_sessions(run_id, status);
  `);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeExamConfig(
  raw: HostExamConfig | Record<string, any>,
): HostExamConfig {
  const legacy = raw as Record<string, any>;
  return {
    ...raw,
    max_projects: Number(raw.max_projects ?? legacy.max_workspaces),
    project_cpu: Number(raw.project_cpu ?? legacy.workspace_cpu),
    project_memory_mb: Number(
      raw.project_memory_mb ?? legacy.workspace_memory_mb,
    ),
    project_disk_mb: Number(raw.project_disk_mb ?? legacy.workspace_disk_mb),
    project_ttl_minutes: Number(
      raw.project_ttl_minutes ?? legacy.workspace_ttl_minutes,
    ),
  } as HostExamConfig;
}

function normalizeExamRun(raw: HostExamRun | Record<string, any>): HostExamRun {
  const legacy = raw as Record<string, any>;
  return {
    ...raw,
    max_projects: Number(raw.max_projects ?? legacy.max_workspaces),
  } as HostExamRun;
}

function currentRunRow(): LocalExamRunRow | undefined {
  ensureSchema();
  return getDatabase()
    .prepare(
      `SELECT * FROM exam_runs
       WHERE status <> 'stopped'
       ORDER BY updated_at_ms DESC
       LIMIT 1`,
    )
    .get() as LocalExamRunRow | undefined;
}

function runRow(run_id: string): LocalExamRunRow | undefined {
  ensureSchema();
  return getDatabase()
    .prepare("SELECT * FROM exam_runs WHERE run_id=?")
    .get(run_id) as LocalExamRunRow | undefined;
}

function assertRunIdentity({
  run_id,
  config_generation,
}: {
  run_id: string;
  config_generation: number;
}): LocalExamRunRow {
  const row = runRow(run_id);
  if (!row || row.config_generation !== config_generation) {
    throw new Error("exam run or configuration generation does not match");
  }
  return row;
}

function decodeRun(row: LocalExamRunRow): {
  config: HostExamConfig;
  run: HostExamRun;
} {
  return {
    config: normalizeExamConfig(parseJson<HostExamConfig>(row.config_json)),
    run: normalizeExamRun(parseJson<HostExamRun>(row.run_json)),
  };
}

function listSessions(run_id: string): LocalExamSessionRow[] {
  ensureSchema();
  return getDatabase()
    .prepare(
      "SELECT * FROM exam_sessions WHERE run_id=? ORDER BY created_at_ms",
    )
    .all(run_id) as LocalExamSessionRow[];
}

function activeProjectCount(run_id: string): number {
  ensureSchema();
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM exam_sessions
       WHERE run_id=? AND status IN ('provisioning', 'active', 'cleaning')`,
    )
    .get(run_id) as { count: number };
  return Number(row.count);
}

function readinessForRow(row: LocalExamRunRow): HostExamReadinessCheck[] {
  const { run } = decodeRun(row);
  const ready = row.status === "ready" || row.status === "open";
  return [
    { name: "host_running", ok: true },
    { name: "on_demand", ok: true },
    { name: "public_route", ok: ready },
    {
      name: "rootfs",
      ok: ready,
      detail: `${run.rootfs_image}@${run.rootfs_digest}`,
    },
    { name: "local_snapshot", ok: ready },
    { name: "network_policy", ok: ready },
    { name: "project_smoke", ok: ready },
    { name: "watchdog", ok: watchdogStarted },
  ];
}

function runtimeStatus(row?: LocalExamRunRow): HostExamRuntimeStatus {
  if (!row) {
    return {
      admission_open: false,
      active_projects: 0,
      updated_at: new Date().toISOString(),
    };
  }
  const { config, run } = decodeRun(row);
  return {
    run_id: row.run_id,
    status: row.status,
    config_generation: row.config_generation,
    admission_open: row.admission_open === 1,
    active_projects: activeProjectCount(row.run_id),
    max_projects: run.max_projects,
    scheduled_stop_at: new Date(row.scheduled_stop_at_ms).toISOString(),
    cleanup_deadline_at: new Date(row.cleanup_deadline_at_ms).toISOString(),
    hostname: config.hostname,
    terminal_enabled: run.terminal_enabled,
    network_mode: run.network_mode,
    last_error: row.last_error ?? undefined,
    updated_at: new Date(row.updated_at_ms).toISOString(),
    readiness: readinessForRow(row),
  };
}

async function privilegedExamCommand(
  command:
    | "set-current-exam-run"
    | "clear-current-exam-run"
    | "poweroff-exam-host",
  run_id: string,
): Promise<void> {
  if (!isValidUUID(run_id)) throw new Error("invalid exam run id");
  const { stdout, stderr, exit_code } = await executeCode({
    command: "sudo",
    args: ["-n", STORAGE_WRAPPER, command, run_id],
    timeout: 30,
    err_on_exit: false,
  });
  if (exit_code) {
    throw new Error(
      `${command} failed (exit ${exit_code}): ${stderr || stdout || ""}`.trim(),
    );
  }
}

function assertTokenRateLimit(source: string): void {
  const now = Date.now();
  const recent = (tokenFailures.get(source) ?? []).filter(
    (time) => now - time < TOKEN_FAILURE_WINDOW_MS,
  );
  tokenFailures.set(source, recent);
  if (recent.length >= TOKEN_FAILURE_LIMIT) {
    throw new Error("too many unsuccessful exam join attempts; try later");
  }
}

function noteTokenFailure(source: string): void {
  const recent = tokenFailures.get(source) ?? [];
  recent.push(Date.now());
  tokenFailures.set(source, recent);
}

function reserveProject({
  row,
  account_id,
  project_id,
}: {
  row: LocalExamRunRow;
  account_id: string;
  project_id: string;
}): void {
  const { run } = decodeRun(row);
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = runRow(row.run_id);
    if (
      !current ||
      current.status !== "open" ||
      current.admission_open !== 1 ||
      current.scheduled_stop_at_ms <= Date.now()
    ) {
      throw new Error("exam admission is closed");
    }
    if (activeProjectCount(row.run_id) >= run.max_projects) {
      throw new Error("exam project capacity has been reached");
    }
    db.prepare(
      `INSERT INTO exam_sessions(
        account_id, project_id, run_id, status, created_at_ms,
        expires_at_ms, last_error
      ) VALUES(?, ?, ?, 'provisioning', ?, ?, NULL)`,
    ).run(
      account_id,
      project_id,
      row.run_id,
      Date.now(),
      row.cleanup_deadline_at_ms,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function setStudentProjectFunctionality({
  project_id,
  terminal_enabled,
}: {
  project_id: string;
  terminal_enabled: boolean;
}): void {
  const pk = JSON.stringify({ project_id });
  const project = getRow("projects", pk) ?? { project_id };
  upsertRow("projects", pk, {
    ...project,
    course: {
      type: "student",
      project_id,
      path: "",
      student_project_functionality: {
        disableTerminals: !terminal_enabled,
        disableUploads: true,
        disableCollaborators: true,
        disableAI: true,
      },
    },
    exam_mode: true,
  });
}

async function eraseProject(session: LocalExamSessionRow): Promise<void> {
  const db = getDatabase();
  db.prepare(
    "UPDATE exam_sessions SET status='cleaning', last_error=NULL WHERE account_id=?",
  ).run(session.account_id);
  try {
    const project = getProject(session.project_id);
    if (project?.state && project.state !== "opened") {
      await hubApi.projects.stop({
        project_id: session.project_id,
        force: true,
      });
    }
    await deleteVolume(session.project_id, { reportProvisioned: false });
    deleteProjectLocal(session.project_id);
    deleteRow("accounts", JSON.stringify({ account_id: session.account_id }));
    await setExamProjectNetworkPolicy({
      project_id: session.project_id,
      policy: "normal",
    });
    if (getProject(session.project_id)) {
      throw new Error("project metadata still exists after exam cleanup");
    }
    if (
      getRow("accounts", JSON.stringify({ account_id: session.account_id }))
    ) {
      throw new Error("local account still exists after exam cleanup");
    }
    try {
      await getVolume(session.project_id);
      throw new Error("project volume still exists after exam cleanup");
    } catch (err) {
      if (!`${err}`.includes("project volume does not exist")) {
        throw err;
      }
    }
    db.prepare(
      "UPDATE exam_sessions SET status='deleted', last_error=NULL WHERE account_id=?",
    ).run(session.account_id);
  } catch (err) {
    db.prepare(
      "UPDATE exam_sessions SET status='error', last_error=? WHERE account_id=?",
    ).run(`${err}`, session.account_id);
    throw err;
  }
}

async function provisionProject({
  row,
  account_id,
  project_id,
}: {
  row: LocalExamRunRow;
  account_id: string;
  project_id: string;
}): Promise<void> {
  const { run } = decodeRun(row);
  upsertRow("accounts", JSON.stringify({ account_id }), {
    account_id,
    first_name: "Exam",
    last_name: "User",
    display_name: "Exam User",
    usage_account_id: run.owner_account_id,
  });
  await setExamProjectNetworkPolicy({
    project_id,
    policy: "disabled",
  });
  try {
    await hubApi.projects.createProject({
      project_id,
      title: "Exam Scratchpad",
      image: run.rootfs_image,
      start: true,
      ensure_volume: true,
      users: { [account_id]: { group: "owner" } },
      run_quota: run.run_quota,
      run_quota_revision: 1,
      local_only: true,
      exam_run_id: run.run_id,
      usage_account_id: run.owner_account_id,
      terminal_enabled: run.terminal_enabled,
    } as any);
    upsertProject({
      project_id,
      local_only: true,
      exam_run_id: run.run_id,
      usage_account_id: run.owner_account_id,
    });
    setStudentProjectFunctionality({
      project_id,
      terminal_enabled: run.terminal_enabled,
    });
    await setExamProjectNetworkPolicy({
      project_id,
      policy: "disabled",
    });
    await verifyExamProjectNetworkPolicy({
      project_id,
      policy: "disabled",
    });
    getDatabase()
      .prepare(
        "UPDATE exam_sessions SET status='active', last_error=NULL WHERE account_id=?",
      )
      .run(account_id);
  } catch (err) {
    const session = getDatabase()
      .prepare("SELECT * FROM exam_sessions WHERE account_id=?")
      .get(account_id) as LocalExamSessionRow | undefined;
    if (session) {
      await eraseProject(session).catch((cleanupErr) => {
        logger.error("failed to erase rejected exam project", {
          project_id,
          err: `${cleanupErr}`,
        });
      });
    }
    throw err;
  }
}

async function runProjectSmokeTest(row: LocalExamRunRow): Promise<void> {
  const account_id = randomUUID();
  const project_id = randomUUID();
  const db = getDatabase();
  db.prepare(
    `INSERT INTO exam_sessions(
      account_id, project_id, run_id, status, created_at_ms,
      expires_at_ms, last_error
    ) VALUES(?, ?, ?, 'provisioning', ?, ?, NULL)`,
  ).run(
    account_id,
    project_id,
    row.run_id,
    Date.now(),
    row.cleanup_deadline_at_ms,
  );
  await provisionProject({ row, account_id, project_id });
  try {
    const marker = `cocalc-exam-smoke-${randomUUID()}`;
    const result = await sandboxExec({
      project_id,
      timeoutMs: 90_000,
      maxOutputBytes: 16_384,
      script: `set -eu
mkdir -p .cocalc
printf '%s' '${marker}' > .cocalc/exam-smoke-file
test "$(cat .cocalc/exam-smoke-file)" = '${marker}'
cat > .cocalc/exam-smoke.ipynb <<'JSON'
{"cells":[{"cell_type":"code","execution_count":null,"metadata":{},"outputs":[],"source":["print('${marker}')"]}],"metadata":{"kernelspec":{"display_name":"Python 3","language":"python","name":"python3"}},"nbformat":4,"nbformat_minor":5}
JSON
timeout 60 jupyter nbconvert --execute --to notebook --output exam-smoke-output.ipynb .cocalc/exam-smoke.ipynb >/tmp/cocalc-exam-nbconvert.log 2>&1
grep -q '${marker}' .cocalc/exam-smoke-output.ipynb
python3 - <<'PY'
import os
import socket

for name in ("http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
    if os.environ.get(name):
        raise RuntimeError(f"unexpected proxy environment variable: {name}")

def must_fail(name, operation):
    try:
        operation()
    except OSError:
        return
    raise RuntimeError(f"exam network isolation failed open: {name}")

socket.setdefaulttimeout(2)
must_fail("external DNS", lambda: socket.getaddrinfo("example.com", 443))
must_fail("literal IPv4 TCP", lambda: socket.create_connection(("1.1.1.1", 443), 2))
if socket.has_ipv6:
    must_fail("literal IPv6 TCP", lambda: socket.create_connection(("2606:4700:4700::1111", 443), 2))
PY
printf '%s\\n' '${marker}'
`,
    });
    if (result.code !== 0 || !result.stdout.includes(marker)) {
      throw new Error(
        `exam project readiness failed (code=${result.code}, signal=${result.signal ?? "none"}): ${result.stderr || result.stdout}`,
      );
    }
  } finally {
    const session = db
      .prepare("SELECT * FROM exam_sessions WHERE account_id=?")
      .get(account_id) as LocalExamSessionRow;
    await eraseProject(session);
  }
}

export async function applyExamRunLocal({
  config,
  run,
  token_hash,
}: ApplyHostExamRunRequest): Promise<HostExamRuntimeStatus> {
  config = normalizeExamConfig(config);
  run = normalizeExamRun(run);
  ensureSchema();
  if (config.host_id !== run.host_id) {
    throw new Error("exam config and run host do not match");
  }
  if (config.generation !== run.config_generation) {
    throw new Error("exam configuration generation does not match");
  }
  if (run.network_mode !== "disabled") {
    throw new Error("the exam MVP only supports disabled networking");
  }
  const deadline = new Date(run.scheduled_stop_at).valueOf();
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new Error("exam deadline is invalid or expired");
  }
  const cleanupDeadline = deadline + config.cleanup_grace_minutes * 60_000;
  const cached = await listRootfsCacheEntries();
  const rootfs = cached.find((entry) => entry.image === run.rootfs_image);
  if (!rootfs || rootfs.digest !== run.rootfs_digest) {
    throw new Error("the pinned exam RootFS digest is not cached on this host");
  }
  const existing = currentRunRow();
  if (existing && existing.run_id !== run.run_id) {
    throw new Error("another exam run is still active on this host");
  }
  getDatabase()
    .prepare(
      `INSERT INTO exam_runs(
        run_id, config_generation, status, config_json, run_json, token_hash,
        admission_open, scheduled_stop_at_ms, cleanup_deadline_at_ms,
        last_error, updated_at_ms
      ) VALUES(?, ?, 'preparing', ?, ?, ?, 0, ?, ?, NULL, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        config_generation=excluded.config_generation,
        status='preparing',
        config_json=excluded.config_json,
        run_json=excluded.run_json,
        token_hash=excluded.token_hash,
        admission_open=0,
        scheduled_stop_at_ms=excluded.scheduled_stop_at_ms,
        cleanup_deadline_at_ms=excluded.cleanup_deadline_at_ms,
        last_error=NULL,
        updated_at_ms=excluded.updated_at_ms`,
    )
    .run(
      run.run_id,
      run.config_generation,
      JSON.stringify(config),
      JSON.stringify(run),
      token_hash,
      deadline,
      cleanupDeadline,
      Date.now(),
    );
  await privilegedExamCommand("set-current-exam-run", run.run_id);
  startExamWatchdog();
  try {
    const row = runRow(run.run_id)!;
    await runProjectSmokeTest(row);
    await verifyExamPublicRoute(config.hostname);
    getDatabase()
      .prepare(
        "UPDATE exam_runs SET status='ready', last_error=NULL, updated_at_ms=? WHERE run_id=?",
      )
      .run(Date.now(), run.run_id);
  } catch (err) {
    getDatabase()
      .prepare(
        "UPDATE exam_runs SET status='error', last_error=?, updated_at_ms=? WHERE run_id=?",
      )
      .run(`${err}`, Date.now(), run.run_id);
    throw err;
  }
  return runtimeStatus(runRow(run.run_id));
}

export function getExamRunStatusLocal(opts?: {
  run_id?: string;
}): HostExamRuntimeStatus {
  const row = opts?.run_id ? runRow(opts.run_id) : currentRunRow();
  return runtimeStatus(row);
}

export function openExamRunLocal({
  run_id,
  config_generation,
}: {
  run_id: string;
  config_generation: number;
}): HostExamRuntimeStatus {
  const row = assertRunIdentity({ run_id, config_generation });
  if (row.status !== "ready" && row.status !== "open") {
    throw new Error(`exam run is not ready (status=${row.status})`);
  }
  if (row.scheduled_stop_at_ms <= Date.now()) {
    throw new Error("exam deadline has passed");
  }
  getDatabase()
    .prepare(
      "UPDATE exam_runs SET status='open', admission_open=1, last_error=NULL, updated_at_ms=? WHERE run_id=?",
    )
    .run(Date.now(), run_id);
  return runtimeStatus(runRow(run_id));
}

export function updateExamRunDeadlineLocal({
  run_id,
  config_generation,
  scheduled_stop_at,
}: {
  run_id: string;
  config_generation: number;
  scheduled_stop_at: string;
}): HostExamRuntimeStatus {
  const row = assertRunIdentity({ run_id, config_generation });
  const { config, run } = decodeRun(row);
  const deadline = new Date(scheduled_stop_at).valueOf();
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new Error("exam deadline must be in the future");
  }
  run.scheduled_stop_at = new Date(deadline).toISOString();
  getDatabase()
    .prepare(
      `UPDATE exam_runs
       SET run_json=?, scheduled_stop_at_ms=?, cleanup_deadline_at_ms=?,
           updated_at_ms=?
       WHERE run_id=?`,
    )
    .run(
      JSON.stringify(run),
      deadline,
      deadline + config.cleanup_grace_minutes * 60_000,
      Date.now(),
      run_id,
    );
  return runtimeStatus(runRow(run_id));
}

export function rotateExamRunTokenLocal({
  run_id,
  config_generation,
  token_hash,
}: {
  run_id: string;
  config_generation: number;
  token_hash: string;
}): HostExamRuntimeStatus {
  const row = assertRunIdentity({ run_id, config_generation });
  if (row.status !== "ready") {
    throw new Error(
      "the shared token can only be rotated before admission opens",
    );
  }
  getDatabase()
    .prepare(
      "UPDATE exam_runs SET token_hash=?, updated_at_ms=? WHERE run_id=?",
    )
    .run(token_hash, Date.now(), run_id);
  return runtimeStatus(runRow(run_id));
}

export interface ExamBrowserSession {
  account_id: string;
  project_id: string;
  run_id: string;
  expires_at_ms: number;
}

export function getExamBrowserSession(
  account_id: string,
): ExamBrowserSession | undefined {
  ensureSchema();
  const session = getDatabase()
    .prepare(
      `SELECT * FROM exam_sessions
       WHERE account_id=? AND status='active' AND expires_at_ms>?`,
    )
    .get(account_id, Date.now()) as LocalExamSessionRow | undefined;
  if (!session) return;
  const row = runRow(session.run_id);
  if (
    !row ||
    (row.status !== "open" && row.status !== "ready") ||
    row.cleanup_deadline_at_ms <= Date.now()
  ) {
    return;
  }
  return {
    account_id: session.account_id,
    project_id: session.project_id,
    run_id: session.run_id,
    expires_at_ms: session.expires_at_ms,
  };
}

export async function joinExamRun({
  token,
  source,
}: {
  token: string;
  source: string;
}): Promise<ExamBrowserSession> {
  const row = currentRunRow();
  if (
    !row ||
    row.status !== "open" ||
    row.admission_open !== 1 ||
    row.scheduled_stop_at_ms <= Date.now()
  ) {
    throw new Error("exam admission is closed");
  }
  assertTokenRateLimit(source);
  if (!verifyExamTokenHash(token.trim(), row.token_hash)) {
    noteTokenFailure(source);
    throw new Error("invalid exam token");
  }
  tokenFailures.delete(source);
  const account_id = randomUUID();
  const project_id = randomUUID();
  reserveProject({ row, account_id, project_id });
  await provisionProject({ row, account_id, project_id });
  return {
    account_id,
    project_id,
    run_id: row.run_id,
    expires_at_ms: row.cleanup_deadline_at_ms,
  };
}

export async function closeAndCleanupExamRunLocal({
  run_id,
  config_generation,
  poweroff = false,
}: {
  run_id: string;
  config_generation: number;
  poweroff?: boolean;
}): Promise<HostExamRuntimeStatus> {
  if (cleanupInFlight) return await cleanupInFlight;
  cleanupInFlight = (async () => {
    assertRunIdentity({ run_id, config_generation });
    const db = getDatabase();
    db.prepare(
      "UPDATE exam_runs SET status='cleaning', admission_open=0, updated_at_ms=? WHERE run_id=?",
    ).run(Date.now(), run_id);
    const errors: string[] = [];
    for (const session of listSessions(run_id)) {
      if (session.status === "deleted") continue;
      try {
        await eraseProject(session);
      } catch (err) {
        errors.push(`${session.project_id}: ${err}`);
      }
    }
    const remaining = listSessions(run_id).filter(
      (session) => session.status !== "deleted",
    );
    if (remaining.length || errors.length) {
      const message = `exam cleanup incomplete: ${errors.join("; ") || `${remaining.length} projects remain`}`;
      db.prepare(
        "UPDATE exam_runs SET status='error', last_error=?, updated_at_ms=? WHERE run_id=?",
      ).run(message, Date.now(), run_id);
      throw new Error(message);
    }
    db.prepare("DELETE FROM exam_sessions WHERE run_id=?").run(run_id);
    db.prepare(
      "UPDATE exam_runs SET status='stopped', admission_open=0, last_error=NULL, updated_at_ms=? WHERE run_id=?",
    ).run(Date.now(), run_id);
    const status = runtimeStatus(runRow(run_id));
    if (poweroff) {
      setTimeout(() => {
        void privilegedExamCommand("poweroff-exam-host", run_id).catch(
          (err) => {
            logger.error("unable to power off cleaned exam host", {
              run_id,
              err: `${err}`,
            });
          },
        );
      }, POWEROFF_RESPONSE_GRACE_MS).unref?.();
    } else {
      await privilegedExamCommand("clear-current-exam-run", run_id);
    }
    return status;
  })().finally(() => {
    cleanupInFlight = undefined;
  });
  return await cleanupInFlight;
}

async function reconcileDeadline(): Promise<void> {
  const row = currentRunRow();
  if (!row || row.scheduled_stop_at_ms > Date.now()) return;
  if (row.status === "stopped") return;
  try {
    await closeAndCleanupExamRunLocal({
      run_id: row.run_id,
      config_generation: row.config_generation,
      poweroff: true,
    });
  } catch (err) {
    logger.error("local exam deadline cleanup failed", {
      run_id: row.run_id,
      cleanup_deadline_at: new Date(row.cleanup_deadline_at_ms).toISOString(),
      err: `${err}`,
    });
    if (Date.now() >= row.cleanup_deadline_at_ms) {
      await privilegedExamCommand("poweroff-exam-host", row.run_id);
    }
  }
}

export function startExamWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  void reconcileDeadline().catch((err) => {
    logger.error("initial local exam deadline reconciliation failed", {
      err: `${err}`,
    });
  });
  const timer = setInterval(() => {
    void reconcileDeadline().catch((err) => {
      logger.error("local exam deadline reconciliation failed", {
        err: `${err}`,
      });
    });
  }, WATCHDOG_INTERVAL_MS);
  timer.unref?.();
}
