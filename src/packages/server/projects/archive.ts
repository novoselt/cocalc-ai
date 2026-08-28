/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { conat } from "@cocalc/backend/conat";
import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import { appendProjectOutboxEventForProject } from "@cocalc/database/postgres/project-events-outbox";
import { assertProjectNotRehoming } from "@cocalc/database/postgres/project-rehome-fence";
import { publishProjectAccountFeedEventsBestEffort } from "@cocalc/server/account/project-feed";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { createBackup } from "@cocalc/server/conat/api/project-backups";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import { resolveProjectBay } from "@cocalc/server/inter-bay/directory";
import { waitForDurableLroCompletion } from "@cocalc/server/lro/wait";
import {
  deleteProjectDataOnHost,
  deleteProjectDataOnHostAfterBackup,
  releaseProjectDataArchiveFreezeOnHost,
} from "@cocalc/server/project-host/control";
import { BACKUP_TIMEOUT_MS } from "@cocalc/server/projects/backup-lro";
import {
  clearProjectArchiveLifecycleFinalBackup,
  createProjectArchiveLifecycleJob,
  getProjectArchiveLifecycleFinalBackup,
  recordProjectArchiveLifecycleFinalBackup,
  type ProjectArchiveLifecycleFinalBackup,
  updateProjectArchiveLifecycleJob,
} from "./archive-lifecycle-db";
import { isProjectArchiveBackupCurrent } from "./archive-lifecycle-policy";
import type {
  ArchiveLifecycleProjectSnapshot,
  ProjectArchiveReason,
} from "./archive-lifecycle-types";

const log = getLogger("server:projects:archive");

export type ArchiveProjectStorageOptions = {
  project_id: string;
  mode: "manual" | "automatic";
  actor_account_id?: string | null;
  job_id?: string;
  reason?: ProjectArchiveReason;
  expected_host_id?: string | null;
};

export class ProjectArchiveStorageError extends Error {
  readonly hostCleanupCompleted: boolean;
  readonly reopenSafe: boolean;

  constructor(
    message: string,
    hostCleanupCompleted: boolean,
    reopenSafe: boolean,
  ) {
    super(message);
    this.name = "ProjectArchiveStorageError";
    this.hostCleanupCompleted = hostCleanupCompleted;
    this.reopenSafe = reopenSafe;
  }
}

type ArchiveRow = Omit<
  ArchiveLifecycleProjectSnapshot,
  "active_published_path"
>;

const FINAL_ARCHIVE_BACKUP_TAG = "automatic-project-archive-final";

async function loadArchiveRow(project_id: string): Promise<ArchiveRow> {
  const { rows } = await getPool().query<ArchiveRow>(
    `SELECT p.project_id,
            COALESCE(p.owning_bay_id, $2) AS owning_bay_id,
            p.host_id,
            h.status AS host_status,
            p.deleted,
            p.provisioned,
            p.deletion_protection,
            p.state,
            p.users,
            p.created,
            p.last_edited,
            p.last_changed,
            p.last_changed_generation,
            p.last_backup,
            p.last_backup_generation,
            p.backup_repo_id,
            p.archive_lifecycle_job_id
       FROM projects p
       LEFT JOIN project_hosts h ON h.id = p.host_id
      WHERE p.project_id = $1
        AND p.deleted IS NULL
      LIMIT 1`,
    [project_id, getConfiguredBayId()],
  );
  if (!rows[0]) throw new Error("project not found");
  return rows[0];
}

async function publishState(project_id: string): Promise<void> {
  await publishProjectAccountFeedEventsBestEffort({
    project_id,
    default_bay_id: getConfiguredBayId(),
  });
}

function assertAutomaticArchiveReady({
  row,
  job_id,
  expected_host_id,
}: {
  row: ArchiveRow;
  job_id: string;
  expected_host_id?: string | null;
}): void {
  const state = `${row.state?.state ?? ""}`.trim();
  const hostStatus = `${row.host_status ?? ""}`.trim().toLowerCase();
  if (state !== "archiving" || row.archive_lifecycle_job_id !== job_id) {
    throw new Error("automatic archive project claim is no longer current");
  }
  if (!row.host_id || !["active", "running"].includes(hostStatus)) {
    throw new Error("automatic archive requires a reachable live host");
  }
  if (expected_host_id && row.host_id !== expected_host_id) {
    throw new Error("automatic archive placement changed before cleanup");
  }
  if (
    !isProjectArchiveBackupCurrent({
      ...row,
      active_published_path: false,
    })
  ) {
    throw new Error("automatic archive backup is missing or stale");
  }
}

