/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { v4 as uuid } from "uuid";

import getPool from "@cocalc/database/pool";
import {
  ensureProjectArchiveLifecycleSchema,
  PROJECT_ARCHIVE_LIFECYCLE_TABLE,
} from "./archive-lifecycle-schema";
import type {
  ArchiveLifecycleProjectSnapshot,
  ProjectArchiveEligibilityDecision,
  ProjectArchiveLifecycleConfig,
  ProjectArchiveLifecycleJobStatus,
  ProjectArchiveReason,
} from "./archive-lifecycle-types";
import { PROJECT_ARCHIVE_POLICY_VERSION } from "./archive-lifecycle-types";

export type ProjectArchiveLifecycleJob = {
  id: string;
  project_id: string;
  owning_bay_id: string;
  host_id: string | null;
  reason: ProjectArchiveReason;
  policy_version: number;
  status: ProjectArchiveLifecycleJobStatus;
  report_only: boolean;
  attempts: number;
  thresholds: Record<string, unknown>;
};

function boundedError(error: unknown): string {
  return `${error ?? "unknown error"}`.slice(0, 8000);
}

function thresholds(config?: ProjectArchiveLifecycleConfig) {
  if (!config) return {};
  return {
    free_after_days: config.freeAfterDays,
    banned_after_days: config.bannedAfterDays,
    global_per_hour: config.globalPerHour,
    per_host_concurrency: config.perHostConcurrency,
    canary_bays: config.canaryBays,
    canary_hosts: config.canaryHosts,
  };
}

function evidence({
  project,
  decision,
}: {
  project: ArchiveLifecycleProjectSnapshot;
  decision?: ProjectArchiveEligibilityDecision;
}) {
  return {
    observed_state: project.state?.state ?? null,
    observed_last_edited: project.last_edited ?? null,
    observed_created: project.created ?? null,
    observed_host_id: project.host_id,
    observed_owning_bay_id: project.owning_bay_id,
    ownership_epoch: project.ownership_epoch ?? null,
    active_published_path: project.active_published_path,
    collaborator_ids:
      decision?.eligible === true ? decision.collaborator_ids : [],
    effective_activity_at:
      decision?.eligible === true ? decision.effective_activity_at : null,
    latest_banned_at:
      decision?.eligible === true ? decision.latest_banned_at : null,
  };
}

export async function createProjectArchiveLifecycleJob({
  project,
  reason,
  reportOnly,
  config,
  decision,
  actorAccountId,
}: {
  project: ArchiveLifecycleProjectSnapshot;
  reason: ProjectArchiveReason;
  reportOnly: boolean;
  config?: ProjectArchiveLifecycleConfig;
  decision?: ProjectArchiveEligibilityDecision;
  actorAccountId?: string | null;
}): Promise<ProjectArchiveLifecycleJob | undefined> {
  await ensureProjectArchiveLifecycleSchema();
  const id = uuid();
  const activity =
    decision?.eligible === true ? decision.effective_activity_at : "manual";
  const reportBucket = reportOnly
    ? new Date().toISOString().slice(0, 10)
    : activity;
  const policyKey = config
    ? `${config.freeAfterDays}:${config.bannedAfterDays}:${config.canaryBays.join(",")}:${config.canaryHosts.join(",")}`
    : "manual";
  const dedupeKey =
    reason === "manual"
      ? `manual:${id}`
      : `${project.project_id}:${reason}:${PROJECT_ARCHIVE_POLICY_VERSION}:${reportOnly}:${reportBucket}:${policyKey}`;
  const status: ProjectArchiveLifecycleJobStatus = reportOnly
    ? "report-only"
    : reason === "manual"
      ? "running"
      : "queued";
  const pool = getPool();
  if (reason === "manual") {
    // A user-requested archive may replace work that automation has only
    // queued. Never supersede a running job, since host cleanup may have begun.
    await pool.query(
      `UPDATE ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
          SET status = 'stale',
              completed_at = NOW(),
              failure_category = 'superseded-by-manual-archive',
              updated_at = NOW()
        WHERE project_id = $1
          AND reason <> 'manual'
          AND status = 'queued'`,
      [project.project_id],
    );
  }
  if (reason === "all-collaborators-banned" && !reportOnly) {
    await pool.query(
      `UPDATE ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
          SET status = 'stale',
              completed_at = NOW(),
              failure_category = 'superseded-by-banned-policy',
              updated_at = NOW()
        WHERE project_id = $1
          AND reason = 'free-inactive'
          AND status = 'queued'`,
      [project.project_id],
    );
  }
  const { rows } = await pool.query<ProjectArchiveLifecycleJob>(
    `INSERT INTO ${PROJECT_ARCHIVE_LIFECYCLE_TABLE} (
       id, project_id, owning_bay_id, host_id, reason, policy_version,
       status, report_only, actor_account_id, thresholds, evidence,
       backup_repo_id, backup_generation, backup_time, dedupe_key,
       completed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
       $12, $13, $14, $15,
       CASE WHEN $7 = 'report-only' THEN NOW() ELSE NULL END
     )
     ON CONFLICT DO NOTHING
     RETURNING id, project_id, owning_bay_id, host_id, reason,
               policy_version, status, report_only, attempts, thresholds`,
    [
      id,
      project.project_id,
      project.owning_bay_id,
      project.host_id,
      reason,
      PROJECT_ARCHIVE_POLICY_VERSION,
      status,
      reportOnly,
      actorAccountId ?? null,
      JSON.stringify(thresholds(config)),
      JSON.stringify(evidence({ project, decision })),
      project.backup_repo_id,
      project.last_backup_generation,
      project.last_backup,
      dedupeKey,
    ],
  );
  return rows[0];
}

