/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE } from "@cocalc/conat/files/file-server";
import type { LroSummary } from "@cocalc/conat/hub/api/lro";
import { mergeLroResult } from "@cocalc/server/lro/lro-db";
import { releaseProjectDataArchiveFreezeOnHost } from "@cocalc/server/project-host/control";

const logger = getLogger("server:projects:backup-freeze-recovery");

type FrozenBackupResult = {
  id?: unknown;
  generation?: unknown;
};

type ReleaseArchiveFreeze = typeof releaseProjectDataArchiveFreezeOnHost;
type AttestArchiveFreezeReleased = (op_id: string) => Promise<void>;
type AttestArchiveFreezeNotStarted = (op_id: string) => Promise<void>;

export type ArchiveBackupFreezeFailure =
  | "not-started"
  | "released"
  | "uncertain";

const ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY = "archive_freeze_recovery";

export async function retireStaleFreezeBackupAttempts({
  client,
  kind,
  lease_ms,
}: {
  client: {
    query<Row extends Record<string, any> = any>(
      sql: string,
      values?: any[],
    ): Promise<{ rows: Row[] }>;
  };
  kind: string;
  lease_ms: number;
}): Promise<LroSummary[]> {
  const { rows } = await client.query<LroSummary>(
    `UPDATE long_running_operations
        SET status = 'failed',
            result = COALESCE(result, '{}'::jsonb)
                     || '{"archive_freeze_recovery":"uncertain"}'::jsonb,
            error = 'freeze-capable backup worker lease expired; prior attempt outcome is uncertain',
            finished_at = COALESCE(finished_at, NOW()),
            updated_at = NOW()
      WHERE kind = $1
        AND dismissed_at IS NULL
        AND status = 'running'
        AND input ->> 'freeze_source' = 'true'
        AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ($2::text || ' milliseconds')::interval)
    RETURNING *`,
    [kind, lease_ms],
  );
  return rows;
}

export function getArchiveBackupFreezeRecoveryStatus(
  result: unknown,
): ArchiveBackupFreezeFailure | undefined {
  const status = (result as Record<string, unknown> | null)?.[
    ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY
  ];
  if (
    status === "not-started" ||
    status === "released" ||
    status === "uncertain"
  ) {
    return status;
  }
}

async function attestArchiveFreezeRecovery(
  op_id: string,
  status: "not-started" | "released",
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const updated = await mergeLroResult({
        op_id,
        result: { [ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY]: status },
        if_status: ["succeeded", "failed", "canceled", "expired"],
      });
      if (updated) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (lastError) throw lastError;
  throw new Error(
    `backup LRO did not become terminal before ${status} attestation`,
  );
}

async function attestArchiveFreezeReleased(op_id: string): Promise<void> {
  await attestArchiveFreezeRecovery(op_id, "released");
}

async function attestArchiveFreezeNotStarted(op_id: string): Promise<void> {
  await attestArchiveFreezeRecovery(op_id, "not-started");
}

export function classifyArchiveBackupFreezeFailure({
  enabled,
  hostOperationStarted,
  operationSettled = true,
  error,
}: {
  enabled: boolean;
  hostOperationStarted: boolean;
  operationSettled?: boolean;
  error: unknown;
}): ArchiveBackupFreezeFailure | undefined {
  if (!enabled) return;
  if (!hostOperationStarted && operationSettled) return "not-started";
  if (
    `${(error as { code?: unknown })?.code ?? ""}` ===
    ARCHIVE_BACKUP_SOURCE_RELEASED_ERROR_CODE
  ) {
    return "released";
  }
  return "uncertain";
}

export function archiveBackupFreezeFailureResult(
  opts: Parameters<typeof classifyArchiveBackupFreezeFailure>[0] & {
    previousResult?: unknown;
  },
): Record<string, ArchiveBackupFreezeFailure> | undefined {
  const status =
    getArchiveBackupFreezeRecoveryStatus(opts.previousResult) === "uncertain"
      ? "uncertain"
      : classifyArchiveBackupFreezeFailure(opts);
  if (!status) return;
  return { [ARCHIVE_BACKUP_FREEZE_RECOVERY_RESULT_KEY]: status };
}

export function isArchiveBackupFailureReopenSafe(result: unknown): boolean {
  const status = getArchiveBackupFreezeRecoveryStatus(result);
  return status === "not-started" || status === "released";
}

export function createBackupFreezeRecovery({
  enabled,
  op_id,
  project_id,
  host_id,
  preservePriorUncertainty = false,
  releaseArchiveFreeze = releaseProjectDataArchiveFreezeOnHost,
  attestReleased = attestArchiveFreezeReleased,
  attestNotStarted = attestArchiveFreezeNotStarted,
}: {
  enabled: boolean;
  op_id: string;
  project_id: string;
  host_id: string;
  preservePriorUncertainty?: boolean;
  releaseArchiveFreeze?: ReleaseArchiveFreeze;
  attestReleased?: AttestArchiveFreezeReleased;
  attestNotStarted?: AttestArchiveFreezeNotStarted;
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
        if (preservePriorUncertainty) return;
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
      hostOperationStarted?: () => boolean,
    ): Promise<void> | undefined {
      if (!enabled || handedOff) return;
      return operation.then(
        async (backup) => await release(backup, reason),
        async (err) => {
          const status = classifyArchiveBackupFreezeFailure({
            enabled,
            hostOperationStarted: hostOperationStarted?.() ?? true,
            operationSettled: true,
            error: err,
          });
          if (status !== "released" && status !== "not-started") {
            return;
          }
          if (handedOff || cleanupStarted) return;
          cleanupStarted = true;
          if (preservePriorUncertainty) return;
          try {
            if (status === "released") {
              await attestReleased(op_id);
            } else {
              await attestNotStarted(op_id);
            }
          } catch (attestErr) {
            logger.error("unable to attest settled archive backup failure", {
              op_id,
              project_id,
              host_id,
              reason,
              status,
              err: `${attestErr}`,
            });
          }
        },
      );
    },
  };
}
