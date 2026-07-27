/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { request } from "node:http";
import { userInfo } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import getPort from "@cocalc/backend/get-port";
import getLogger from "@cocalc/backend/logger";
import basePath from "@cocalc/backend/base-path";
import { conatServer } from "@cocalc/backend/data";
import type { Client } from "@cocalc/conat/core/client";
import { get as getProjectInfo } from "@cocalc/conat/project/project-info";
import type { ProjectStatus } from "@cocalc/conat/project/runner/state";
import type { Configuration } from "@cocalc/conat/project/runner/types";
import { isValidUUID } from "@cocalc/util/misc";
import { dataPath, secretTokenPath } from "./env";
import type {
  ProjectRuntimeBackend,
  RecoveredProject,
  RuntimeSaveOptions,
  RuntimeStartOptions,
  RuntimeStatusOptions,
  RuntimeStopOptions,
} from "./runtime-backend";
import { ensureConfFilesExists, setupDataPath, writeSecretToken } from "./util";

const logger = getLogger("project-runner:run:workspace");

const RECORD_SCHEMA_VERSION = 1;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 8_000;
const POLL_INTERVAL_MS = 100;

const INHERITED_ENV_ALLOWLIST = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LD_LIBRARY_PATH",
  "NODE_ENV",
  "NODE_PATH",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
] as const;

const EXACT_BLOCKED_ENV = new Set([
  "CONAT_SERVER",
  "DATA",
  "DATABASE_URL",
  "HOME",
  "LOGNAME",
  "NODE_OPTIONS",
  "PGDATABASE",
  "PGHOST",
  "PGPASSWORD",
  "PGPORT",
  "PGUSER",
  "SMC",
  "USER",
]);

const BLOCKED_ENV_PREFIXES = [
  "AWS_",
  "CF_",
  "CLOUDFLARE_",
  "CLOUDSDK_",
  "COCALC_AGENT_",
  "COCALC_API_",
  "COCALC_BEARER_",
  "COCALC_BROWSER_",
  "COCALC_PROJECT_",
  "COCALC_RUNTIME_",
  "GOOGLE_",
  "MAILGUN_",
  "PG",
  "SENDGRID_",
  "STRIPE_",
];

type RuntimeRecordState = "starting" | "running" | "failed";

export interface WorkspaceRuntimeRecord {
  schema_version: 1;
  project_id: string;
  pid: number;
  process_group_id: number;
  process_start_ticks: string;
  spawned_at: string;
  argv0: string;
  executable: string;
  project_bin: string;
  home: string;
  data: string;
  hub_port: number;
  browser_port: number;
  http_port: number;
  source_commit?: string;
  runner_instance_id: string;
  last_observed_state: RuntimeRecordState;
  last_error?: string;
}

interface ProcessIdentity {
  state: string;
  process_group_id: number;
  process_start_ticks: string;
  executable?: string;
  command: string[];
  project_id?: string;
  home?: string;
  data?: string;
}

type IdentityResult =
  | { kind: "dead" }
  | { kind: "mismatch"; detail: string }
  | { kind: "match"; identity: ProcessIdentity };

export interface WorkspaceRuntimeOptions {
  client: Client;
  projectPath?: string;
  statePath?: string;
  logsPath?: string;
  projectBin?: string;
  nodeBin?: string;
  conatServer?: string;
  runnerInstanceId?: string;
  readinessTimeoutMs?: number;
  stopTimeoutMs?: number;
}

function configuredAbsolutePath(
  name: string,
  value: string | undefined,
): string {
  const path = `${value ?? ""}`.trim();
  if (!path) {
    throw new Error(`${name} must be set for the workspace runtime`);
  }
  if (!isAbsolute(path)) {
    throw new Error(`${name} must be an absolute path; got '${path}'`);
  }
  return resolve(path);
}

function defaultDataPath(name: string): string | undefined {
  const data = process.env.COCALC_DATA_DIR ?? process.env.DATA;
  return data ? join(data, name) : undefined;
}

function isPathInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function resolveDefaultProjectBin(): string {
  const candidates = [
    join(__dirname, "..", "..", "project", "bin", "cocalc-project.js"),
    join(__dirname, "..", "..", "..", "project", "bin", "cocalc-project.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function sourceRootForProjectBin(projectBin: string): string | undefined {
  const normalized = resolve(projectBin);
  const marker = `${join("packages", "project", "bin")}/`;
  const withSlash = normalized.split("\\").join("/");
  const index = withSlash.lastIndexOf(marker);
  return index >= 0 ? resolve(withSlash.slice(0, index)) : undefined;
}

export function sanitizeWorkspaceConfiguredEnvironment(
  configured: Configuration["env"],
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(configured ?? {})) {
    const normalized = key.trim().toUpperCase();
    if (
      !/^[A-Z_][A-Z0-9_]*$/.test(normalized) ||
      EXACT_BLOCKED_ENV.has(normalized) ||
      BLOCKED_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      logger.warn("workspace runtime ignored unsafe project environment key", {
        key,
      });
      continue;
    }
    safe[normalized] = `${value}`;
  }
  return safe;
}

function unsupportedResourceOptions(config: Configuration): string[] {
  return [
    "authorized_keys",
    "core",
    "cpu",
    "disk",
    "gpu",
    "image",
    "io_class",
    "memory",
    "nofile",
    "pids",
    "restore",
    "restore_backup_id",
    "scratch",
    "secrets",
    "shmSize",
    "ssh_port",
    "ssh_proxy_public_key",
    "swap",
    "tmp",
  ].filter((key) => config[key] != null);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpIsReachable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        method: "GET",
        path: "/",
        port,
        timeout: 1_500,
      },
      (response) => {
        response.resume();
        resolve(true);
      },
    );
    req.once("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.once("error", () => resolve(false));
    req.end();
  });
}

async function readProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) {
      throw new Error("invalid /proc stat");
    }
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    if (fields[0] === "Z" || fields[0] === "X") {
      return null;
    }
    const [executable, cmdline, environ] = await Promise.all([
      readlink(`/proc/${pid}/exe`).catch((err: any) => {
        if (err?.code === "EACCES" || err?.code === "EPERM") {
          return undefined;
        }
        throw err;
      }),
      readFile(`/proc/${pid}/cmdline`),
      readFile(`/proc/${pid}/environ`).catch((err: any) => {
        if (err?.code === "EACCES" || err?.code === "EPERM") {
          return undefined;
        }
        throw err;
      }),
    ]);
    const command = cmdline.toString().split("\0").filter(Boolean);
    const environment: Record<string, string> = {};
    for (const entry of environ?.toString().split("\0").filter(Boolean) ?? []) {
      const index = entry.indexOf("=");
      environment[index < 0 ? entry : entry.slice(0, index)] =
        index < 0 ? "" : entry.slice(index + 1);
    }
    return {
      state: fields[0],
      process_group_id: Number(fields[2]),
      process_start_ticks: fields[19],
      executable: executable ? resolve(executable) : undefined,
      command,
      project_id: environment.COCALC_PROJECT_ID,
      home: environment.HOME,
      data: environment.DATA,
    };
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ESRCH") {
      return null;
    }
    throw err;
  }
}