async function createFinalAutomaticArchiveBackup({
  project_id,
  job_id,
}: {
  project_id: string;
  job_id: string;
}): Promise<ProjectArchiveLifecycleFinalBackup> {
  const op = await createBackup(
    {
      project_id,
      tags: [FINAL_ARCHIVE_BACKUP_TAG],
    },
    {
      skip_collab_check: true,
      skip_rootfs_portability_check: true,
      replace_oldest_at_limit: true,
      freeze_source: true,
      dedupe_key: `${FINAL_ARCHIVE_BACKUP_TAG}:${job_id}`,
    },
  );
  const summary = await waitForDurableLroCompletion({
    op_id: op.op_id,
    scope_type: op.scope_type,
    scope_id: op.scope_id,
    client: conat(),
    timeout_ms: BACKUP_TIMEOUT_MS + 60_000,
  });
  if (summary.status !== "succeeded") {
    throw new Error(
      `final automatic archive backup failed: ${summary.error ?? summary.status}`,
    );
  }
  const result = summary.result ?? {};
  const id = `${result.id ?? result.backup_id ?? ""}`.trim();
  if (!id) {
    throw new Error(
      "final automatic archive backup completed without a snapshot id",
    );
  }
  const generation = Number(result.generation);
  if (!Number.isFinite(generation) || generation <= 0) {
    throw new Error(
      "final automatic archive backup completed without a filesystem generation",
    );
  }
  return {
    id,
    generation,
    time: result.time ?? result.backup_time ?? null,
  };
}

function finalBackupCoversProject({
  backup,
  row,
}: {
  backup: ProjectArchiveLifecycleFinalBackup;
  row: ArchiveRow;
}): boolean {
  const backupGeneration = Number(backup.generation);
  const changedGeneration = Number(row.last_changed_generation);
  return !(
    !Number.isFinite(backupGeneration) ||
    backupGeneration <= 0 ||
    (Number.isFinite(changedGeneration) &&
      changedGeneration > 0 &&
      backupGeneration < changedGeneration)
  );
}

function assertFinalBackupCoversProject(
  opts: Parameters<typeof finalBackupCoversProject>[0],
): void {
  if (!finalBackupCoversProject(opts)) {
    throw new Error(
      "final automatic archive backup does not cover the current filesystem generation",
    );
  }
}

