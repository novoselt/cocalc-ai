/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getDatabase, initDatabase } from "@cocalc/lite/hub/sqlite/database";
import type {
  EncryptedProjectSecretValue,
  ProjectSecretRuntimeCacheEntry,
} from "@cocalc/util/project-secrets";

export interface CachedProjectSecretRow {
  project_id: string;
  name: string;
  encrypted_value: EncryptedProjectSecretValue;
  value_bytes: number;
  updated_at: number;
}

export interface CachedProjectSecretsState {
  project_id: string;
  cached_generation: number;
  materialized_generation: number;
}

function ensureProjectSecretsTable(): void {
  const db = initDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_secrets (
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      value_bytes INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, name)
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS project_secrets_project_id_idx ON project_secrets(project_id)",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_secrets_state (
      project_id TEXT PRIMARY KEY,
      cached_generation INTEGER NOT NULL DEFAULT 0,
      materialized_generation INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function updatedAtMs(value?: string | number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function replaceCachedProjectSecrets({
  project_id,
  generation,
  entries,
}: {
  project_id: string;
  generation: number;
  entries: ProjectSecretRuntimeCacheEntry[];
}): { accepted: boolean; state: CachedProjectSecretsState } {
  ensureProjectSecretsTable();
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO project_secrets(project_id, name, encrypted_value, value_bytes, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    const current = getCachedProjectSecretsState(project_id);
    if (generation < current.cached_generation) {
      db.exec("COMMIT");
      return { accepted: false, state: current };
    }
    if (generation === current.cached_generation) {
      db.exec("COMMIT");
      return { accepted: true, state: current };
    }
    db.prepare("DELETE FROM project_secrets WHERE project_id=?").run(
      project_id,
    );
    for (const entry of entries) {
      insert.run(
        project_id,
        entry.name,
        JSON.stringify(entry.encrypted_value),
        entry.value_bytes,
        updatedAtMs(entry.updated_at),
      );
    }
    db.prepare(
      `INSERT INTO project_secrets_state(project_id, cached_generation, materialized_generation)
       VALUES (?, ?, 0)
       ON CONFLICT(project_id) DO UPDATE SET
         cached_generation=excluded.cached_generation`,
    ).run(project_id, generation);
    db.exec("COMMIT");
    return {
      accepted: true,
      state: getCachedProjectSecretsState(project_id),
    };
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw err;
  }
}

export function getCachedProjectSecretsState(
  project_id: string,
): CachedProjectSecretsState {
  ensureProjectSecretsTable();
  const row = getDatabase()
    .prepare(
      `SELECT project_id, cached_generation, materialized_generation
       FROM project_secrets_state WHERE project_id=?`,
    )
    .get(project_id) as any;
  return {
    project_id,
    cached_generation: Number(row?.cached_generation ?? 0),
    materialized_generation: Number(row?.materialized_generation ?? 0),
  };
}

export function markCachedProjectSecretsMaterialized({
  project_id,
  generation,
}: {
  project_id: string;
  generation: number;
}): CachedProjectSecretsState {
  ensureProjectSecretsTable();
  getDatabase()
    .prepare(
      `INSERT INTO project_secrets_state(project_id, cached_generation, materialized_generation)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         materialized_generation=CASE
           WHEN excluded.materialized_generation <= project_secrets_state.cached_generation
           THEN MAX(
             project_secrets_state.materialized_generation,
             excluded.materialized_generation
           )
           ELSE project_secrets_state.materialized_generation
         END`,
    )
    .run(project_id, generation, generation);
  return getCachedProjectSecretsState(project_id);
}

export function getCachedProjectSecrets(
  project_id: string,
): CachedProjectSecretRow[] {
  ensureProjectSecretsTable();
  const rows = getDatabase()
    .prepare(
      `SELECT project_id, name, encrypted_value, value_bytes, updated_at
       FROM project_secrets
       WHERE project_id=?
       ORDER BY name`,
    )
    .all(project_id);
  return rows.map((row: any) => ({
    project_id: row.project_id,
    name: row.name,
    encrypted_value: JSON.parse(row.encrypted_value),
    value_bytes: Number(row.value_bytes ?? 0),
    updated_at: Number(row.updated_at ?? 0),
  }));
}
