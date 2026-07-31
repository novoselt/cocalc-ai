/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";

import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";

import type { ProjectVolumeKind } from "./volume-quotas";

export type ProjectVolumeQuotaOverrideState =
  | "active"
  | "applied"
  | "release_pending"
  | "released";

export interface ProjectVolumeQuotaOverrideRow {
  override_id: string;
  project_id: string;
  volume_kind: ProjectVolumeKind;
  operation_id: string;
  kind: string;
  minimum_bytes: number;
  created_at: number;
  expires_at?: number | null;
  released_at?: number | null;
  state: ProjectVolumeQuotaOverrideState;
  last_error?: string | null;
  updated_at: number;
}

const TABLE = "project_volume_quota_overrides";
let initialized = false;

function ensureTable(): void {
  if (initialized) return;
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      override_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      volume_kind TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      minimum_bytes INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      released_at INTEGER,
      state TEXT NOT NULL,
      last_error TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, volume_kind, operation_id, kind)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_active_volume_idx
       ON ${TABLE}(project_id, volume_kind, state, minimum_bytes)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_active_expiry_idx
       ON ${TABLE}(state, expires_at, created_at)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_released_updated_idx
       ON ${TABLE}(state, updated_at)`,
  );
  initialized = true;
}

function parseRow(row: any): ProjectVolumeQuotaOverrideRow {
  return {
    override_id: `${row.override_id}`,
    project_id: `${row.project_id}`,
    volume_kind: row.volume_kind as ProjectVolumeKind,
    operation_id: `${row.operation_id}`,
    kind: `${row.kind}`,
    minimum_bytes: Number(row.minimum_bytes),
    created_at: Number(row.created_at),
    expires_at: row.expires_at == null ? null : Number(row.expires_at),
    released_at: row.released_at == null ? null : Number(row.released_at),
    state: row.state as ProjectVolumeQuotaOverrideState,
    last_error: row.last_error == null ? null : `${row.last_error}`,
    updated_at: Number(row.updated_at),
  };
}

export function getProjectVolumeQuotaOverride(
  override_id: string,
): ProjectVolumeQuotaOverrideRow | undefined {
  ensureTable();
  const row = getDatabase()
    .prepare(`SELECT * FROM ${TABLE} WHERE override_id=?`)
    .get(override_id);
  return row ? parseRow(row) : undefined;
}

export function createProjectVolumeQuotaOverride({
  override_id = randomUUID(),
  project_id,
  volume_kind,
  operation_id,
  kind,
  minimum_bytes,
  expires_at,
}: {
  override_id?: string;
  project_id: string;
  volume_kind: ProjectVolumeKind;
  operation_id: string;
  kind: string;
  minimum_bytes: number;
  expires_at?: number;
}): ProjectVolumeQuotaOverrideRow {
  ensureTable();
  const minimum = Math.max(0, Math.floor(minimum_bytes));
  if (!minimum) {
    throw new Error("temporary quota override minimum must be positive");
  }
  const now = Date.now();
  const existing = getDatabase()
    .prepare(
      `SELECT * FROM ${TABLE}
        WHERE project_id=? AND volume_kind=? AND operation_id=? AND kind=?`,
    )
    .get(project_id, volume_kind, operation_id, kind);
  if (existing) {
    const parsed = parseRow(existing);
    if (parsed.minimum_bytes !== minimum) {
      throw new Error(
        `conflicting temporary quota override for operation ${operation_id}`,
      );
    }
    if (parsed.state === "release_pending") {
      throw new Error(
        `temporary quota override release is still pending for operation ${operation_id}`,
      );
    }
    if (parsed.state === "released") {
      getDatabase()
        .prepare(
          `UPDATE ${TABLE}
              SET state='active', created_at=?, expires_at=?, released_at=NULL,
                  last_error=NULL, updated_at=?
            WHERE override_id=?`,
        )
        .run(now, expires_at ?? null, now, parsed.override_id);
    } else if (
      expires_at != null &&
      (parsed.expires_at == null || expires_at > parsed.expires_at)
    ) {
      getDatabase()
        .prepare(
          `UPDATE ${TABLE} SET expires_at=?, updated_at=? WHERE override_id=?`,
        )
        .run(expires_at, now, parsed.override_id);
    }
    return getProjectVolumeQuotaOverride(parsed.override_id)!;
  }
  getDatabase()
    .prepare(
      `
        INSERT INTO ${TABLE} (
          override_id, project_id, volume_kind, operation_id, kind,
          minimum_bytes, created_at, expires_at, released_at, state,
          last_error, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', NULL, ?)
        ON CONFLICT(project_id, volume_kind, operation_id, kind) DO NOTHING
      `,
    )
    .run(
      override_id,
      project_id,
      volume_kind,
      operation_id,
      kind,
      minimum,
      now,
      expires_at ?? null,
      now,
    );
  const row = getDatabase()
    .prepare(
      `SELECT * FROM ${TABLE}
        WHERE project_id=? AND volume_kind=? AND operation_id=? AND kind=?`,
    )
    .get(project_id, volume_kind, operation_id, kind);
  const parsed = parseRow(row);
  if (parsed.minimum_bytes !== minimum) {
    throw new Error(
      `conflicting temporary quota override for operation ${operation_id}`,
    );
  }
  return parsed;
}

export function listActiveProjectVolumeQuotaOverrides(
  project_id: string,
  volume_kind: ProjectVolumeKind,
): ProjectVolumeQuotaOverrideRow[] {
  ensureTable();
  return getDatabase()
    .prepare(
      `SELECT * FROM ${TABLE}
        WHERE project_id=? AND volume_kind=? AND state IN ('active', 'applied')
        ORDER BY minimum_bytes DESC, created_at ASC`,
    )
    .all(project_id, volume_kind)
    .map(parseRow);
}

export function listUnreleasedProjectVolumeQuotaOverrides({
  limit = 256,
  expired_before,
}: {
  limit?: number;
  expired_before?: number;
} = {}): ProjectVolumeQuotaOverrideRow[] {
  ensureTable();
  const boundedLimit = Math.max(1, Math.min(4096, Math.floor(limit)));
  const rows =
    expired_before == null
      ? getDatabase()
          .prepare(
            `SELECT * FROM ${TABLE}
              WHERE state IN ('active', 'applied', 'release_pending')
              ORDER BY created_at ASC
              LIMIT ?`,
          )
          .all(boundedLimit)
      : getDatabase()
          .prepare(
            `SELECT * FROM ${TABLE}
              WHERE state='release_pending'
                 OR (
                   state IN ('active', 'applied')
                   AND expires_at IS NOT NULL
                   AND expires_at <= ?
                 )
              ORDER BY expires_at ASC, created_at ASC
              LIMIT ?`,
          )
          .all(expired_before, boundedLimit);
  return rows.map(parseRow);
}

export function effectiveProjectVolumeQuotaBytes({
  project_id,
  volume_kind,
  persistent_bytes,
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  persistent_bytes: number;
}): {
  effective_bytes: number;
  overrides: ProjectVolumeQuotaOverrideRow[];
} {
  const overrides = listActiveProjectVolumeQuotaOverrides(
    project_id,
    volume_kind,
  );
  return {
    effective_bytes: Math.max(
      Math.max(0, Math.floor(persistent_bytes)),
      ...overrides.map(({ minimum_bytes }) => minimum_bytes),
    ),
    overrides,
  };
}

export function markProjectVolumeQuotaOverrideApplied(
  override_id: string,
): boolean {
  ensureTable();
  const result = getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET state='applied', last_error=NULL, updated_at=?
        WHERE override_id=? AND state IN ('active', 'applied')`,
    )
    .run(Date.now(), override_id);
  return Number(result.changes) === 1;
}

