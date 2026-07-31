/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";
import { currentProjectVolumeQuotaEpoch } from "./filesystem-quota-state";

export type ProjectVolumeKind = "home" | "scratch";
export type ProjectVolumeQuotaState =
  | "pending"
  | "applying"
  | "applied"
  | "blocked"
  | "failed"
  | "missing";

export interface ProjectVolumeQuotaRow {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  desired_bytes: number;
  desired_revision: number;
  applied_bytes?: number | null;
  applied_revision?: number | null;
  applied_epoch?: string | null;
  volume_identity?: string | null;
  state: ProjectVolumeQuotaState;
  last_error?: string | null;
  desired_updated_at: number;
  apply_started_at?: number | null;
  applied_at?: number | null;
  updated_at: number;
}

export type DesiredQuotaAcceptance =
  | { status: "accepted" | "unchanged"; row: ProjectVolumeQuotaRow }
  | { status: "stale"; row: ProjectVolumeQuotaRow };

const TABLE = "project_volume_quotas";
let initialized = false;

export { currentProjectVolumeQuotaEpoch };

function ensureTable(): void {
  if (initialized) return;
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      project_id TEXT NOT NULL,
      volume_kind TEXT NOT NULL,
      desired_bytes INTEGER NOT NULL,
      desired_revision INTEGER NOT NULL,
      applied_bytes INTEGER,
      applied_revision INTEGER,
      applied_epoch TEXT,
      volume_identity TEXT,
      state TEXT NOT NULL,
      last_error TEXT,
      desired_updated_at INTEGER NOT NULL,
      apply_started_at INTEGER,
      applied_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, volume_kind)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_state_updated_idx ON ${TABLE}(state, updated_at)`,
  );
  initialized = true;
}

function parseRow(row: any): ProjectVolumeQuotaRow {
  return {
    project_id: `${row.project_id}`,
    volume_kind: row.volume_kind as ProjectVolumeKind,
    desired_bytes: Number(row.desired_bytes),
    desired_revision: Number(row.desired_revision),
    applied_bytes: row.applied_bytes == null ? null : Number(row.applied_bytes),
    applied_revision:
      row.applied_revision == null ? null : Number(row.applied_revision),
    applied_epoch: row.applied_epoch == null ? null : `${row.applied_epoch}`,
    volume_identity:
      row.volume_identity == null ? null : `${row.volume_identity}`,
    state: row.state as ProjectVolumeQuotaState,
    last_error: row.last_error == null ? null : `${row.last_error}`,
    desired_updated_at: Number(row.desired_updated_at),
    apply_started_at:
      row.apply_started_at == null ? null : Number(row.apply_started_at),
    applied_at: row.applied_at == null ? null : Number(row.applied_at),
    updated_at: Number(row.updated_at),
  };
}

export function getProjectVolumeQuota(
  project_id: string,
  volume_kind: ProjectVolumeKind,
): ProjectVolumeQuotaRow | undefined {
  ensureTable();
  const row = getDatabase()
    .prepare(`SELECT * FROM ${TABLE} WHERE project_id=? AND volume_kind=?`)
    .get(project_id, volume_kind);
  return row ? parseRow(row) : undefined;
}

export function acceptProjectVolumeQuotaDesired({
  project_id,
  volume_kind,
  desired_bytes,
  desired_revision,
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  desired_bytes: number;
  desired_revision?: number;
}): DesiredQuotaAcceptance {
  ensureTable();
  const bytes = Math.max(0, Math.floor(desired_bytes));
  const existing = getProjectVolumeQuota(project_id, volume_kind);
  const revision =
    desired_revision == null
      ? 0
      : Math.max(0, Math.floor(Number(desired_revision)));
  if (existing) {
    if (desired_revision == null && existing.desired_revision > 0) {
      return { status: "stale", row: existing };
    }
    if (revision < existing.desired_revision) {
      return { status: "stale", row: existing };
    }
    if (
      desired_revision != null &&
      revision === existing.desired_revision &&
      bytes !== existing.desired_bytes
    ) {
      throw new Error(
        `conflicting ${volume_kind} quota for project ${project_id} at revision ${revision}`,
      );
    }
    if (
      desired_revision != null &&
      revision === existing.desired_revision &&
      bytes === existing.desired_bytes
    ) {
      return { status: "unchanged", row: existing };
    }
  }

  const now = Date.now();
  const preserveApplied =
    existing?.applied_revision === revision &&
    existing?.applied_bytes === bytes;
  getDatabase()
    .prepare(
      `
        INSERT INTO ${TABLE} (
          project_id, volume_kind, desired_bytes, desired_revision,
          applied_bytes, applied_revision, applied_epoch, volume_identity,
          state, last_error, desired_updated_at, apply_started_at, applied_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        ON CONFLICT(project_id, volume_kind) DO UPDATE SET
          desired_bytes=excluded.desired_bytes,
          desired_revision=excluded.desired_revision,
          state=excluded.state,
          last_error=NULL,
          desired_updated_at=excluded.desired_updated_at,
          updated_at=excluded.updated_at
      `,
    )
    .run(
      project_id,
      volume_kind,
      bytes,
      revision,
      existing?.applied_bytes ?? null,
      existing?.applied_revision ?? null,
      existing?.applied_epoch ?? null,
      existing?.volume_identity ?? null,
      preserveApplied ? (existing?.state ?? "applied") : "pending",
      now,
      existing?.apply_started_at ?? null,
      existing?.applied_at ?? null,
      now,
    );
  return {
    status: "accepted",
    row: getProjectVolumeQuota(project_id, volume_kind)!,
  };
}

export function projectVolumeQuotaIsApplied(
  row: ProjectVolumeQuotaRow,
  {
    volume_identity,
    epoch = currentProjectVolumeQuotaEpoch(),
  }: { volume_identity?: string; epoch?: string } = {},
): boolean {
  return (
    epoch != null &&
    volume_identity != null &&
    row.state === "applied" &&
    row.applied_bytes === row.desired_bytes &&
    row.applied_revision === row.desired_revision &&
    row.applied_epoch === epoch &&
    (volume_identity == null || row.volume_identity === volume_identity)
  );
}

export function markProjectVolumeQuotaApplying({
  project_id,
  volume_kind,
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
}): void {
  ensureTable();
  const now = Date.now();
  getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET state='applying', apply_started_at=?, last_error=NULL, updated_at=?
        WHERE project_id=? AND volume_kind=?`,
    )
    .run(now, now, project_id, volume_kind);
}