async function inspectRecordIdentity(
  record: WorkspaceRuntimeRecord,
): Promise<IdentityResult> {
  let identity: ProcessIdentity | null;
  try {
    identity = await readProcessIdentity(record.pid);
  } catch (err) {
    return {
      kind: "mismatch",
      detail: `unable to inspect pid ${record.pid}: ${err}`,
    };
  }
  if (identity == null) {
    return { kind: "dead" };
  }
  const mismatches: string[] = [];
  if (identity.process_start_ticks !== record.process_start_ticks) {
    mismatches.push("process start time changed");
  }
  if (identity.process_group_id !== record.process_group_id) {
    mismatches.push("process group changed");
  }
  if (
    identity.executable != null &&
    identity.executable !== resolve(record.executable)
  ) {
    mismatches.push("executable changed");
  }
  if (identity.command[0] !== record.argv0) {
    mismatches.push("workspace process identity changed");
  }
  if (
    identity.project_id != null &&
    identity.project_id !== record.project_id
  ) {
    mismatches.push("project id environment changed");
  }
  if (identity.home != null && identity.home !== record.home) {
    mismatches.push("home environment changed");
  }
  if (identity.data != null && identity.data !== record.data) {
    mismatches.push("data environment changed");
  }
  if (
    !identity.command.some(
      (arg) => isAbsolute(arg) && resolve(arg) === resolve(record.project_bin),
    )
  ) {
    mismatches.push("project command changed");
  }
  if (mismatches.length > 0) {
    return { kind: "mismatch", detail: mismatches.join(", ") };
  }
  return { kind: "match", identity };
}

export class WorkspaceRuntimeBackend implements ProjectRuntimeBackend {
  readonly name = "workspace" as const;
  private readonly client: Client;
  private readonly projectPath: string;
  private readonly statePath: string;
  private readonly recordsPath: string;
  private readonly logsPath: string;
  private readonly projectBin: string;
  private readonly nodeBin: string;
  private readonly conatServer: string;
  private readonly runnerInstanceId: string;
  private readonly readinessTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly reservedHttpPorts = new Set<number>();
  private portAllocation: Promise<unknown> = Promise.resolve();

