/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, opendir, readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

import type {
  HostAbuseFilesystemSnapshotRequest,
  HostAbuseFilesystemSnapshotResponse,
} from "@cocalc/conat/project-host/api";

const DEFAULT_PROJECT_POOL = "/sys/fs/cgroup/cocalc-project-pool";
const DEFAULT_STORAGE_MOUNT = "/mnt/cocalc";
const DEFAULT_MAX_PROJECTS = 2_000;
const MAX_PROJECTS = 5_000;
const DEFAULT_MAX_ENTRIES_PER_PROJECT = 2_000;
const MAX_ENTRIES_PER_PROJECT = 10_000;
const DEFAULT_MAX_TOTAL_ENTRIES = 50_000;
const MAX_TOTAL_ENTRIES = 250_000;
const DEFAULT_MAX_DEPTH = 4;
const MAX_DEPTH = 8;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_ISSUES = 100;
const PROJECT_CGROUP_PATTERN =
  /^project-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const EXCLUDED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".local",
  ".npm",
  ".restore-staging",
  ".snapshots",
  ".ssh",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
]);

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function errorCode(err: unknown): string {
  const code = `${(err as NodeJS.ErrnoException | undefined)?.code ?? ""}`;
  return /^[A-Z0-9_]{1,32}$/u.test(code) ? code : "READ_FAILED";
}

function entryType(stat: Awaited<ReturnType<typeof lstat>>): string {
  if (stat.isDirectory()) return "d";
  if (stat.isFile()) return "f";
  if (stat.isSymbolicLink()) return "l";
  return "o";
}

function excludedFile(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === ".manager-status.json" ||
    normalized.endsWith(".log") ||
    normalized.endsWith(".pid")
  );
}

async function cgroupHasProcesses(path: string): Promise<boolean> {
  try {
    return (
      Number.parseInt(await readFile(join(path, "pids.current"), "utf8"), 10) >
      0
    );
  } catch (err) {
    if (errorCode(err) === "ENOENT") return false;
    throw err;
  }
}

async function readBoundedDirectory(path: string, limit: number) {
  const children: Dirent[] = [];
  const directory = await opendir(path);
  for await (const child of directory) {
    if (children.length >= limit) {
      return { children, truncated: true };
    }
    children.push(child);
  }
  return { children, truncated: false };
}