export function markProjectVolumeQuotaOverrideFailed(
  override_id: string,
  error: unknown,
): boolean {
  ensureTable();
  const result = getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET last_error=?, updated_at=?
        WHERE override_id=? AND state IN ('active', 'applied', 'release_pending')`,
    )
    .run(`${error}`, Date.now(), override_id);
  return Number(result.changes) === 1;
}

export function releaseProjectVolumeQuotaOverride(
  override_id: string,
): ProjectVolumeQuotaOverrideRow | undefined {
  ensureTable();
  const now = Date.now();
  getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET state='release_pending', released_at=COALESCE(released_at, ?),
              last_error=NULL, updated_at=?
        WHERE override_id=? AND state IN ('active', 'applied')`,
    )
    .run(now, now, override_id);
  return getProjectVolumeQuotaOverride(override_id);
}

export function completeProjectVolumeQuotaOverrideRelease(
  override_id: string,
): boolean {
  ensureTable();
  const result = getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET state='released', last_error=NULL, updated_at=?
        WHERE override_id=? AND state='release_pending'`,
    )
    .run(Date.now(), override_id);
  return Number(result.changes) === 1;
}

export function pruneReleasedProjectVolumeQuotaOverrides({
  released_before,
  limit = 512,
}: {
  released_before: number;
  limit?: number;
}): number {
  ensureTable();
  const boundedLimit = Math.max(1, Math.min(4096, Math.floor(limit)));
  const result = getDatabase()
    .prepare(
      `DELETE FROM ${TABLE}
        WHERE override_id IN (
          SELECT override_id
          FROM ${TABLE}
          WHERE state='released' AND updated_at < ?
          ORDER BY updated_at ASC
          LIMIT ?
        )`,
    )
    .run(released_before, boundedLimit);
  return Number(result.changes);
}

export function deleteProjectVolumeQuotaOverrides(project_id: string): void {
  ensureTable();
  getDatabase()
    .prepare(`DELETE FROM ${TABLE} WHERE project_id=?`)
    .run(project_id);
}
