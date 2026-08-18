import { ensureAcpTableMigrated, getAcpDatabase } from "./acp-database";

const TABLE = "acp_runtime_owners";

export interface AcpRuntimeOwnerRow {
  session_id: string;
  worker_id: string;
  project_id: string;
  account_id?: string | null;
  path?: string | null;
  created_at: number;
  updated_at: number;
}

function init(): void {
  const db = getAcpDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      account_id TEXT,
      path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, session_id)
    )
  `);
  // Session ids are local to a project's Codex home. Older databases keyed
  // ownership by session id alone, so cloned projects could steal affinity.
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = db.prepare(`PRAGMA table_info(${TABLE})`).all() as Array<{
      name: string;
      pk: number;
    }>;
    const sessionPk = columns.find(({ name }) => name === "session_id")?.pk;
    const projectPk = columns.find(({ name }) => name === "project_id")?.pk;
    if (sessionPk === 1 && !projectPk) {
      const legacy = `${TABLE}_unscoped`;
      db.exec(`
        ALTER TABLE ${TABLE} RENAME TO ${legacy};
        CREATE TABLE ${TABLE} (
          session_id TEXT NOT NULL,
          worker_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          account_id TEXT,
          path TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, session_id)
        );
        INSERT INTO ${TABLE}
          (session_id, worker_id, project_id, account_id, path, created_at, updated_at)
        SELECT session_id, worker_id, project_id, account_id, path, created_at, updated_at
        FROM ${legacy};
        DROP TABLE ${legacy};
      `);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS acp_runtime_owners_worker_idx ON ${TABLE}(worker_id, updated_at)`,
  );
  ensureAcpTableMigrated(TABLE);
}

let initialized = false;

function ensureInit(): void {
  if (!initialized) {
    init();
    initialized = true;
  }
}

export function upsertAcpRuntimeOwner({
  session_id,
  worker_id,
  project_id,
  account_id,
  path,
}: {
  session_id: string;
  worker_id: string;
  project_id: string;
  account_id?: string | null;
  path?: string | null;
}): AcpRuntimeOwnerRow {
  ensureInit();
  const sessionId = `${session_id ?? ""}`.trim();
  const workerId = `${worker_id ?? ""}`.trim();
  const projectId = `${project_id ?? ""}`.trim();
  if (!sessionId || !workerId || !projectId) {
    throw new Error(
      "ACP runtime ownership requires session_id, worker_id, and project_id",
    );
  }
  const now = Date.now();
  getAcpDatabase()
    .prepare(
      `INSERT INTO ${TABLE}
       (session_id, worker_id, project_id, account_id, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, session_id) DO UPDATE SET
         worker_id = excluded.worker_id,
         account_id = excluded.account_id,
         path = excluded.path,
         updated_at = excluded.updated_at`,
    )
    .run(
      sessionId,
      workerId,
      projectId,
      `${account_id ?? ""}`.trim() || null,
      `${path ?? ""}`.trim() || null,
      now,
      now,
    );
  return getAcpRuntimeOwner({
    project_id: projectId,
    session_id: sessionId,
  })!;
}

export function getAcpRuntimeOwner({
  project_id,
  session_id,
}: {
  project_id?: string | null;
  session_id?: string | null;
}): AcpRuntimeOwnerRow | undefined {
  ensureInit();
  const projectId = `${project_id ?? ""}`.trim();
  const sessionId = `${session_id ?? ""}`.trim();
  if (!projectId || !sessionId) return;
  return getAcpDatabase()
    .prepare(`SELECT * FROM ${TABLE} WHERE project_id = ? AND session_id = ?`)
    .get(projectId, sessionId) as AcpRuntimeOwnerRow | undefined;
}

export function releaseAcpRuntimeOwner({
  project_id,
  session_id,
  worker_id,
}: {
  project_id: string;
  session_id: string;
  worker_id: string;
}): boolean {
  ensureInit();
  const result = getAcpDatabase()
    .prepare(
      `DELETE FROM ${TABLE}
       WHERE project_id = ? AND session_id = ? AND worker_id = ?`,
    )
    .run(
      `${project_id ?? ""}`.trim(),
      `${session_id ?? ""}`.trim(),
      `${worker_id ?? ""}`.trim(),
    );
  return Number(result?.changes ?? 0) > 0;
}

export function releaseAcpRuntimeOwnersForWorker(worker_id: string): number {
  ensureInit();
  const result = getAcpDatabase()
    .prepare(`DELETE FROM ${TABLE} WHERE worker_id = ?`)
    .run(`${worker_id ?? ""}`.trim());
  return Number(result?.changes ?? 0) || 0;
}
