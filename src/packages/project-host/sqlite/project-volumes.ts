/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";
import type { ProjectVolumeKind } from "./volume-quotas";

export interface ProjectVolumeRow {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  mountpoint: string;
  relative_path: string;
  filesystem_uuid: string;
  subvolume_id: number;
  volume_uuid: string;
  generation?: number | null;
  present: boolean;
  identity_updated_at: number;
  updated_at: number;
}

export interface ProjectVolumeIdentity {
  filesystem_uuid: string;
  subvolume_id: number;
  volume_uuid: string;
  generation?: number | null;
}

const TABLE = "project_volumes";
const META_TABLE = "project_volume_inventory_meta";
let initialized = false;

function ensureTables(): void {
  if (initialized) return;
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      project_id TEXT NOT NULL,
      volume_kind TEXT NOT NULL,
      mountpoint TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      filesystem_uuid TEXT NOT NULL,
      subvolume_id INTEGER NOT NULL,
      volume_uuid TEXT NOT NULL,
      generation INTEGER,
      present INTEGER NOT NULL,
      identity_updated_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(project_id, volume_kind)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_present_cursor_idx ON ${TABLE}(present, project_id, volume_kind)`,
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${META_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  initialized = true;
}

function parseRow(row: any): ProjectVolumeRow {
  return {
    project_id: `${row.project_id}`,
    volume_kind: row.volume_kind as ProjectVolumeKind,
    mountpoint: `${row.mountpoint}`,
    relative_path: `${row.relative_path}`,
    filesystem_uuid: `${row.filesystem_uuid}`,
    subvolume_id: Number(row.subvolume_id),
    volume_uuid: `${row.volume_uuid}`,
    generation: row.generation == null ? null : Number(row.generation),
    present: Number(row.present) === 1,
    identity_updated_at: Number(row.identity_updated_at),
    updated_at: Number(row.updated_at),
  };
}

export function projectVolumeIdentityKey(
  identity: ProjectVolumeIdentity,
): string {
  return `${identity.filesystem_uuid}:${identity.volume_uuid}:${identity.subvolume_id}`;
}

export function getProjectVolume(
  project_id: string,
  volume_kind: ProjectVolumeKind,
): ProjectVolumeRow | undefined {
  ensureTables();
  const row = getDatabase()
    .prepare(`SELECT * FROM ${TABLE} WHERE project_id=? AND volume_kind=?`)
    .get(project_id, volume_kind);
  return row ? parseRow(row) : undefined;
}

export function getRecordedProjectVolumeIdentity(
  project_id: string,
  volume_kind: ProjectVolumeKind,
): string | undefined {
  const row = getProjectVolume(project_id, volume_kind);
  if (!row?.present) return;
  return projectVolumeIdentityKey(row);
}

export function recordProjectVolume({
  project_id,
  volume_kind,
  mountpoint,
  relative_path,
  identity,
}: {
  project_id: string;
  volume_kind: ProjectVolumeKind;
  mountpoint: string;
  relative_path: string;
  identity: ProjectVolumeIdentity;
}): { changed: boolean; row: ProjectVolumeRow } {
  ensureTables();
  const existing = getProjectVolume(project_id, volume_kind);
  const changed =
    existing == null ||
    !existing.present ||
    existing.mountpoint !== mountpoint ||
    existing.relative_path !== relative_path ||
    projectVolumeIdentityKey(existing) !== projectVolumeIdentityKey(identity);
  const now = Date.now();
  getDatabase()
    .prepare(
      `
        INSERT INTO ${TABLE} (
          project_id, volume_kind, mountpoint, relative_path,
          filesystem_uuid, subvolume_id, volume_uuid, generation,
          present, identity_updated_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(project_id, volume_kind) DO UPDATE SET
          mountpoint=excluded.mountpoint,
          relative_path=excluded.relative_path,
          filesystem_uuid=excluded.filesystem_uuid,
          subvolume_id=excluded.subvolume_id,
          volume_uuid=excluded.volume_uuid,
          generation=excluded.generation,
          present=1,
          identity_updated_at=excluded.identity_updated_at,
          updated_at=excluded.updated_at
      `,
    )
    .run(
      project_id,
      volume_kind,
      mountpoint,
      relative_path,
      identity.filesystem_uuid,
      identity.subvolume_id,
      identity.volume_uuid,
      identity.generation ?? null,
      now,
      now,
    );
  return {
    changed,
    row: getProjectVolume(project_id, volume_kind)!,
  };
}

export function markProjectVolumeAbsent(
  project_id: string,
  volume_kind: ProjectVolumeKind,
): boolean {
  ensureTables();
  const now = Date.now();
  const result = getDatabase()
    .prepare(
      `UPDATE ${TABLE}
          SET present=0, updated_at=?
        WHERE project_id=? AND volume_kind=? AND present=1`,
    )
    .run(now, project_id, volume_kind);
  return Number(result.changes) === 1;
}

export function deleteProjectVolumes(project_id: string): void {
  ensureTables();
  getDatabase()
    .prepare(`DELETE FROM ${TABLE} WHERE project_id=?`)
    .run(project_id);
}

export function listProvisionedProjectIds(): string[] {
  ensureTables();
  return (
    getDatabase()
      .prepare(
        `SELECT project_id
           FROM ${TABLE}
          WHERE volume_kind='home' AND present=1
          ORDER BY project_id`,
      )
      .all() as Array<{ project_id: string }>
  ).map(({ project_id }) => `${project_id}`);
}

export function nextProjectVolumeVerificationBatch(
  limit: number,
): ProjectVolumeRow[] {
  ensureTables();
  const db = getDatabase();
  const cursor = getInventoryMeta("verification_cursor");
  let afterProjectId = "";
  let afterVolumeKind = "";
  if (cursor) {
    try {
      const parsed = JSON.parse(cursor);
      afterProjectId = `${parsed.project_id ?? ""}`;
      afterVolumeKind = `${parsed.volume_kind ?? ""}`;
    } catch {}
  }
  const select = (projectId: string, volumeKind: string) =>
    db
      .prepare(
        `
          SELECT *
            FROM ${TABLE}
           WHERE present=1
             AND (project_id > ? OR (project_id = ? AND volume_kind > ?))
           ORDER BY project_id, volume_kind
           LIMIT ?
        `,
      )
      .all(projectId, projectId, volumeKind, Math.max(1, Math.floor(limit)));
  let rows = select(afterProjectId, afterVolumeKind);
  if (rows.length === 0 && (afterProjectId || afterVolumeKind)) {
    rows = select("", "");
  }
  const parsed = rows.map(parseRow);
  const last = parsed.at(-1);
  if (last) {
    setInventoryMeta(
      "verification_cursor",
      JSON.stringify({
        project_id: last.project_id,
        volume_kind: last.volume_kind,
      }),
    );
  }
  return parsed;
}

export function projectVolumeInventoryBootstrapped(
  filesystem_uuid: string,
): boolean {
  return getInventoryMeta(`bootstrap:${filesystem_uuid}`) === "complete";
}

export function markProjectVolumeInventoryBootstrapped(
  filesystem_uuid: string,
): void {
  setInventoryMeta(`bootstrap:${filesystem_uuid}`, "complete");
}

export function bootstrapProjectVolumeInventory({
  filesystem_uuid,
  mountpoint,
  volumes,
}: {
  filesystem_uuid: string;
  mountpoint: string;
  volumes: Array<{
    project_id: string;
    volume_kind: ProjectVolumeKind;
    mountpoint: string;
    relative_path: string;
    identity: ProjectVolumeIdentity;
  }>;
}): void {
  ensureTables();
  const db = getDatabase();
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO ${TABLE} (
      project_id, volume_kind, mountpoint, relative_path,
      filesystem_uuid, subvolume_id, volume_uuid, generation,
      present, identity_updated_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(project_id, volume_kind) DO UPDATE SET
      mountpoint=excluded.mountpoint,
      relative_path=excluded.relative_path,
      filesystem_uuid=excluded.filesystem_uuid,
      subvolume_id=excluded.subvolume_id,
      volume_uuid=excluded.volume_uuid,
      generation=excluded.generation,
      present=1,
      identity_updated_at=excluded.identity_updated_at,
      updated_at=excluded.updated_at
  `);
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      `UPDATE ${TABLE}
          SET present=0, updated_at=?
        WHERE mountpoint=? AND present=1`,
    ).run(now, mountpoint);
    for (const volume of volumes) {
      upsert.run(
        volume.project_id,
        volume.volume_kind,
        volume.mountpoint,
        volume.relative_path,
        volume.identity.filesystem_uuid,
        volume.identity.subvolume_id,
        volume.identity.volume_uuid,
        volume.identity.generation ?? null,
        now,
        now,
      );
    }
    db.prepare(
      `INSERT INTO ${META_TABLE}(key, value, updated_at)
       VALUES (?, 'complete', ?)
       ON CONFLICT(key) DO UPDATE SET
         value='complete',
         updated_at=excluded.updated_at`,
    ).run(`bootstrap:${filesystem_uuid}`, now);
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

function getInventoryMeta(key: string): string | undefined {
  ensureTables();
  const row = getDatabase()
    .prepare(`SELECT value FROM ${META_TABLE} WHERE key=?`)
    .get(key) as { value?: string } | undefined;
  return row?.value;
}

function setInventoryMeta(key: string, value: string): void {
  ensureTables();
  getDatabase()
    .prepare(
      `INSERT INTO ${META_TABLE}(key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         updated_at=excluded.updated_at`,
    )
    .run(key, value, Date.now());
}

export function resetProjectVolumeTablesForTests(): void {
  initialized = false;
}
