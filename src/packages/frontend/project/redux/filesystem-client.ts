/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { type FilesystemClient } from "@cocalc/conat/files/fs";
import { sleep } from "@cocalc/util/async-utils";

const FILE_SERVER_STARTING_RETRY_DELAYS_MS = [
  100, 250, 500, 1_000, 2_000,
] as const;

export function isFilesystemServerStartingError(err: unknown): boolean {
  return `${err}`.toLowerCase().includes("file server not initialized");
}

export function isRecoverableFilesystemClientError(err: unknown): boolean {
  const message = `${err}`.toLowerCase();
  return (
    (message.includes("once: timeout") &&
      (message.includes('waiting for "info"') ||
        message.includes("waiting for 'info'") ||
        message.includes("waiting for info"))) ||
    message.includes("closed") ||
    message.includes("disconnected") ||
    message.includes("connection closed") ||
    message.includes("socket has been disconnected") ||
    message.includes("not connected") ||
    message.includes("failed to fetch") ||
    isFilesystemServerStartingError(err) ||
    message.includes("unable to route") ||
    message.includes("project-host") ||
    message.includes("project host")
  );
}

export async function callFilesystemClientWithRecovery({
  getClient,
  clearClient,
  prop,
  args,
  wait = sleep,
}: {
  getClient: (forceRefresh?: boolean) => Promise<FilesystemClient>;
  clearClient: () => void;
  prop: PropertyKey;
  args: any[];
  wait?: (ms: number) => Promise<void>;
}) {
  let forceRefresh = false;
  let genericRecoveryUsed = false;
  let startupRetry = 0;
  while (true) {
    try {
      const fs = await getClient(forceRefresh);
      const value = (fs as any)[prop];
      if (typeof value !== "function") {
        return value;
      }
      return await value.apply(fs, args);
    } catch (err) {
      if (
        isFilesystemServerStartingError(err) &&
        startupRetry < FILE_SERVER_STARTING_RETRY_DELAYS_MS.length
      ) {
        const delay = FILE_SERVER_STARTING_RETRY_DELAYS_MS[startupRetry++];
        forceRefresh = true;
        clearClient();
        await wait(delay);
        continue;
      }
      if (!genericRecoveryUsed && isRecoverableFilesystemClientError(err)) {
        genericRecoveryUsed = true;
        forceRefresh = true;
        clearClient();
        continue;
      }
      throw err;
    }
  }
}
