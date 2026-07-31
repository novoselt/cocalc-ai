/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";

export interface ProjectFilesystemQuotaState {
  mountpoint: string;
  filesystem_uuid: string;
  quota_mode: string;
  quota_epoch: number;
  validated_at: number;
  last_error?: string | null;
  updated_at: number;
}

const TABLE = "project_filesystem_quota_state";
let initialized = false;
let activeMountpoint: string | undefined;

function ensureTable(): void {
  if (initialized) return;
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      mountpoint TEXT PRIMARY KEY,
      filesystem_uuid TEXT NOT NULL,
      quota_mode TEXT NOT NULL,
      quota_epoch INTEGER NOT NULL,
      validated_at INTEGER NOT NULL,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  initialized = true;
}

function parseRow(row: any): ProjectFilesystemQuotaState {
  return {
    mountpoint: `${row.mountpoint}`,
    filesystem_uuid: `${row.filesystem_uuid}`,
    quota_mode: `${row.quota_mode}`,
    quota_epoch: Number(row.quota_epoch),
    validated_at: Number(row.validated_at),
    last_error: row.last_error == null ? null : `${row.last_error}`,
    updated_at: Number(row.updated_at),
  };
}

export function getProjectFilesystemQuotaState(
  mountpoint: string,
): ProjectFilesystemQuotaState | undefined {
  ensureTable();
  const row = getDatabase()
    .prepare(`SELECT * FROM ${TABLE} WHERE mountpoint=?`)
    .get(mountpoint);
  return row ? parseRow(row) : undefined;
}

export function reconcileProjectFilesystemQuotaState({
  mountpoint,
  filesystem_uuid,
  quota_mode,
  quota_mode_reconciled = false,
}: {
  mountpoint: string;
  filesystem_uuid: string;
  quota_mode: string;
  quota_mode_reconciled?: boolean;
}): ProjectFilesystemQuotaState {
  ensureTable();
  const existing = getProjectFilesystemQuotaState(mountpoint);
  const changed =
    existing == null ||
    existing.filesystem_uuid !== filesystem_uuid ||
    existing.quota_mode !== quota_mode ||
    quota_mode_reconciled;
  const quota_epoch =
    existing == null
      ? 1
      : changed
        ? Math.max(1, existing.quota_epoch + 1)
        : existing.quota_epoch;
  const now = Date.now();
  getDatabase()
    .prepare(
      `
        INSERT INTO ${TABLE} (
          mountpoint, filesystem_uuid, quota_mode, quota_epoch,
          validated_at, last_error, updated_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(mountpoint) DO UPDATE SET
          filesystem_uuid=excluded.filesystem_uuid,
          quota_mode=excluded.quota_mode,
          quota_epoch=excluded.quota_epoch,
          validated_at=excluded.validated_at,
          last_error=NULL,
          updated_at=excluded.updated_at
      `,
    )
    .run(mountpoint, filesystem_uuid, quota_mode, quota_epoch, now, now);
  activeMountpoint = mountpoint;
  return getProjectFilesystemQuotaState(mountpoint)!;
}

export function currentProjectFilesystemQuotaState():
  | ProjectFilesystemQuotaState
  | undefined {
  ensureTable();
  if (activeMountpoint) {
    return getProjectFilesystemQuotaState(activeMountpoint);
  }
  const row = getDatabase()
    .prepare(`SELECT * FROM ${TABLE} ORDER BY validated_at DESC LIMIT 1`)
    .get();
  return row ? parseRow(row) : undefined;
}

export function currentProjectVolumeQuotaEpoch(): string | undefined {
  const state = currentProjectFilesystemQuotaState();
  if (!state) return;
  return `${state.filesystem_uuid}:${state.quota_epoch}`;
}

export function resetProjectFilesystemQuotaStateForTests(): void {
  activeMountpoint = undefined;
  initialized = false;
}
