/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import { ensureAccountBanAuditLogSchema } from "@cocalc/server/accounts/ban-audit";
import { ensureAccountBanTimestampSchema } from "@cocalc/server/accounts/ban-timestamp";
import { ensureClusterAccountDirectorySchema } from "@cocalc/server/accounts/cluster-directory";

export const PROJECT_ARCHIVE_LIFECYCLE_TABLE = "project_archive_lifecycle_jobs";

let schemaReady: Promise<void> | undefined;

export async function ensureProjectArchiveLifecycleSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await Promise.all([
      ensureAccountBanTimestampSchema(),
      ensureAccountBanAuditLogSchema(),
      ensureClusterAccountDirectorySchema(),
    ]);
    const pool = getPool();
    await pool.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(64),
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS archive_lifecycle_job_id UUID
    `);
    await pool.query(`
      ALTER TABLE ${PROJECT_ARCHIVE_LIFECYCLE_TABLE}
        ALTER COLUMN report_only SET DEFAULT FALSE,
        ALTER COLUMN selector_at SET DEFAULT NOW(),
        ALTER COLUMN attempts SET DEFAULT 0,
        ALTER COLUMN thresholds SET DEFAULT '{}'::jsonb,
        ALTER COLUMN evidence SET DEFAULT '{}'::jsonb,
        ALTER COLUMN created_at SET DEFAULT NOW(),
        ALTER COLUMN updated_at SET DEFAULT NOW()
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS project_archive_lifecycle_dedupe_idx
        ON ${PROJECT_ARCHIVE_LIFECYCLE_TABLE} (dedupe_key)
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS project_archive_lifecycle_active_project_idx
        ON ${PROJECT_ARCHIVE_LIFECYCLE_TABLE} (project_id)
        WHERE status IN ('queued', 'running')
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS project_archive_lifecycle_due_idx
        ON ${PROJECT_ARCHIVE_LIFECYCLE_TABLE} (next_attempt_at, created_at)
        WHERE status IN ('queued', 'failed')
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS project_archive_lifecycle_host_status_idx
        ON ${PROJECT_ARCHIVE_LIFECYCLE_TABLE} (host_id, status)
        WHERE status IN ('queued', 'running')
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS projects_archive_lifecycle_candidates_idx
        ON projects (
          COALESCE(last_edited, created, 'epoch'::timestamptz),
          project_id
        )
        WHERE deleted IS NULL
          AND provisioned IS TRUE
          AND COALESCE(deletion_protection, FALSE) IS FALSE
          AND state ->> 'state' = 'opened'
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS projects_archive_lifecycle_job_idx
        ON projects (archive_lifecycle_job_id)
        WHERE archive_lifecycle_job_id IS NOT NULL
    `);
    await pool.query(`
      DO $$ BEGIN
        IF to_regclass('public.public_project_paths') IS NOT NULL THEN
          EXECUTE 'CREATE INDEX IF NOT EXISTS public_project_paths_active_project_idx
                     ON public_project_paths (project_id)
                   WHERE disabled IS FALSE AND visibility <> ''disabled''';
        END IF;
      END $$
    `);
  })().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  await schemaReady;
}

export function resetProjectArchiveLifecycleSchemaForTests(): void {
  schemaReady = undefined;
}
