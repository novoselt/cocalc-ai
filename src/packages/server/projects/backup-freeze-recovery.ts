/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE } from "@cocalc/conat/files/file-server";
import { mergeLroResult } from "@cocalc/server/lro/lro-db";
import { releaseProjectDataArchiveFreezeOnHost } from "@cocalc/server/project-host/control";

const logger = getLogger("server:projects:backup-freeze-recovery");

type FrozenBackupResult = {
  id?: unknown;
  generation?: unknown;
};

type ReleaseArchiveFreeze = typeof releaseProjectDataArchiveFreezeOnHost;
type AttestArchiveFreezeReleased = (op_id: string) => Promise<void>;

export type ArchiveBackupFreezeFailure =
  | "not-started"
  | "released"
  | "uncertain";

const ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY = "archive_freeze_recovery";

async function attestArchiveFreezeReleased(op_id: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const updated = await mergeLroResult({
        op_id,
        result: { [ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY]: "released" },
        if_status: ["succeeded", "failed", "canceled", "expired"],
      });
      if (updated) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (lastError) throw lastError;
  throw new Error("backup LRO did not become terminal after releasing freeze");
}

export function classifyArchiveBackupFreezeFailure({
  enabled,
  hostOperationStarted,
  error,
}: {
  enabled: boolean;
  hostOperationStarted: boolean;
  error: unknown;
}): ArchiveBackupFreezeFailure | undefined {
  if (!enabled) return;
  if (!hostOperationStarted) return "not-started";
  if (
    `${(error as { code?: unknown })?.code ?? ""}` ===
    ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE
  ) {
    return "released";
  }
  return "uncertain";
}

export function archiveBackupFreezeFailureResult(
  opts: Parameters<typeof classifyArchiveBackupFreezeFailure>[0],
): Record<string, ArchiveBackupFreezeFailure> | undefined {
  const status = classifyArchiveBackupFreezeFailure(opts);
  if (!status) return;
  return { [ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY]: status };
}

export function isArchiveBackupFailureReopenSafe(result: unknown): boolean {
  const status = (result as Record<string, unknown> | null)?.[
    ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY
  ];
  return status === "not-started" || status === "released";
}

export function createBackupFreezeRecovery({
  enabled,
  op_id,
  project_id,
  host_id,
  releaseArchiveFreeze = releaseProjectDataArchiveFreezeOnHost,
  attestReleased = attestArchiveFreezeReleased,
}: {
  enabled: boolean;
  op_id: string;
  project_id: string;
  host_id: string;
  releaseArchiveFreeze?: ReleaseArchiveFreeze;
  attestReleased?: AttestArchiveFreezeReleased;
}) {
  let handedOff = false;
  let cleanupStarted = false;

  const release = async (
    backup: FrozenBackupResult,
    reason: string,
  ): Promise<void> => {
    if (!enabled || handedOff || cleanupStarted) return;
    cleanupStarted = true;
    const generation = Number(backup.generation);
    if (!Number.isSafeInteger(generation) || generation <= 0) {
      logger.error("late frozen backup has no valid generation", {
        op_id,
        project_id,
        host_id,
        reason,
      });
      return;
    }
    try {
      const result = await releaseArchiveFreeze({
        project_id,
        host_id,
        expected_generation: generation,
      });
      logger.warn("released unclaimed archive backup freeze", {
        op_id,
        project_id,
        host_id,
        backup_id: backup.id,
        generation,
        status: result.status,
        reason,
      });
      if (
        result.status === "released" ||
        result.status === "already-writable"
      ) {
        try {
          await attestReleased(op_id);
        } catch (err) {
          logger.error("unable to attest released archive backup freeze", {
            op_id,
            project_id,
            host_id,
            backup_id: backup.id,
            generation,
            status: result.status,
            reason,
            err: `${err}`,
          });
        }
      }
    } catch (err) {
      // The lifecycle project remains archiving and will retry the same
      // generation barrier; never reopen based on this best-effort cleanup.
      logger.error("unable to release unclaimed archive backup freeze", {
        op_id,
        project_id,
        host_id,
        backup_id: backup.id,
        generation,
        reason,
        err: `${err}`,
      });
    }
  };

  return {
    handoff(): void {
      handedOff = true;
    },
    release,
    watch(
      operation: Promise<FrozenBackupResult>,
      reason: string,
    ): Promise<void> | undefined {
      if (!enabled || handedOff) return;
      return operation.then(
        async (backup) => await release(backup, reason),
        async (err) => {
          if (
            classifyArchiveBackupFreezeFailure({
              enabled,
              hostOperationStarted: true,
              error: err,
            }) !== "released"
          ) {
            return;
          }
          if (handedOff || cleanupStarted) return;
          cleanupStarted = true;
          try {
            await attestReleased(op_id);
          } catch (attestErr) {
            logger.error("unable to attest failed host backup release", {
              op_id,
              project_id,
              host_id,
              reason,
              err: `${attestErr}`,
            });
          }
        },
      );
    },
  };
}
