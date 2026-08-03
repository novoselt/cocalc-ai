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

export const __test__ = {
  COMMAND_TIMEOUT_MS,
  STORAGE_WRAPPER,
};