export async function collectAbuseFilesystemSnapshot({
  max_projects,
  max_entries_per_project,
  max_total_entries,
  max_depth,
  timeout_ms,
  projectPool = DEFAULT_PROJECT_POOL,
  storageMount = `${process.env.COCALC_FILE_SERVER_MOUNTPOINT ?? ""}`.trim() ||
    DEFAULT_STORAGE_MOUNT,
  now = Date.now,
}: HostAbuseFilesystemSnapshotRequest & {
  projectPool?: string;
  storageMount?: string;
  now?: () => number;
} = {}): Promise<HostAbuseFilesystemSnapshotResponse> {
  const maxProjects = normalizeLimit(
    max_projects,
    DEFAULT_MAX_PROJECTS,
    MAX_PROJECTS,
  );
  const maxEntriesPerProject = normalizeLimit(
    max_entries_per_project,
    DEFAULT_MAX_ENTRIES_PER_PROJECT,
    MAX_ENTRIES_PER_PROJECT,
  );
  const maxTotalEntries = normalizeLimit(
    max_total_entries,
    DEFAULT_MAX_TOTAL_ENTRIES,
    MAX_TOTAL_ENTRIES,
  );
  const maxDepth = normalizeLimit(max_depth, DEFAULT_MAX_DEPTH, MAX_DEPTH);
  const timeoutMs = normalizeLimit(
    timeout_ms,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const issues: HostAbuseFilesystemSnapshotResponse["issues"] = [];
  let projectLimitReached = false;
  let totalEntryLimitReached = false;
  let deadlineReached = false;
  let issueLimitReached = false;
  let totalEntryCount = 0;
  let missingProjectCount = 0;
  let skippedLargeProjectCount = 0;
  let scannedProjectCount = 0;

  const recordIssue = (
    scope: "project_pool" | "project",
    code: string,
    project_id?: string,
  ) => {
    if (issues.length >= MAX_ISSUES) {
      issueLimitReached = true;
      return;
    }
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
      fingerprint_version: "tree-metadata-v1",
      captured_at: new Date(startedAt).toISOString(),
      duration_ms: Math.max(0, now() - startedAt),
      coverage: "unavailable",
      project_count: 0,
      fingerprint_count: 0,
      total_entry_count: 0,
      missing_project_count: 0,
      skipped_large_project_count: 0,
      projects: [],
      issues,
      truncated: {
        projects: false,
        total_entries: false,
        deadline: false,
        issues: false,
      },
    };
  }

  const projects: HostAbuseFilesystemSnapshotResponse["projects"] = [];
  for (const entry of entries) {
    if (now() >= deadline) {
      deadlineReached = true;
      break;
    }
    if (totalEntryCount >= maxTotalEntries) {
      totalEntryLimitReached = true;
      break;
    }
    const project_id = PROJECT_CGROUP_PATTERN.exec(entry.name)?.[1];
    if (!project_id) continue;
    try {
      if (!(await cgroupHasProcesses(join(projectPool, entry.name)))) continue;
    } catch (err) {
      recordIssue("project_pool", errorCode(err));
      continue;
    }
    if (scannedProjectCount >= maxProjects) {
      projectLimitReached = true;
      break;
    }
    scannedProjectCount += 1;
    const root = join(storageMount, `project-${project_id}`);
    const structure = createHash("sha256");
    const metadata = createHash("sha256");
    const queue: Array<{ path: string; relative: string; depth: number }> = [
      { path: root, relative: "", depth: 0 },
    ];
    let entryCount = 0;
    let examinedCount = 0;
    let fileCount = 0;
    let directoryCount = 0;
    let symlinkCount = 0;
    let otherCount = 0;
    let excludedCount = 0;
    let complete = true;
    let missing = false;

    while (queue.length > 0) {
      if (now() >= deadline) {
        deadlineReached = true;
        complete = false;
        break;
      }
      if (totalEntryCount >= maxTotalEntries) {
        totalEntryLimitReached = true;
        complete = false;
        break;
      }
      const current = queue.shift()!;
      let directoryRead;
      try {
        directoryRead = await readBoundedDirectory(
          current.path,
          Math.min(
            maxEntriesPerProject - examinedCount,
            maxTotalEntries - totalEntryCount,
          ),
        );
      } catch (err) {
        const code = errorCode(err);
        if (current.depth === 0 && code === "ENOENT") {
          missingProjectCount += 1;
          missing = true;
        } else {
          recordIssue("project", code, project_id);
        }
        complete = false;
        break;
      }
      const children = directoryRead.children.sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      for (const child of children) {
        if (now() >= deadline) {
          deadlineReached = true;
          complete = false;
          break;
        }
        examinedCount += 1;
        totalEntryCount += 1;
        if (child.name.startsWith(".") || excludedFile(child.name)) {
          excludedCount += 1;
          continue;
        }
        const relative = current.relative
          ? posix.join(current.relative, child.name)
          : child.name;
        const path = join(current.path, child.name);
        let stat;
        try {
          stat = await lstat(path);
        } catch (err) {
          const code = errorCode(err);
          if (code !== "ENOENT") recordIssue("project", code, project_id);
          complete = false;
          continue;
        }
        const type = entryType(stat);
        entryCount += 1;
        structure.update(`${type}\0${relative}\0`);
        metadata.update(`${type}\0${relative}\0${stat.size}\0`);
        if (type === "f") fileCount += 1;
        else if (type === "d") directoryCount += 1;
        else if (type === "l") symlinkCount += 1;
        else otherCount += 1;

        if (type !== "d") continue;
        if (EXCLUDED_DIRECTORIES.has(child.name)) {
          excludedCount += 1;
          continue;
        }
        if (current.depth + 1 < maxDepth) {
          queue.push({
            path,
            relative,
            depth: current.depth + 1,
          });
        }
      }
      if (!complete) break;
      if (directoryRead.truncated) {
        complete = false;
        if (examinedCount >= maxEntriesPerProject) {
          skippedLargeProjectCount += 1;
        }
        if (totalEntryCount >= maxTotalEntries) {
          totalEntryLimitReached = true;
        }
        break;
      }
    }

    if (!missing) {
      projects.push({
        project_id,
        structure_sha256: structure.digest("hex"),
        metadata_sha256: metadata.digest("hex"),
        examined_count: examinedCount,
        entry_count: entryCount,
        file_count: fileCount,
        directory_count: directoryCount,
        symlink_count: symlinkCount,
        other_count: otherCount,
        excluded_count: excludedCount,
        complete,
      });
    }
    if (deadlineReached || totalEntryLimitReached) break;
  }

  const partial =
    projectLimitReached ||
    totalEntryLimitReached ||
    deadlineReached ||
    issues.length > 0;
  return {
    version: 1,
    fingerprint_version: "tree-metadata-v1",
    captured_at: new Date(startedAt).toISOString(),
    duration_ms: Math.max(0, now() - startedAt),
    coverage: partial ? "partial" : "complete",
    project_count: scannedProjectCount,
    fingerprint_count: projects.filter(({ complete }) => complete).length,
    total_entry_count: totalEntryCount,
    missing_project_count: missingProjectCount,
    skipped_large_project_count: skippedLargeProjectCount,
    projects,
    issues,
    truncated: {
      projects: projectLimitReached,
      total_entries: totalEntryLimitReached,
      deadline: deadlineReached,
      issues: issueLimitReached,
    },
  };
}
