/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  HostAbuseProcessSnapshotRequest,
  HostAbuseProcessSnapshotResponse,
} from "@cocalc/conat/project-host/api";

const DEFAULT_PROJECT_POOL = "/sys/fs/cgroup/cocalc-project-pool";
const DEFAULT_PROC_ROOT = "/proc";
const DEFAULT_MAX_PROJECTS = 2_000;
const MAX_PROJECTS = 5_000;
const DEFAULT_MAX_PROCESSES = 10_000;
const MAX_PROCESSES = 50_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_ISSUES = 100;
const PROJECT_CGROUP_PATTERN =
  /^project-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function sanitizeProcessName(raw: string): string {
  const value = raw
    .trim()
    .replace(/[\x00-\x1f\x7f-\x9f]/gu, "?")
    .slice(0, 64);
  return value || "[unknown]";
}

function errorCode(err: unknown): string {
  const code = `${(err as NodeJS.ErrnoException | undefined)?.code ?? ""}`;
  return /^[A-Z0-9_]{1,32}$/u.test(code) ? code : "READ_FAILED";
}

export async function collectAbuseProcessSnapshot({
  max_projects,
  max_processes,
  timeout_ms,
  projectPool = DEFAULT_PROJECT_POOL,
  procRoot = DEFAULT_PROC_ROOT,
  now = Date.now,
}: HostAbuseProcessSnapshotRequest & {
  projectPool?: string;
  procRoot?: string;
  now?: () => number;
} = {}): Promise<HostAbuseProcessSnapshotResponse> {
  const maxProjects = normalizeLimit(
    max_projects,
    DEFAULT_MAX_PROJECTS,
    MAX_PROJECTS,
  );
  const maxProcesses = normalizeLimit(
    max_processes,
    DEFAULT_MAX_PROCESSES,
    MAX_PROCESSES,
  );
  const timeoutMs = normalizeLimit(
    timeout_ms,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const issues: HostAbuseProcessSnapshotResponse["issues"] = [];
  let projectLimitReached = false;
  let processLimitReached = false;
  let deadlineReached = false;
  let processCount = 0;
  let vanishedProcessCount = 0;
  let cgroupCount = 0;
  let scannedProjectCount = 0;

  const recordIssue = (
    scope: "project_pool" | "project" | "cgroup",
    code: string,
    project_id?: string,
  ) => {
    if (issues.length >= MAX_ISSUES) return;
    issues.push({ scope, code, project_id });
  };

  let entries;
  try {
    entries = (await readdir(projectPool, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isDirectory() && PROJECT_CGROUP_PATTERN.test(entry.name),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    recordIssue("project_pool", errorCode(err));
    return {
      version: 1,
      captured_at: new Date(startedAt).toISOString(),
      duration_ms: Math.max(0, now() - startedAt),
      coverage: "unavailable",
      project_count: 0,
      active_project_count: 0,
      cgroup_count: 0,
      process_count: 0,
      vanished_process_count: 0,
      projects: [],
      issues,
      truncated: {
        projects: false,
        processes: false,
        deadline: false,
        issues: false,
      },
    };
  }

  if (entries.length > maxProjects) {
    entries = entries.slice(0, maxProjects);
    projectLimitReached = true;
  }

  const projects: HostAbuseProcessSnapshotResponse["projects"] = [];
  for (const entry of entries) {
    if (now() >= deadline) {
      deadlineReached = true;
      break;
    }
    const project_id = PROJECT_CGROUP_PATTERN.exec(entry.name)?.[1];
    if (!project_id) continue;
    scannedProjectCount += 1;
    const processNames = new Map<string, number>();
    const cgroupQueue = [join(projectPool, entry.name)];
    let projectProcessCount = 0;

    while (cgroupQueue.length > 0) {
      if (now() >= deadline) {
        deadlineReached = true;
        break;
      }
      const cgroup = cgroupQueue.shift()!;
      cgroupCount += 1;
      let pids: string[] = [];
      try {
        pids = (await readFile(join(cgroup, "cgroup.procs"), "utf8"))
          .split(/\s+/u)
          .filter((pid) => /^\d+$/u.test(pid));
      } catch (err) {
        recordIssue("cgroup", errorCode(err), project_id);
      }
      for (const pid of pids) {
        if (processCount >= maxProcesses) {
          processLimitReached = true;
          break;
        }
        if (now() >= deadline) {
          deadlineReached = true;
          break;
        }
        try {
          const name = sanitizeProcessName(
            await readFile(join(procRoot, pid, "comm"), "utf8"),
          );
          processNames.set(name, (processNames.get(name) ?? 0) + 1);
          processCount += 1;
          projectProcessCount += 1;
        } catch (err) {
          if (errorCode(err) === "ENOENT") {
            vanishedProcessCount += 1;
          } else {
            recordIssue("project", errorCode(err), project_id);
          }
        }
      }
      if (processLimitReached || deadlineReached) break;
      try {
        const children = await readdir(cgroup, { withFileTypes: true });
        for (const child of children) {
          if (child.isDirectory()) cgroupQueue.push(join(cgroup, child.name));
        }
      } catch (err) {
        recordIssue("cgroup", errorCode(err), project_id);
      }
    }
    if (projectProcessCount > 0) {
      projects.push({
        project_id,
        process_count: projectProcessCount,
        processes: [...processNames.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      });
    }
    if (processLimitReached || deadlineReached) break;
  }

  const partial =
    projectLimitReached ||
    processLimitReached ||
    deadlineReached ||
    issues.length > 0;
  return {
    version: 1,
    captured_at: new Date(startedAt).toISOString(),
    duration_ms: Math.max(0, now() - startedAt),
    coverage: partial ? "partial" : "complete",
    project_count: scannedProjectCount,
    active_project_count: projects.length,
    cgroup_count: cgroupCount,
    process_count: processCount,
    vanished_process_count: vanishedProcessCount,
    projects,
    issues,
    truncated: {
      projects: projectLimitReached,
      processes: processLimitReached,
      deadline: deadlineReached,
      issues: issues.length >= MAX_ISSUES,
    },
  };
}
