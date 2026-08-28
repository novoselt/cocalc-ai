/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE } from "@cocalc/conat/files/file-server";
import { releaseProjectDataArchiveFreezeOnHost } from "@cocalc/server/project-host/control";

const logger = getLogger("server:projects:backup-freeze-recovery");

type FrozenBackupResult = {
  id?: unknown;
  generation?: unknown;
};

type ReleaseArchiveFreeze = typeof releaseProjectDataArchiveFreezeOnHost;

export type ArchiveBackupFreezeFailure =
  | "not-started"
  | "released"
  | "uncertain";

const ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY = "archive_freeze_recovery";

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
}: {
  enabled: boolean;
  op_id: string;
  project_id: string;
  host_id: string;
  releaseArchiveFreeze?: ReleaseArchiveFreeze;
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
        () => {
          // Host-side backup failure releases the freeze in its failure path.
        },
      );
    },
  };
}