  constructor(options: WorkspaceRuntimeOptions) {
    this.client = options.client;
    this.projectPath = configuredAbsolutePath(
      "COCALC_PROJECT_PATH",
      options.projectPath ?? process.env.COCALC_PROJECT_PATH,
    );
    this.statePath = configuredAbsolutePath(
      "COCALC_WORKSPACE_RUNTIME_STATE",
      options.statePath ??
        process.env.COCALC_WORKSPACE_RUNTIME_STATE ??
        defaultDataPath("runtime"),
    );
    this.recordsPath = join(this.statePath, "projects");
    this.logsPath = configuredAbsolutePath(
      "COCALC_WORKSPACE_RUNTIME_LOGS",
      options.logsPath ??
        process.env.COCALC_WORKSPACE_RUNTIME_LOGS ??
        defaultDataPath(join("logs", "projects")),
    );
    this.projectBin = configuredAbsolutePath(
      "COCALC_WORKSPACE_RUNTIME_PROJECT_BIN",
      options.projectBin ??
        process.env.COCALC_WORKSPACE_RUNTIME_PROJECT_BIN ??
        resolveDefaultProjectBin(),
    );
    this.nodeBin = configuredAbsolutePath(
      "COCALC_WORKSPACE_RUNTIME_NODE",
      options.nodeBin ??
        process.env.COCALC_WORKSPACE_RUNTIME_NODE ??
        process.execPath,
    );
    this.conatServer =
      `${options.conatServer ?? conatServer}`.trim() ||
      (() => {
        throw new Error("the workspace runtime requires an inner CONAT_SERVER");
      })();
    this.runnerInstanceId = options.runnerInstanceId ?? randomUUID();
    this.readinessTimeoutMs =
      options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  async init(): Promise<RecoveredProject[]> {
    if (process.platform !== "linux") {
      throw new Error(
        "COCALC_PROJECT_RUNTIME=workspace currently requires Linux process identity checks",
      );
    }
    const sourceRoot = sourceRootForProjectBin(this.projectBin);
    if (sourceRoot) {
      for (const [name, path] of [
        ["COCALC_PROJECT_PATH", this.projectPath],
        ["COCALC_WORKSPACE_RUNTIME_STATE", this.statePath],
        ["COCALC_WORKSPACE_RUNTIME_LOGS", this.logsPath],
      ] as const) {
        if (isPathInside(path, sourceRoot)) {
          throw new Error(
            `${name} must be outside the source checkout '${sourceRoot}'`,
          );
        }
      }
    }
    await Promise.all([
      access(this.projectBin),
      access(this.nodeBin),
      mkdir(this.projectPath, { recursive: true, mode: 0o700 }),
      mkdir(this.recordsPath, { recursive: true, mode: 0o700 }),
      mkdir(this.logsPath, { recursive: true, mode: 0o700 }),
    ]);
    logger.info("workspace runtime initialized", {
      project_path: this.projectPath,
      state_path: this.statePath,
      logs_path: this.logsPath,
      project_bin: this.projectBin,
      node_bin: this.nodeBin,
      runner_instance_id: this.runnerInstanceId,
      isolation: "none; trusted inner users only",
    });
    const recovered = await this.recover();
    await this.writeJsonAtomic(join(this.statePath, "site.json"), {
      schema_version: RECORD_SCHEMA_VERSION,
      runtime: "workspace",
      supervisor_pid: process.pid,
      runner_instance_id: this.runnerInstanceId,
      started_at: new Date().toISOString(),
      project_path: this.projectPath,
      state_path: this.statePath,
      logs_path: this.logsPath,
      project_bin: this.projectBin,
      node_bin: this.nodeBin,
      source_commit: process.env.COCALC_SOURCE_COMMIT,
      recovered_projects: recovered.map(({ project_id }) => project_id),
      isolation: "none; trusted inner users only",
    });
    return recovered;
  }

  async start(opts: RuntimeStartOptions): Promise<ProjectStatus> {
    return await this.withProjectLock(opts.project_id, async () => {
      return await this.startUnlocked(opts);
    });
  }

  async stop(opts: RuntimeStopOptions): Promise<void> {
    await this.withProjectLock(opts.project_id, async () => {
      await this.stopUnlocked(opts.project_id);
    });
  }

  async status(opts: RuntimeStatusOptions): Promise<ProjectStatus> {
    return await this.withProjectLock(opts.project_id, async () => {
      const record = await this.readRecord(opts.project_id);
      if (!record) {
        return { state: "opened" };
      }
      const identity = await inspectRecordIdentity(record);
      if (identity.kind === "dead") {
        await this.removeRecord(opts.project_id);
        this.reservedHttpPorts.delete(record.http_port);
        return { state: "opened" };
      }
      if (identity.kind === "mismatch") {
        logger.error("workspace runtime refused to trust a reused pid", {
          project_id: opts.project_id,
          pid: record.pid,
          detail: identity.detail,
        });
        await this.removeRecord(opts.project_id);
        this.reservedHttpPorts.delete(record.http_port);
        return {
          state: "opened",
          error: `stale workspace runtime record: ${identity.detail}`,
        };
      }
      const health = await this.getHealth(record);
      return {
        state: "running",
        http_port: record.http_port,
        ssh_port: 0,
        error: health.healthy
          ? undefined
          : `workspace project health check is pending (${health.detail})`,
      };
    });
  }

  async save({
    rootfs = true,
    home = true,
  }: RuntimeSaveOptions): Promise<void> {
    if (rootfs) {
      throw new Error(
        "rootfs save is unsupported by the workspace runtime; project homes are ordinary persistent directories",
      );
    }
    if (home) {
      return;
    }
  }

  private async startUnlocked({
    project_id,
    config = {},
    localPath,
  }: RuntimeStartOptions): Promise<ProjectStatus> {
    if (!isValidUUID(project_id)) {
      throw new Error(`invalid workspace project_id '${project_id}'`);
    }
    const unsupported = unsupportedResourceOptions(config);
    if (unsupported.length > 0) {
      logger.warn("workspace runtime does not enforce requested options", {
        project_id,
        unsupported,
      });
    }
    if (!config.secret) {
      throw new Error(
        "workspace runtime start requires the project's Conat secret",
      );
    }

    const existing = await this.readRecord(project_id);
    if (existing) {
      const identity = await inspectRecordIdentity(existing);
      if (
        identity.kind === "match" &&
        (await this.getHealth(existing)).healthy
      ) {
        logger.info("workspace runtime adopted project during start", {
          project_id,
          pid: existing.pid,
        });
        return this.runningStatus(existing);
      }
      if (identity.kind === "match") {
        logger.warn("terminating unhealthy workspace project before restart", {
          project_id,
          pid: existing.pid,
        });
        await this.terminateRecord(existing);
      } else if (identity.kind === "mismatch") {
        logger.error(
          "removing ambiguous workspace runtime record without signaling",
          {
            project_id,
            pid: existing.pid,
            detail: identity.detail,
          },
        );
      }
      await this.removeRecord(project_id);
    }

    const { home } = await localPath({
      project_id,
      disk: undefined,
      scratch: 0,
      ensure: true,
    });
    if (resolve(home) !== join(this.projectPath, project_id)) {
      throw new Error(
        `workspace localPath resolved '${home}', expected '${join(this.projectPath, project_id)}'`,
      );
    }
    await ensureConfFilesExists(home);
    await setupDataPath(home);
    await writeSecretToken(home, config.secret);
    await chmod(secretTokenPath(home), 0o600);

    const httpPort = await this.reserveHttpPort(config.http_port);
    const stdoutPath = join(this.logsPath, `${project_id}.stdout.log`);
    const stderrPath = join(this.logsPath, `${project_id}.stderr.log`);
    const [stdout, stderr] = await Promise.all([
      open(stdoutPath, "a", 0o600),
      open(stderrPath, "a", 0o600),
    ]);
    const env = this.buildChildEnvironment({
      project_id,
      home,
      httpPort,
      configured: config.env,
    });
    const argv0 = `cocalc-workspace-project:${project_id}`;
    const child = spawn(
      this.nodeBin,
      [this.projectBin, "--hostname", "127.0.0.1"],
      {
        argv0,
        cwd: home,
        detached: true,
        env,
        stdio: ["ignore", stdout.fd, stderr.fd],
      },
    );
    try {
      await new Promise<void>((resolveSpawn, rejectSpawn) => {
        child.once("spawn", resolveSpawn);
        child.once("error", rejectSpawn);
      });
    } finally {
      await Promise.all([stdout.close(), stderr.close()]);
    }
    child.unref();
    if (!child.pid) {
      throw new Error("workspace project process started without a pid");
    }

    let record: WorkspaceRuntimeRecord | undefined;
    try {
      const identity = await readProcessIdentity(child.pid);
      if (!identity) {
        throw new Error("workspace project exited immediately after spawn");
      }
      record = {
        schema_version: RECORD_SCHEMA_VERSION,
        project_id,
        pid: child.pid,
        process_group_id: identity.process_group_id,
        process_start_ticks: identity.process_start_ticks,
        spawned_at: new Date().toISOString(),
        argv0,
        executable: identity.executable ?? resolve(this.nodeBin),
        project_bin: this.projectBin,
        home,
        data: dataPath(home),
        hub_port: 0,
        browser_port: httpPort,
        http_port: httpPort,
        source_commit: process.env.COCALC_SOURCE_COMMIT,
        runner_instance_id: this.runnerInstanceId,
        last_observed_state: "starting",
      };
      await this.writeRecord(record);
      await this.waitUntilHealthy(record, this.readinessTimeoutMs);
      record.last_observed_state = "running";
      delete record.last_error;
      await this.writeRecord(record);
      logger.info("workspace project started", {
        project_id,
        pid: record.pid,
        http_port: record.http_port,
        stdout: stdoutPath,
        stderr: stderrPath,
      });
      return this.runningStatus(record);
    } catch (err) {
      const detail = `${err}`;
      if (record) {
        record.last_observed_state = "failed";
        record.last_error = detail;
        await this.writeRecord(record).catch(() => {});
        await this.terminateRecord(record).catch((stopErr) => {
          logger.error(
            "failed to terminate workspace project after start error",
            {
              project_id,
              pid: record?.pid,
              err: `${stopErr}`,
            },
          );
        });
      }
      this.reservedHttpPorts.delete(httpPort);
      throw new Error(
        `workspace project ${project_id} failed to become ready: ${detail}; inspect ${stderrPath}`,
      );
    }
  }

  private buildChildEnvironment({
    project_id,
    home,
    httpPort,
    configured,
  }: {
    project_id: string;
    home: string;
    httpPort: number;
    configured?: Configuration["env"];
  }): NodeJS.ProcessEnv {
    const identity = userInfo();
    const data = dataPath(home);
    const env: NodeJS.ProcessEnv = {};
    for (const key of INHERITED_ENV_ALLOWLIST) {
      if (process.env[key] != null) {
        env[key] = process.env[key];
      }
    }
    env.PATH ??= "/usr/local/bin:/usr/bin:/bin";
    const extra = {
      ...sanitizeWorkspaceConfiguredEnvironment(configured),
      BASE_PATH: basePath,
      COCALC_PROJECT_ID: project_id,
      COCALC_PROJECT_INFO_SCOPE: "owned",
      COCALC_SECRET_TOKEN: secretTokenPath(home),
      COCALC_USERNAME: identity.username,
      CONAT_SERVER: this.conatServer,
      DATA: data,
      DEBUG_CONSOLE: "no",
      ...(env.NODE_PATH ? { NODE_PATH: env.NODE_PATH } : {}),
      SMC: data,
    };
    return {
      ...env,
      BASE_PATH: basePath,
      COCALC_EXTRA_ENV: Buffer.from(JSON.stringify(extra)).toString("base64"),
      COCALC_PROJECT_ID: project_id,
      COCALC_PROXY_HOST: "127.0.0.1",
      COCALC_PROXY_PORT: `${httpPort}`,
      COCALC_SECRET_TOKEN: secretTokenPath(home),
      COCALC_USERNAME: identity.username,
      CONAT_SERVER: this.conatServer,
      DATA: data,
      DEBUG: process.env.COCALC_PROJECT_DEBUG ?? "",
      DEBUG_CONSOLE: "no",
      HOME: home,
      LOGNAME: identity.username,
      SMC: data,
      USER: identity.username,
    };
  }

  private async recover(): Promise<RecoveredProject[]> {
    const recovered: RecoveredProject[] = [];
    for (const name of await readdir(this.recordsPath)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      let record: WorkspaceRuntimeRecord;
      try {
        record = JSON.parse(
          await readFile(join(this.recordsPath, name), "utf8"),
        );
        this.validateRecord(record);
      } catch (err) {
        logger.error("removing invalid workspace runtime record", {
          record: name,
          err: `${err}`,
        });
        await rm(join(this.recordsPath, name), { force: true });
        continue;
      }
      const identity = await inspectRecordIdentity(record);
      this.reservedHttpPorts.add(record.http_port);
      if (identity.kind === "dead") {
        logger.info("removing dead workspace runtime record", {
          project_id: record.project_id,
          pid: record.pid,
        });
        await this.removeRecord(record.project_id);
        this.reservedHttpPorts.delete(record.http_port);
        continue;
      }
      if (identity.kind === "mismatch") {
        logger.error("removing ambiguous workspace record without signaling", {
          project_id: record.project_id,
          pid: record.pid,
          detail: identity.detail,
        });
        await this.removeRecord(record.project_id);
        this.reservedHttpPorts.delete(record.http_port);
        continue;
      }
      try {
        await this.waitUntilHealthy(
          record,
          Math.min(this.readinessTimeoutMs, 10_000),
        );
        record.runner_instance_id = this.runnerInstanceId;
        record.last_observed_state = "running";
        delete record.last_error;
        await this.writeRecord(record);
        recovered.push({
          project_id: record.project_id,
          status: this.runningStatus(record),
        });
        logger.info("adopted workspace project during recovery", {
          project_id: record.project_id,
          pid: record.pid,
          http_port: record.http_port,
        });
      } catch (err) {
        logger.warn("terminating unhealthy workspace project during recovery", {
          project_id: record.project_id,
          pid: record.pid,
          err: `${err}`,
        });
        await this.terminateRecord(record);
        await this.removeRecord(record.project_id);
        this.reservedHttpPorts.delete(record.http_port);
      }
    }
    logger.info("workspace runtime recovery complete", {
      recovered: recovered.length,
    });
    return recovered;
  }

  private async stopUnlocked(project_id: string): Promise<void> {
    const record = await this.readRecord(project_id);
    if (!record) {
      return;
    }
    const identity = await inspectRecordIdentity(record);
    if (identity.kind === "dead") {
      await this.removeRecord(project_id);
      this.reservedHttpPorts.delete(record.http_port);
      return;
    }
    if (identity.kind === "mismatch") {
      await this.removeRecord(project_id);
      throw new Error(
        `refusing to stop pid ${record.pid} for ${project_id}: ${identity.detail}`,
      );
    }
    await this.terminateRecord(record);
    await this.removeRecord(project_id);
    this.reservedHttpPorts.delete(record.http_port);
    logger.info("workspace project stopped", { project_id, pid: record.pid });
  }

  private async terminateRecord(record: WorkspaceRuntimeRecord): Promise<void> {
    const initial = await inspectRecordIdentity(record);
    if (initial.kind === "dead") {
      return;
    }
    if (initial.kind === "mismatch") {
      throw new Error(
        `refusing to signal pid ${record.pid}: ${initial.detail}`,
      );
    }
    try {
      process.kill(-record.process_group_id, "SIGTERM");
    } catch (err: any) {
      if (err?.code === "ESRCH") {
        return;
      }
      throw err;
    }
    const deadline = Date.now() + this.stopTimeoutMs;
    while (Date.now() < deadline) {
      const current = await inspectRecordIdentity(record);
      if (current.kind === "dead") {
        return;
      }
      if (current.kind === "mismatch") {
        throw new Error(
          `process identity changed while stopping pid ${record.pid}: ${current.detail}`,
        );
      }
      await wait(POLL_INTERVAL_MS);
    }
    const current = await inspectRecordIdentity(record);
    if (current.kind === "dead") {
      return;
    }
    if (current.kind === "mismatch") {
      throw new Error(
        `process identity changed before SIGKILL for pid ${record.pid}: ${current.detail}`,
      );
    }
    try {
      process.kill(-record.process_group_id, "SIGKILL");
    } catch (err: any) {
      if (err?.code === "ESRCH") {
        return;
      }
      throw err;
    }
    const killDeadline = Date.now() + 3_000;
    while (Date.now() < killDeadline) {
      if ((await inspectRecordIdentity(record)).kind === "dead") {
        return;
      }
      await wait(POLL_INTERVAL_MS);
    }
    throw new Error(
      `workspace process group ${record.process_group_id} survived SIGKILL`,
    );
  }

  private async getHealth(record: WorkspaceRuntimeRecord): Promise<{
    healthy: boolean;
    detail: string;
  }> {
    const [projectInfo, http] = await Promise.all([
      getProjectInfo({
        client: this.client,
        project_id: record.project_id,
      }).catch(() => undefined),
      httpIsReachable(record.http_port),
    ]);
    const scope = projectInfo?.scope ?? "missing";
    return {
      healthy: scope === "owned" && http,
      detail: `project_info_scope=${scope}, http=${http ? "reachable" : "unreachable"}`,
    };
  }

  private async waitUntilHealthy(
    record: WorkspaceRuntimeRecord,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let healthDetail = "not checked";
    while (Date.now() < deadline) {
      const identity = await inspectRecordIdentity(record);
      if (identity.kind !== "match") {
        throw new Error(
          identity.kind === "dead"
            ? "process exited"
            : `process identity mismatch: ${identity.detail}`,
        );
      }
      const health = await this.getHealth(record);
      healthDetail = health.detail;
      if (health.healthy) {
        return;
      }
      await wait(POLL_INTERVAL_MS);
    }
    throw new Error(
      `readiness timed out after ${timeoutMs}ms (${healthDetail})`,
    );
  }

  private runningStatus(record: WorkspaceRuntimeRecord): ProjectStatus {
    return {
      state: "running",
      http_port: record.http_port,
      ssh_port: 0,
    };
  }

  private recordPath(project_id: string): string {
    if (!isValidUUID(project_id)) {
      throw new Error(`invalid workspace project_id '${project_id}'`);
    }
    return join(this.recordsPath, `${project_id}.json`);
  }

  private validateRecord(record: WorkspaceRuntimeRecord): void {
    if (
      record?.schema_version !== RECORD_SCHEMA_VERSION ||
      !isValidUUID(record.project_id) ||
      !Number.isInteger(record.pid) ||
      record.pid <= 1 ||
      !Number.isInteger(record.process_group_id) ||
      record.process_group_id <= 1 ||
      record.process_group_id !== record.pid ||
      !record.process_start_ticks ||
      record.argv0 !== `cocalc-workspace-project:${record.project_id}` ||
      !isAbsolute(record.executable) ||
      !isAbsolute(record.project_bin) ||
      !isAbsolute(record.home) ||
      !isAbsolute(record.data) ||
      !Number.isInteger(record.http_port) ||
      record.http_port <= 0
    ) {
      throw new Error("invalid workspace runtime record");
    }
    if (
      resolve(record.home) !== join(this.projectPath, record.project_id) ||
      resolve(record.data) !== dataPath(record.home) ||
      resolve(record.project_bin) !== this.projectBin
    ) {
      throw new Error(
        "workspace runtime record paths do not match configuration",
      );
    }
    if (
      basename(this.recordPath(record.project_id)) !==
      `${record.project_id}.json`
    ) {
      throw new Error("invalid workspace runtime record path");
    }
  }

  private async readRecord(
    project_id: string,
  ): Promise<WorkspaceRuntimeRecord | undefined> {
    try {
      const record = JSON.parse(
        await readFile(this.recordPath(project_id), "utf8"),
      );
      this.validateRecord(record);
      return record;
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return;
      }
      throw err;
    }
  }

