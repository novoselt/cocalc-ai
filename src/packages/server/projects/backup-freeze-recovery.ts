/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { releaseProjectDataArchiveFreezeOnHost } from "@cocalc/server/project-host/control";

const logger = getLogger("server:projects:backup-freeze-recovery");

type FrozenBackupResult = {
  id?: unknown;
  generation?: unknown;
};

type ReleaseArchiveFreeze = typeof releaseProjectDataArchiveFreezeOnHost;

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
