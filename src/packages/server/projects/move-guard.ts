/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";

const DEFAULT_GUARD_TTL_MS = 5 * 60 * 1000;

const guardTtlMs = Math.max(
  30_000,
  Number(process.env.COCALC_PROJECT_MOVE_GUARD_TTL_MS) || DEFAULT_GUARD_TTL_MS,
);

let schemaReady: Promise<void> | undefined;

async function ensureProjectMoveGuardSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_moves (
        project_id UUID PRIMARY KEY,
        source_host_id UUID,
        dest_host_id UUID,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(
      "ALTER TABLE project_moves ADD COLUMN IF NOT EXISTS move_id UUID",
    );
    await pool.query(
      "ALTER TABLE project_moves ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ",
    );
    await pool.query(
      "ALTER TABLE project_moves ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",
    );
  })().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  await schemaReady;
}

export class ProjectMoveInProgressError extends Error {
  constructor(public readonly project_id: string) {
    super("Project is being moved to another host. Please try again shortly.");
    this.name = "ProjectMoveInProgressError";
  }
}

export async function acquireProjectMoveGuard({
  project_id,
  move_id,
  source_host_id,
  dest_host_id,
}: {
  project_id: string;
  move_id: string;
  source_host_id?: string | null;
  dest_host_id?: string | null;
}): Promise<void> {
  await ensureProjectMoveGuardSchema();
  const { rows } = await getPool().query<{ move_id: string }>(
    `
      INSERT INTO project_moves
        (project_id, source_host_id, dest_host_id, move_id, created_at, heartbeat_at, expires_at)
      VALUES ($1, $3, $4, $2, now(), now(), now() + ($5 * interval '1 millisecond'))
      ON CONFLICT (project_id) DO UPDATE
      SET source_host_id=EXCLUDED.source_host_id,
          dest_host_id=EXCLUDED.dest_host_id,
          move_id=EXCLUDED.move_id,
          created_at=now(),
          heartbeat_at=now(),
          expires_at=EXCLUDED.expires_at
      WHERE project_moves.move_id=$2
         OR project_moves.move_id IS NULL
         OR project_moves.expires_at IS NULL
         OR project_moves.expires_at <= now()
      RETURNING move_id
    `,
    [
      project_id,
      move_id,
      source_host_id ?? null,
      dest_host_id ?? null,
      guardTtlMs,
    ],
  );
  if (rows[0]?.move_id !== move_id) {
    throw new ProjectMoveInProgressError(project_id);
  }
}

export async function heartbeatProjectMoveGuard({
  project_id,
  move_id,
}: {
  project_id: string;
  move_id: string;
}): Promise<void> {
  await ensureProjectMoveGuardSchema();
  const { rowCount } = await getPool().query(
    `
      UPDATE project_moves
      SET heartbeat_at=now(),
          expires_at=now() + ($3 * interval '1 millisecond')
      WHERE project_id=$1 AND move_id=$2
    `,
    [project_id, move_id, guardTtlMs],
  );
  if (!rowCount) {
    throw new Error(`project move guard was lost for ${project_id}`);
  }
}

export async function releaseProjectMoveGuard({
  project_id,
  move_id,
}: {
  project_id: string;
  move_id: string;
}): Promise<void> {
  await ensureProjectMoveGuardSchema();
  await getPool().query(
    "DELETE FROM project_moves WHERE project_id=$1 AND move_id=$2",
    [project_id, move_id],
  );
}

export async function assertProjectStartAllowedDuringMove({
  project_id,
  project_move_id,
}: {
  project_id: string;
  project_move_id?: string;
}): Promise<void> {
  await ensureProjectMoveGuardSchema();
  const { rows } = await getPool().query<{ move_id: string }>(
    `
      SELECT move_id
      FROM project_moves
      WHERE project_id=$1
        AND move_id IS NOT NULL
        AND expires_at > now()
      LIMIT 1
    `,
    [project_id],
  );
  const activeMoveId = rows[0]?.move_id;
  if (activeMoveId && activeMoveId !== project_move_id) {
    throw new ProjectMoveInProgressError(project_id);
  }
}

export const __test__ = {
  guardTtlMs,
  resetSchema() {
    schemaReady = undefined;
  },
};
