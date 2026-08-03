/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";

export interface ProjectPortLeaseRow {
  project_id: string;
  ssh_port: number;
  http_port: number;
  updated_at?: number;
}

export interface AcquireProjectPortLeaseOptions {
  rotate?: boolean;
  avoidOffsets?: Iterable<number>;
}

export const SSH_PORT_LEASE_START = 30_000;
export const HTTP_PORT_LEASE_START = 45_000;
export const PROJECT_PORT_LEASE_CAPACITY = 15_000;
export const PROJECT_PORT_BIND_FAILURE_COOLDOWN_MS = 10 * 60_000;

function ensureProjectPortLeasesTable(): void {
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_port_leases (
      project_id TEXT PRIMARY KEY,
      ssh_port INTEGER NOT NULL UNIQUE,
      http_port INTEGER NOT NULL UNIQUE,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_port_cooldowns (
      offset INTEGER PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS project_port_leases_ssh_idx ON project_port_leases(ssh_port)",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS project_port_leases_http_idx ON project_port_leases(http_port)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS project_port_cooldowns_expires_idx ON project_port_cooldowns(expires_at)",
  );
}

function offsetFromSshPort(port?: number | null): number | undefined {
  if (!Number.isInteger(port)) return;
  const offset = Number(port) - SSH_PORT_LEASE_START;
  if (offset < 0 || offset >= PROJECT_PORT_LEASE_CAPACITY) return;
  return offset;
}

function offsetFromHttpPort(port?: number | null): number | undefined {
  if (!Number.isInteger(port)) return;
  const offset = Number(port) - HTTP_PORT_LEASE_START;
  if (offset < 0 || offset >= PROJECT_PORT_LEASE_CAPACITY) return;
  return offset;
}

export function projectPortOffsetFromSshPort(
  port?: number | null,
): number | undefined {
  return offsetFromSshPort(port);
}

export function projectPortOffsetFromHttpPort(
  port?: number | null,
): number | undefined {
  return offsetFromHttpPort(port);
}

export function projectPortLeasePreferredOffset(project_id: string): number {
  // FNV-1a distributes first probes across the fixed port range. This avoids
  // walking a dense prefix as the host accumulates projects.
  let hash = 0x811c9dc5;
  for (let i = 0; i < project_id.length; i += 1) {
    hash ^= project_id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PROJECT_PORT_LEASE_CAPACITY;
}

function projectPortOffsetIsActive(
  project_id: string,
  offset: number,
): boolean {
  const db = getDatabase();
  try {
    const row = db
      .prepare(
        `
          SELECT 1
          FROM projects
          WHERE project_id != ?
            AND state IN ('running', 'starting')
            AND (ssh_port = ? OR http_port = ?)
          LIMIT 1
        `,
      )
      .get(
        project_id,
        SSH_PORT_LEASE_START + offset,
        HTTP_PORT_LEASE_START + offset,
      );
    return row != null;
  } catch {
    // The projects table may not exist yet during early startup/tests.
    return false;
  }
}

function projectPortOffsetIsCooling(offset: number, now: number): boolean {
  const db = getDatabase();
  db.prepare(
    "DELETE FROM project_port_cooldowns WHERE offset=? AND expires_at<=?",
  ).run(offset, now);
  return (
    db
      .prepare(
        "SELECT 1 FROM project_port_cooldowns WHERE offset=? AND expires_at>?",
      )
      .get(offset, now) != null
  );
}

export function getProjectPortLease(
  project_id: string,
): ProjectPortLeaseRow | undefined {
  ensureProjectPortLeasesTable();
  const db = getDatabase();
  return db
    .prepare(
      `
        SELECT project_id, ssh_port, http_port, updated_at
        FROM project_port_leases
        WHERE project_id=?
      `,
    )
    .get(project_id) as ProjectPortLeaseRow | undefined;
}

export function getProjectPortLeaseBySshPort(
  ssh_port: number,
): ProjectPortLeaseRow | undefined {
  ensureProjectPortLeasesTable();
  const db = getDatabase();
  return db
    .prepare(
      `
        SELECT project_id, ssh_port, http_port, updated_at
        FROM project_port_leases
        WHERE ssh_port=?
      `,
    )
    .get(ssh_port) as ProjectPortLeaseRow | undefined;
}

export function getProjectPortLeaseByHttpPort(
  http_port: number,
): ProjectPortLeaseRow | undefined {
  ensureProjectPortLeasesTable();
  const db = getDatabase();
  return db
    .prepare(
      `
        SELECT project_id, ssh_port, http_port, updated_at
        FROM project_port_leases
        WHERE http_port=?
      `,
    )
    .get(http_port) as ProjectPortLeaseRow | undefined;
}

function pruneExpiredProjectPortCooldowns(now = Date.now()): void {
  ensureProjectPortLeasesTable();
  const db = getDatabase();
  db.prepare(
    `
      DELETE FROM project_port_cooldowns
      WHERE expires_at <= ?
    `,
  ).run(now);
}

export function getCoolingProjectPortOffsets(now = Date.now()): Set<number> {
  ensureProjectPortLeasesTable();
  pruneExpiredProjectPortCooldowns(now);
  const db = getDatabase();
  const rows = db
    .prepare(
      `
        SELECT offset
        FROM project_port_cooldowns
        WHERE expires_at > ?
      `,
    )
    .all(now) as Array<{ offset: number }>;
  const offsets = new Set<number>();
  for (const row of rows) {
    if (Number.isInteger(row.offset)) {
      offsets.add(Number(row.offset));
    }
  }
  return offsets;
}

export function coolDownProjectPortOffset(
  offset: number,
  opts?: { ttlMs?: number },
): void {
  if (!Number.isInteger(offset)) return;
  const normalizedOffset = Number(offset);
  if (normalizedOffset < 0 || normalizedOffset >= PROJECT_PORT_LEASE_CAPACITY) {
    return;
  }
  ensureProjectPortLeasesTable();
  const now = Date.now();
  const expiresAt =
    now + (opts?.ttlMs ?? PROJECT_PORT_BIND_FAILURE_COOLDOWN_MS);
  const db = getDatabase();
  db.prepare(
    `
      INSERT INTO project_port_cooldowns(offset, expires_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(offset) DO UPDATE SET
        expires_at=excluded.expires_at,
        updated_at=excluded.updated_at
    `,
  ).run(normalizedOffset, expiresAt, now);
}

export function acquireProjectPortLease(
  project_id: string,
  opts?: AcquireProjectPortLeaseOptions,
): ProjectPortLeaseRow {
  ensureProjectPortLeasesTable();
  const db = getDatabase();
  const previous = getProjectPortLease(project_id);
  if (!opts?.rotate) {
    if (previous) return previous;
  } else {
    db.prepare("DELETE FROM project_port_leases WHERE project_id=?").run(
      project_id,
    );
  }

  const avoidOffsets = new Set<number>();
  if (opts?.rotate) {
    const previousSshOffset = offsetFromSshPort(previous?.ssh_port);
    if (previousSshOffset != null) avoidOffsets.add(previousSshOffset);
    const previousHttpOffset = offsetFromHttpPort(previous?.http_port);
    if (previousHttpOffset != null) avoidOffsets.add(previousHttpOffset);
  }
  for (const offset of opts?.avoidOffsets ?? []) {
    if (Number.isInteger(offset)) {
      avoidOffsets.add(Number(offset));
    }
  }

  const preferredOffset = projectPortLeasePreferredOffset(project_id);
  for (let probe = 0; probe < PROJECT_PORT_LEASE_CAPACITY; probe += 1) {
    const offset = (preferredOffset + probe) % PROJECT_PORT_LEASE_CAPACITY;
    if (avoidOffsets.has(offset)) continue;
    const now = Date.now();
    if (projectPortOffsetIsCooling(offset, now)) continue;
    if (projectPortOffsetIsActive(project_id, offset)) continue;
    const row: ProjectPortLeaseRow = {
      project_id,
      ssh_port: SSH_PORT_LEASE_START + offset,
      http_port: HTTP_PORT_LEASE_START + offset,
      updated_at: now,
    };
    const inserted = db
      .prepare(
        `
          INSERT OR IGNORE INTO project_port_leases(
            project_id, ssh_port, http_port, updated_at
          )
          VALUES (?, ?, ?, ?)
        `,
      )
      .run(row.project_id, row.ssh_port, row.http_port, row.updated_at);
    if (Number(inserted.changes) === 1) {
      return row;
    }
    const concurrent = getProjectPortLease(project_id);
    if (concurrent) return concurrent;
  }

  throw new Error(
    `exhausted project port leases; no free slot among ${PROJECT_PORT_LEASE_CAPACITY} reserved project port pairs`,
  );
}

export function releaseProjectPortLease(project_id: string): void {
  ensureProjectPortLeasesTable();
  const db = getDatabase();
  db.prepare("DELETE FROM project_port_leases WHERE project_id=?").run(
    project_id,
  );
}