export function markProjectVolumeQuotaApplied({
  project_id,
  volume_kind,
  desired_bytes,
  desired_revision,
  volume_identity,
  epoch = currentProjectVolumeQuotaEpoch(),
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  desired_bytes: number;
  desired_revision: number;
  volume_identity?: string;
  epoch?: string;
}): boolean {
  if (!epoch) {
    throw new Error("project filesystem quota state is not initialized");
  }
  if (!volume_identity) {
    throw new Error("project volume identity is required");
  }
  ensureTable();
  const now = Date.now();
  const result = getDatabase()
    .prepare(
      `
        UPDATE ${TABLE}
        SET applied_bytes=?,
            applied_revision=?,
            applied_epoch=?,
            volume_identity=?,
            state='applied',
            last_error=NULL,
            applied_at=?,
            updated_at=?
        WHERE project_id=?
          AND volume_kind=?
          AND desired_bytes=?
          AND desired_revision=?
      `,
    )
    .run(
      desired_bytes,
      desired_revision,
      epoch,
      volume_identity,
      now,
      now,
      project_id,
      volume_kind,
      desired_bytes,
      desired_revision,
    );
  return Number(result.changes) === 1;
}

export function markProjectVolumeQuotaFailed({
  project_id,
  volume_kind,
  state = "failed",
  error,
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  state?: Extract<ProjectVolumeQuotaState, "blocked" | "failed" | "missing">;
  error: unknown;
}): void {
  ensureTable();
  getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET state=?, last_error=?, updated_at=?
        WHERE project_id=? AND volume_kind=?`,
    )
    .run(state, `${error}`, Date.now(), project_id, volume_kind);
}

export function invalidateProjectVolumeQuota({
  project_id,
  volume_kind,
  reason,
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  reason?: string;
}): void {
  ensureTable();
  getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET state='pending', applied_epoch=NULL, volume_identity=NULL,
              last_error=?, updated_at=?
        WHERE project_id=? AND volume_kind=?`,
    )
    .run(reason ?? null, Date.now(), project_id, volume_kind);
}

export function deleteProjectVolumeQuotas(project_id: string): void {
  ensureTable();
  getDatabase()
    .prepare(`DELETE FROM ${TABLE} WHERE project_id=?`)
    .run(project_id);
}