async function setArchivedState({
  project_id,
  reason,
  job_id,
  automatic,
  expected_host_id,
}: {
  project_id: string;
  reason: ProjectArchiveReason;
  job_id: string;
  automatic: boolean;
  expected_host_id?: string | null;
}): Promise<void> {
  const checkedAt = new Date();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertProjectNotRehoming({
      db: client,
      project_id,
      action: "archive project",
    });
    const result = await client.query(
      `UPDATE projects
          SET state = $2::jsonb,
              provisioned = FALSE,
              provisioned_checked_at = $3,
              archive_reason = $4,
              archived_at = $3,
              archive_lifecycle_job_id = $5
        WHERE project_id = $1
          AND deleted IS NULL
          AND ($6::boolean IS FALSE OR (
            state ->> 'state' = 'archiving'
            AND archive_lifecycle_job_id = $5
            AND host_id IS NOT DISTINCT FROM $7::uuid
          ))`,
      [
        project_id,
        { state: "archived", time: checkedAt.toISOString() },
        checkedAt,
        reason,
        job_id,
        automatic,
        expected_host_id ?? null,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error("project archive claim became stale after host cleanup");
    }
    await appendProjectOutboxEventForProject({
      db: client,
      event_type: "project.state_changed",
      project_id,
      default_bay_id: getConfiguredBayId(),
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  await publishState(project_id);
}

export async function archiveProjectStorage({
  project_id,
  mode,
  actor_account_id,
  job_id: providedJobId,
  reason: providedReason,
  expected_host_id,
}: ArchiveProjectStorageOptions): Promise<void> {
  let row = await loadArchiveRow(project_id);
  const currentState = `${row.state?.state ?? ""}`.trim();
  if (currentState === "archived" && row.provisioned === false) return;

  const automatic = mode === "automatic";
  const reason = automatic ? providedReason : (providedReason ?? "manual");
  if (!reason) throw new Error("automatic archive reason is required");

  let jobId = providedJobId;
  if (!automatic) {
    const job = await createProjectArchiveLifecycleJob({
      project: { ...row, active_published_path: false },
      reason,
      reportOnly: false,
      actorAccountId: actor_account_id,
    });
    jobId = job?.id;
  }
  if (!jobId) throw new Error("archive lifecycle job is required");

  let hostCleanupCompleted = false;
  let expectedArchiveGeneration: number | undefined;
  let expectedArchiveBackupId: string | undefined;
  try {
    if (!row.backup_repo_id) {
      throw new Error(
        "project must have a configured backup repository before it can be archived",
      );
    }
    let hostStatus = `${row.host_status ?? ""}`.trim().toLowerCase();
    const hostDeprovisioned = hostStatus === "deprovisioned";
    const hostCanRunMutations =
      !hostStatus || hostStatus === "active" || hostStatus === "running";

    if (automatic) {
      assertAutomaticArchiveReady({
        row,
        job_id: jobId,
        expected_host_id,
      });
    } else if (!hostDeprovisioned && row.last_backup == null) {
      throw new Error(
        "project must have at least one backup before it can be archived",
      );
    }

    const ownership = await resolveProjectBay(project_id);
    if (!ownership) throw new Error(`project ${project_id} not found`);
    if (
      !automatic &&
      hostCanRunMutations &&
      ["running", "starting", "pending", "stopping"].includes(currentState)
    ) {
      await getInterBayBridge().projectControl(ownership.bay_id).stop({
        project_id,
        epoch: ownership.epoch,
      });
    }

    if (automatic) {
      let finalBackup = await getProjectArchiveLifecycleFinalBackup(jobId);
      if (
        !finalBackup ||
        !finalBackupCoversProject({ backup: finalBackup, row })
      ) {
        const previousFinalBackupId = finalBackup?.id ?? null;
        finalBackup = await createFinalAutomaticArchiveBackup({
          project_id,
          job_id: jobId,
        });
        expectedArchiveGeneration = Number(finalBackup.generation);
        expectedArchiveBackupId = finalBackup.id;
        row = await loadArchiveRow(project_id);
        hostStatus = `${row.host_status ?? ""}`.trim().toLowerCase();
        if (!row.backup_repo_id) {
          throw new Error(
            "project backup repository disappeared during automatic archive",
          );
        }
        assertAutomaticArchiveReady({
          row,
          job_id: jobId,
          expected_host_id,
        });
        assertFinalBackupCoversProject({ backup: finalBackup, row });
        await recordProjectArchiveLifecycleFinalBackup({
          job_id: jobId,
          backup_id: finalBackup.id,
          backup_generation: Number(finalBackup.generation),
          backup_time: finalBackup.time,
          expected_previous_backup_id: previousFinalBackupId,
        });
      }
      assertFinalBackupCoversProject({ backup: finalBackup, row });
      expectedArchiveGeneration = Number(finalBackup.generation);
      expectedArchiveBackupId = finalBackup.id;
    }

    const refreshedHostCanRunMutations =
      !hostStatus || hostStatus === "active" || hostStatus === "running";

    if (row.provisioned !== false && refreshedHostCanRunMutations) {
      if (!row.host_id) {
        throw new Error("project has no assigned host to archive from");
      }
      if (automatic) {
        if (!expectedArchiveGeneration) {
          throw new Error("automatic archive backup generation is missing");
        }
        await deleteProjectDataOnHostAfterBackup({
          project_id,
          host_id: row.host_id,
          expected_generation: expectedArchiveGeneration,
        });
      } else {
        await deleteProjectDataOnHost({ project_id, host_id: row.host_id });
      }
      hostCleanupCompleted = true;
    } else if (row.provisioned !== false) {
      log.info("manual archive marked project without host mutation", {
        project_id,
        host_id: row.host_id,
        host_status: hostStatus || undefined,
      });
    }

    await setArchivedState({
      project_id,
      reason,
      job_id: jobId,
      automatic,
      expected_host_id: expected_host_id ?? row.host_id,
    });
    await updateProjectArchiveLifecycleJob({
      job_id: jobId,
      status: "completed",
    });
  } catch (err) {
    let reopenSafe = true;
    if (
      automatic &&
      !hostCleanupCompleted &&
      expectedArchiveGeneration &&
      row.host_id
    ) {
      reopenSafe = false;
      try {
        const release = await releaseProjectDataArchiveFreezeOnHost({
          project_id,
          host_id: row.host_id,
          expected_generation: expectedArchiveGeneration,
        });
        if (release.status === "absent") {
          // The checked deletion completed but its response was lost. Retain
          // the durable marker and retry only database finalization.
          hostCleanupCompleted = true;
        } else if (expectedArchiveBackupId) {
          await clearProjectArchiveLifecycleFinalBackup({
            job_id: jobId,
            backup_id: expectedArchiveBackupId,
            backup_generation: expectedArchiveGeneration,
          });
          reopenSafe = true;
        } else {
          // The marker was never persisted, so reopening cannot cause a retry
          // to reuse this backup.
          reopenSafe = true;
        }
      } catch (releaseErr) {
        log.warn("unable to release automatic archive volume freeze", {
          project_id,
          host_id: row.host_id,
          expected_generation: expectedArchiveGeneration,
          err: `${releaseErr}`,
        });
      }
    }
    await updateProjectArchiveLifecycleJob({
      job_id: jobId,
      status: "failed",
      failure_category: "archive-storage",
      error: err,
    }).catch(() => undefined);
    if (automatic) {
      throw new ProjectArchiveStorageError(
        `${err}`,
        hostCleanupCompleted,
        reopenSafe,
      );
    }
    throw err;
  }
}
