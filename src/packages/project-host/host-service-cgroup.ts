/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { spawnSync } from "node:child_process";
import getLogger from "@cocalc/backend/logger";

const logger = getLogger("project-host:host-service-cgroup");
const STORAGE_WRAPPER = "/usr/local/sbin/cocalc-runtime-storage";
const COMMAND_TIMEOUT_MS = 5_000;

type SpawnResult = {
  status: number | null;
  stdout?: Buffer | string | null;
  stderr?: Buffer | string | null;
  error?: Error;
};

type SpawnSyncLike = (
  command: string,
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
    stdio: "pipe";
  },
) => SpawnResult;

export function attachCurrentProcessToHostServiceCgroup({
  pid = process.pid,
  spawn = spawnSync as SpawnSyncLike,
}: {
  pid?: number;
  spawn?: SpawnSyncLike;
} = {}): boolean {
  const result = spawn(
    "sudo",
    ["-n", STORAGE_WRAPPER, "attach-host-service-cgroup", String(pid)],
    {
      encoding: "utf8",
      timeout: COMMAND_TIMEOUT_MS,
      stdio: "pipe",
    },
  );
  if (result.status === 0) return true;
  logger.error("unable to attach project-host service process to cgroup", {
    pid,
    exitCode: result.status,
    error: result.error?.message,
    stderr: `${result.stderr ?? ""}`.trim(),
    stdout: `${result.stdout ?? ""}`.trim(),
  });
  return false;
}

function runBackupBrowserCgroupCommand({
  command,
  pid,
  spawn,
  logFailure,
}: {
  command: "attach-backup-browser-cgroup" | "remove-backup-browser-cgroup";
  pid: number;
  spawn: SpawnSyncLike;
  logFailure: boolean;
}): boolean {
  const result = spawn("sudo", ["-n", STORAGE_WRAPPER, command, String(pid)], {
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    stdio: "pipe",
  });
  if (result.status === 0) return true;
  const details = {
    command,
    pid,
    exitCode: result.status,
    error: result.error?.message,
    stderr: `${result.stderr ?? ""}`.trim(),
    stdout: `${result.stdout ?? ""}`.trim(),
  };
  if (logFailure) {
    logger.error("backup browser cgroup command failed", details);
  } else {
    logger.debug("backup browser cgroup cleanup failed", details);
  }
  return false;
}

export function attachBackupBrowserProcessToCgroup({
  pid,
  spawn = spawnSync as SpawnSyncLike,
}: {
  pid: number;
  spawn?: SpawnSyncLike;
}): boolean {
  return runBackupBrowserCgroupCommand({
    command: "attach-backup-browser-cgroup",
    pid,
    spawn,
    logFailure: true,
  });
}

export function removeBackupBrowserProcessCgroup({
  pid,
  spawn = spawnSync as SpawnSyncLike,
}: {
  pid: number;
  spawn?: SpawnSyncLike;
}): boolean {
  return runBackupBrowserCgroupCommand({
    command: "remove-backup-browser-cgroup",
    pid,
    spawn,
    logFailure: false,
  });
}

export const __test__ = {
  COMMAND_TIMEOUT_MS,
  STORAGE_WRAPPER,
};
