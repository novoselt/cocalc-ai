/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { Command } from "commander";

import type {
  HostExamConfigInput,
  HostExamRun,
  HostExamState,
} from "@cocalc/conat/hub/api/hosts";
import { durationToMs } from "../../core/utils";

const DEFAULT_CONFIG: HostExamConfigInput = {
  enabled: false,
  max_projects: 100,
  project_cpu: 1,
  project_memory_mb: 2_000,
  project_disk_mb: 5_000,
  project_ttl_minutes: 6 * 60,
  cleanup_grace_minutes: 10,
  terminal_enabled: false,
  network_mode: "disabled",
};
const STATUS_TIMEOUT_MS = 30_000;
const MUTATION_TIMEOUT_MS = 2 * 60_000;
const LIFECYCLE_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_POLL_MS = 2_000;
const TRANSIENT_STATUSES = new Set(["preparing", "closing", "cleaning"]);

export type HostExamCommandDeps = {
  withContext: any;
  resolveHost: any;
};

type ExamCommandOptions = {
  browserId?: string;
  idempotencyKey?: string;
  waitTimeout?: string;
};

function parseNumber(
  value: string | undefined,
  current: number,
  label: string,
  { integer = false }: { integer?: boolean } = {},
): number {
  if (value == null) return current;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} must be ${integer ? "an integer" : "a number"}`);
  }
  return parsed;
}

function parseDeleteAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw new Error("--delete-at must be an ISO timestamp");
  }
  return date.toISOString();
}

function operationKey(prefix: string, supplied?: string): string {
  return `${supplied ?? ""}`.trim() || `${prefix}:${randomUUID()}`;
}

function browserId(opts: ExamCommandOptions): string | undefined {
  return `${opts.browserId ?? ""}`.trim() || undefined;
}

function operationTimeout(
  opts: ExamCommandOptions,
  fallbackMs: number,
): number {
  return Math.max(1_000, durationToMs(opts.waitTimeout, fallbackMs));
}

function activeRun(state: HostExamState): HostExamRun {
  if (!state.run || state.run.status === "stopped") {
    throw new Error("this host has no active exam run");
  }
  return state.run;
}

function ensureBooleanChoice({
  positive,
  negative,
  positiveFlag,
  negativeFlag,
}: {
  positive?: boolean;
  negative?: boolean;
  positiveFlag: string;
  negativeFlag: string;
}): void {
  if (positive && negative) {
    throw new Error(`${positiveFlag} and ${negativeFlag} cannot be combined`);
  }
}

function hostCapacity(host: any, state: HostExamState) {
  const maxProjects = state.config?.max_projects ?? state.run?.max_projects;
  if (maxProjects == null) return undefined;
  const actualCpu = Number(
    host.host_cpu_count ?? host.runtime?.cpu_count ?? host.machine?.cpu,
  );
  const actualRamGiB = Number(
    host.host_ram_gb ?? host.runtime?.ram_gb ?? host.machine?.ram_gb,
  );
  return {
    maximum_projects: maxProjects,
    recommended_cpu: 8,
    recommended_ram_gb: Math.floor(3 + maxProjects / 2) + 1,
    actual_cpu: Number.isFinite(actualCpu) ? actualCpu : null,
    actual_ram_gb: Number.isFinite(actualRamGiB) ? actualRamGiB : null,
  };
}

function result({
  host,
  state,
  token,
}: {
  host: any;
  state: HostExamState;
  token?: string;
}) {
  return {
    host_id: host.id,
    host_name: host.name ?? null,
    student_url: state.config?.hostname
      ? `https://${state.config.hostname}`
      : null,
    documentation: "/app-docs/hosts/exam-scratchpads",
    capacity_guidance: hostCapacity(host, state),
    ...(token ? { token } : undefined),
    ...state,
  };
}

async function getState(ctx: any, host_id: string): Promise<HostExamState> {
  return await ctx.hub.hosts.getHostExamState({
    id: host_id,
    timeout: STATUS_TIMEOUT_MS,
  });
}

async function waitForStableState({
  ctx,
  host_id,
  timeoutMs,
  pollMs = DEFAULT_POLL_MS,
}: {
  ctx: any;
  host_id: string;
  timeoutMs: number;
  pollMs?: number;
}): Promise<HostExamState> {
  const deadline = Date.now() + timeoutMs;
  let state = await getState(ctx, host_id);
  while (
    state.run?.status != null &&
    TRANSIENT_STATUSES.has(state.run.status) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    state = await getState(ctx, host_id);
  }
  if (state.run?.status != null && TRANSIENT_STATUSES.has(state.run.status)) {
    throw new Error(
      `timed out waiting for exam run ${state.run.run_id} (status=${state.run.status})`,
    );
  }
  return state;
}