  private async writeRecord(record: WorkspaceRuntimeRecord): Promise<void> {
    this.validateRecord(record);
    await this.writeJsonAtomic(this.recordPath(record.project_id), record);
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const temporary = join(
      dirname(path),
      `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  private async removeRecord(project_id: string): Promise<void> {
    await rm(this.recordPath(project_id), { force: true });
  }

  private async reserveHttpPort(configured?: number): Promise<number> {
    return await this.withPortAllocationLock(async () => {
      if (Number.isInteger(configured) && Number(configured) > 0) {
        const port = Number(configured);
        if (this.reservedHttpPorts.has(port)) {
          throw new Error(`workspace HTTP port ${port} is already reserved`);
        }
        this.reservedHttpPorts.add(port);
        return port;
      }
      for (;;) {
        const port = await getPort();
        if (!this.reservedHttpPorts.has(port)) {
          this.reservedHttpPorts.add(port);
          return port;
        }
      }
    });
  }

  private async withPortAllocationLock<T>(
    action: () => Promise<T>,
  ): Promise<T> {
    const prior = this.portAllocation;
    const current = prior.catch(() => {}).then(action);
    this.portAllocation = current;
    try {
      return await current;
    } finally {
      if (this.portAllocation === current) {
        this.portAllocation = Promise.resolve();
      }
    }
  }

  private async withProjectLock<T>(
    project_id: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const prior = this.locks.get(project_id) ?? Promise.resolve();
    const current = prior.catch(() => {}).then(action);
    this.locks.set(project_id, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(project_id) === current) {
        this.locks.delete(project_id);
      }
    }
  }
}