export async function updateProjectArchiveLifecycleJob({
  job_id,
  status,
  failure_category,
  error,
}: {
  job_id: string;
  status: ProjectArchiveLifecycleJobStatus;
  failure_category?: string | null;
  error?: unknown;
}): Promise<void> {
  await ensureProjectArchiveLifecycleSchema();
  await getPool().query(
    `UPDATE ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
        SET status = $2,
            completed_at = CASE WHEN $2 IN ('completed', 'stale', 'canceled', 'failed') THEN NOW() ELSE completed_at END,
            next_attempt_at = CASE WHEN $2 = 'failed' THEN NOW() + INTERVAL '1 hour' ELSE NULL END,
            failure_category = $3,
            error = $4,
            updated_at = NOW()
      WHERE id = $1`,
    [
      job_id,
      status,
      failure_category ?? null,
      error == null ? null : boundedError(error),
    ],
  );
}

export async function countRecentAutomaticArchives(): Promise<number> {
  await ensureProjectArchiveLifecycleSchema();
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
      WHERE report_only IS FALSE
        AND reason <> 'manual'
        AND claimed_at >= NOW() - INTERVAL '1 hour'`,
  );
  return Math.max(0, Number(rows[0]?.count ?? 0) || 0);
}

export async function countRunningArchivesByHost(
  host_id: string,
): Promise<number> {
  await ensureProjectArchiveLifecycleSchema();
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
      WHERE host_id = $1
        AND status = 'running'`,
    [host_id],
  );
  return Math.max(0, Number(rows[0]?.count ?? 0) || 0);
}

export async function claimProjectArchiveLifecycleJob(
  job_id: string,
): Promise<boolean> {
  await ensureProjectArchiveLifecycleSchema();
  const result = await getPool().query(
    `UPDATE ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
        SET status = 'running',
            attempts = attempts + 1,
            claimed_at = NOW(),
            completed_at = NULL,
            next_attempt_at = NULL,
            failure_category = NULL,
            error = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND (
          status = 'queued'
          OR (status = 'failed' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          OR (status = 'running' AND updated_at <= NOW() - INTERVAL '10 minutes')
        )`,
    [job_id],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function listQueuedProjectArchiveLifecycleJobs(
  limit: number,
): Promise<ProjectArchiveLifecycleJob[]> {
  await ensureProjectArchiveLifecycleSchema();
  const { rows } = await getPool().query<ProjectArchiveLifecycleJob>(
    `SELECT id, project_id, owning_bay_id, host_id, reason,
            policy_version, status, report_only, attempts, thresholds
       FROM ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
      WHERE reason <> 'manual'
        AND report_only IS FALSE
        AND (
          (
            status IN ('queued', 'failed')
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
          ) OR (
            status = 'running'
            AND updated_at <= NOW() - INTERVAL '10 minutes'
          )
        )
      ORDER BY CASE WHEN reason = 'all-collaborators-banned' THEN 0 ELSE 1 END,
               created_at ASC
      LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );
  return rows;
}