function mutationAuth(opts: ExamCommandOptions) {
  const id = browserId(opts);
  return id ? { browser_id: id } : {};
}

export function registerHostExamCommands({
  hostCommand,
  deps,
}: {
  hostCommand: Command;
  deps: HostExamCommandDeps;
}): Command {
  const { withContext, resolveHost } = deps;
  const exam = hostCommand
    .command("exam")
    .description("manage ephemeral exam projects on a private project host");

  exam
    .command("status <host>")
    .description("show exam configuration, current run, and host readiness")
    .option("--wait", "wait for preparation or cleanup to finish")
    .option(
      "--wait-timeout <duration>",
      "maximum wait when --wait is set (e.g. 30s, 12m)",
      "12m",
    )
    .action(
      async (
        hostIdentifier: string,
        opts: { wait?: boolean; waitTimeout?: string },
        command: Command,
      ) => {
        await withContext(command, "host exam status", async (ctx) => {
          const host = await resolveHost(ctx, hostIdentifier);
          const state = opts.wait
            ? await waitForStableState({
                ctx,
                host_id: host.id,
                timeoutMs: operationTimeout(opts, LIFECYCLE_TIMEOUT_MS),
              })
            : await getState(ctx, host.id);
          return result({ host, state });
        });
      },
    );

  exam
    .command("configure <host>")
    .description("create or update the host exam configuration")
    .option("--enable", "enable exam mode")
    .option("--disable", "disable exam mode")
    .option("--max-projects <count>", "maximum simultaneous student projects")
    .option("--project-cpu <cores>", "CPU limit for each student project")
    .option("--project-memory-mb <mb>", "memory limit for each student project")
    .option("--project-disk-mb <mb>", "disk limit for each student project")
    .option("--maximum-run-minutes <minutes>", "maximum exam run duration")
    .option("--cleanup-grace-minutes <minutes>", "cleanup grace period")
    .option("--allow-terminal", "allow terminals in student projects")
    .option("--deny-terminal", "disable terminals in student projects")
    .option("--browser-id <id>", "browser session id for fresh-auth checks")
    .option("--wait-timeout <duration>", "RPC timeout (e.g. 30s, 2m)", "2m")
    .action(
      async (
        hostIdentifier: string,
        opts: ExamCommandOptions & {
          enable?: boolean;
          disable?: boolean;
          maxProjects?: string;
          projectCpu?: string;
          projectMemoryMb?: string;
          projectDiskMb?: string;
          maximumRunMinutes?: string;
          cleanupGraceMinutes?: string;
          allowTerminal?: boolean;
          denyTerminal?: boolean;
        },
        command: Command,
      ) => {
        await withContext(command, "host exam configure", async (ctx) => {
          ensureBooleanChoice({
            positive: opts.enable,
            negative: opts.disable,
            positiveFlag: "--enable",
            negativeFlag: "--disable",
          });
          ensureBooleanChoice({
            positive: opts.allowTerminal,
            negative: opts.denyTerminal,
            positiveFlag: "--allow-terminal",
            negativeFlag: "--deny-terminal",
          });
          const host = await resolveHost(ctx, hostIdentifier);
          const previous = await getState(ctx, host.id);
          const current = previous.config ?? DEFAULT_CONFIG;
          const config: HostExamConfigInput = {
            enabled: opts.enable
              ? true
              : opts.disable
                ? false
                : current.enabled,
            max_projects: parseNumber(
              opts.maxProjects,
              current.max_projects,
              "--max-projects",
              { integer: true },
            ),
            project_cpu: parseNumber(
              opts.projectCpu,
              current.project_cpu,
              "--project-cpu",
            ),
            project_memory_mb: parseNumber(
              opts.projectMemoryMb,
              current.project_memory_mb,
              "--project-memory-mb",
              { integer: true },
            ),
            project_disk_mb: parseNumber(
              opts.projectDiskMb,
              current.project_disk_mb,
              "--project-disk-mb",
              { integer: true },
            ),
            project_ttl_minutes: parseNumber(
              opts.maximumRunMinutes,
              current.project_ttl_minutes,
              "--maximum-run-minutes",
              { integer: true },
            ),
            cleanup_grace_minutes: parseNumber(
              opts.cleanupGraceMinutes,
              current.cleanup_grace_minutes,
              "--cleanup-grace-minutes",
              { integer: true },
            ),
            terminal_enabled: opts.allowTerminal
              ? true
              : opts.denyTerminal
                ? false
                : current.terminal_enabled,
            network_mode: "disabled",
          };
          const state = await ctx.hub.hosts.setHostExamConfig({
            id: host.id,
            config,
            ...mutationAuth(opts),
            timeout: operationTimeout(opts, MUTATION_TIMEOUT_MS),
          });
          return result({ host, state });
        });
      },
    );

  exam
    .command("prepare <host>")
    .description("prepare and smoke-test a new exam run")
    .requiredOption("--rootfs <image>", "cached RootFS image")
    .requiredOption(
      "--delete-at <timestamp>",
      "when all exam projects must be deleted (ISO timestamp)",
    )
    .option("--stop-host", "shut down the project host after cleanup")
    .option("--keep-host-running", "leave the project host running afterward")
    .option("--idempotency-key <key>", "reuse a previous logical request key")
    .option("--browser-id <id>", "browser session id for fresh-auth checks")
    .option("--wait-timeout <duration>", "RPC and readiness timeout", "12m")
    .action(
      async (
        hostIdentifier: string,
        opts: ExamCommandOptions & {
          rootfs: string;
          deleteAt: string;
          stopHost?: boolean;
          keepHostRunning?: boolean;
        },
        command: Command,
      ) => {
        await withContext(command, "host exam prepare", async (ctx) => {
          ensureBooleanChoice({
            positive: opts.stopHost,
            negative: opts.keepHostRunning,
            positiveFlag: "--stop-host",
            negativeFlag: "--keep-host-running",
          });
          const host = await resolveHost(ctx, hostIdentifier);
          const before = await getState(ctx, host.id);
          if (before.run && before.run.status !== "stopped") {
            throw new Error(
              `exam run ${before.run.run_id} is already active (status=${before.run.status})`,
            );
          }
          const timeout = operationTimeout(opts, LIFECYCLE_TIMEOUT_MS);
          const prepared = await ctx.hub.hosts.createHostExamRun({
            id: host.id,
            rootfs_image: opts.rootfs,
            scheduled_stop_at: parseDeleteAt(opts.deleteAt),
            stop_host_at_deadline: !opts.keepHostRunning,
            idempotency_key: operationKey("exam-prepare", opts.idempotencyKey),
            ...mutationAuth(opts),
            timeout,
          });
          const token = prepared.token;
          let state: HostExamState = prepared;
          if (
            state.run?.status != null &&
            TRANSIENT_STATUSES.has(state.run.status)
          ) {
            state = await waitForStableState({
              ctx,
              host_id: host.id,
              timeoutMs: timeout,
            });
          }
          return result({ host, state, token });
        });
      },
    );

  exam
    .command("open <host>")
    .description("open admission for the prepared exam run")
    .option("--run <run_id>", "exam run id; defaults to the active run")
    .option("--idempotency-key <key>", "reuse a previous logical request key")
    .option("--browser-id <id>", "browser session id for fresh-auth checks")
    .option("--wait-timeout <duration>", "RPC timeout", "2m")
    .action(
      async (
        hostIdentifier: string,
        opts: ExamCommandOptions & { run?: string },
        command: Command,
      ) => {
        await withContext(command, "host exam open", async (ctx) => {
          const host = await resolveHost(ctx, hostIdentifier);
          const current = await getState(ctx, host.id);
          const run_id =
            `${opts.run ?? ""}`.trim() || activeRun(current).run_id;
          const state = await ctx.hub.hosts.openHostExamRun({
            id: host.id,
            run_id,
            idempotency_key: operationKey("exam-open", opts.idempotencyKey),
            ...mutationAuth(opts),
            timeout: operationTimeout(opts, MUTATION_TIMEOUT_MS),
          });
          return result({ host, state });
        });
      },
    );

  exam
    .command("rotate-token <host>")
    .description("rotate and display the exam admission token")
    .option("--run <run_id>", "exam run id; defaults to the active run")
    .option("--idempotency-key <key>", "reuse a previous logical request key")
    .option("--browser-id <id>", "browser session id for fresh-auth checks")
    .option("--wait-timeout <duration>", "RPC timeout", "2m")
    .action(
      async (
        hostIdentifier: string,
        opts: ExamCommandOptions & { run?: string },
        command: Command,
      ) => {
        await withContext(command, "host exam rotate-token", async (ctx) => {
          const host = await resolveHost(ctx, hostIdentifier);
          const current = await getState(ctx, host.id);
          const run_id =
            `${opts.run ?? ""}`.trim() || activeRun(current).run_id;
          const state = await ctx.hub.hosts.rotateHostExamToken({
            id: host.id,
            run_id,
            idempotency_key: operationKey("exam-token", opts.idempotencyKey),
            ...mutationAuth(opts),
            timeout: operationTimeout(opts, MUTATION_TIMEOUT_MS),
          });
          return result({ host, state, token: state.token });
        });
      },
    );

  exam
    .command("deadline <host>")
    .description("change project deletion time and post-cleanup host policy")
    .requiredOption("--delete-at <timestamp>", "new ISO project deletion time")
    .option("--run <run_id>", "exam run id; defaults to the active run")
    .option("--stop-host", "shut down the project host after cleanup")
    .option("--keep-host-running", "leave the project host running afterward")
    .option("--idempotency-key <key>", "reuse a previous logical request key")
    .option("--browser-id <id>", "browser session id for fresh-auth checks")
    .option("--wait-timeout <duration>", "RPC timeout", "2m")
    .action(
      async (
        hostIdentifier: string,
        opts: ExamCommandOptions & {
          run?: string;
          deleteAt: string;
          stopHost?: boolean;
          keepHostRunning?: boolean;
        },
        command: Command,
      ) => {
        await withContext(command, "host exam deadline", async (ctx) => {
          ensureBooleanChoice({
            positive: opts.stopHost,
            negative: opts.keepHostRunning,
            positiveFlag: "--stop-host",
            negativeFlag: "--keep-host-running",
          });
          const host = await resolveHost(ctx, hostIdentifier);
          const current = await getState(ctx, host.id);
          const run = activeRun(current);
          const state = await ctx.hub.hosts.updateHostExamDeadline({
            id: host.id,
            run_id: `${opts.run ?? ""}`.trim() || run.run_id,
            scheduled_stop_at: parseDeleteAt(opts.deleteAt),
            stop_host_at_deadline: opts.stopHost
              ? true
              : opts.keepHostRunning
                ? false
                : run.stop_host_at_deadline,
            idempotency_key: operationKey("exam-deadline", opts.idempotencyKey),
            ...mutationAuth(opts),
            timeout: operationTimeout(opts, MUTATION_TIMEOUT_MS),
          });
          return result({ host, state });
        });
      },
    );

  exam
    .command("end <host>")
    .description("close admission and permanently erase all exam projects")
    .option("--run <run_id>", "exam run id; defaults to the active run")
    .option("--stop-host", "shut down the project host after cleanup")
    .option("--keep-host-running", "leave the project host running afterward")
    .option("--idempotency-key <key>", "reuse a previous logical request key")
    .option("--browser-id <id>", "browser session id for fresh-auth checks")
    .option("--wait-timeout <duration>", "cleanup timeout", "12m")
    .option("--yes", "confirm permanent deletion of all exam projects")
    .action(
      async (
        hostIdentifier: string,
        opts: ExamCommandOptions & {
          run?: string;
          stopHost?: boolean;
          keepHostRunning?: boolean;
          yes?: boolean;
        },
        command: Command,
      ) => {
        await withContext(command, "host exam end", async (ctx) => {
          if (!opts.yes) {
            throw new Error(
              "refusing to erase exam projects without --yes confirmation",
            );
          }
          ensureBooleanChoice({
            positive: opts.stopHost,
            negative: opts.keepHostRunning,
            positiveFlag: "--stop-host",
            negativeFlag: "--keep-host-running",
          });
          const host = await resolveHost(ctx, hostIdentifier);
          const current = await getState(ctx, host.id);
          const run = activeRun(current);
          const timeout = operationTimeout(opts, LIFECYCLE_TIMEOUT_MS);
          let state = await ctx.hub.hosts.stopAndEraseHostExamRun({
            id: host.id,
            run_id: `${opts.run ?? ""}`.trim() || run.run_id,
            stop_host: opts.stopHost
              ? true
              : opts.keepHostRunning
                ? false
                : run.stop_host_at_deadline,
            idempotency_key: operationKey("exam-end", opts.idempotencyKey),
            ...mutationAuth(opts),
            timeout,
          });
          if (
            state.run?.status != null &&
            TRANSIENT_STATUSES.has(state.run.status)
          ) {
            state = await waitForStableState({
              ctx,
              host_id: host.id,
              timeoutMs: timeout,
            });
          }
          return result({ host, state });
        });
      },
    );

  return exam;
}

export const __test__ = {
  parseDeleteAt,
  operationKey,
  waitForStableState,
};
