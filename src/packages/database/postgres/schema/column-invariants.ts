/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";
import getLogger from "@cocalc/backend/logger";
import type { Client } from "@cocalc/database/pool";
import type { TableSchema } from "./types";
import { quoteField } from "./util";

const log = getLogger("db:schema:column-invariants");
const NULL_BACKFILL_BATCH_SIZE = 10_000;
const FIRST_TID = "(0,0)";

type ColumnState = {
  column_default?: string | null;
  is_nullable?: "YES" | "NO";
};

type NotNullConstraintState = {
  convalidated: boolean;
  definition: string;
};

export type ColumnInvariantAction =
  | { action: "set-default"; column: string; expression: string }
  | {
      action: "set-not-null";
      column: string;
      backfill?: string;
    }
  | { action: "drop-not-null"; column: string }
  | { action: "drop-not-null-guard"; column: string };

function normalizeDefaultExpression(expression: string | null | undefined) {
  // PostgreSQL may normalize whitespace, but quoted literal contents remain
  // case-sensitive. Declare expressions using PostgreSQL's deparsed spelling
  // (for example, `now()` rather than `NOW()`).
  return expression?.trim().replace(/\s+/g, " ");
}

export function notNullGuardName(table: string, column: string): string {
  const digest = createHash("sha256")
    .update(`${table}\0${column}`)
    .digest("hex")
    .slice(0, 12);
  const readable = `${table}_${column}`
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 42);
  return `cocalc_nn_${readable}_${digest}`.slice(0, 63);
}

async function getNotNullGuard(
  db: Client,
  table: string,
  column: string,
): Promise<NotNullConstraintState | undefined> {
  const { rows } = await db.query(
    `SELECT constraint_row.convalidated,
            pg_get_expr(constraint_row.conbin, constraint_row.conrelid) AS definition
       FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = to_regclass($1)
        AND constraint_row.contype = 'c'
        AND constraint_row.conname = $2`,
    [table, notNullGuardName(table, column)],
  );
  return rows[0] as NotNullConstraintState | undefined;
}

async function getNotNullGuards(
  db: Client,
  table: string,
): Promise<Map<string, NotNullConstraintState>> {
  const { rows } = await db.query(
    `SELECT constraint_row.conname,
            constraint_row.convalidated,
            pg_get_expr(constraint_row.conbin, constraint_row.conrelid) AS definition
       FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = to_regclass($1)
        AND constraint_row.contype = 'c'
        AND constraint_row.conname LIKE 'cocalc_nn_%'`,
    [table],
  );
  return new Map(
    rows.map((row) => [
      row.conname,
      {
        convalidated: row.convalidated,
        definition: row.definition,
      },
    ]),
  );
}

export async function getColumnInvariantActions(
  db: Client,
  schema: TableSchema,
): Promise<ColumnInvariantAction[]> {
  const guards = await getNotNullGuards(db, schema.name);
  const hasDeclaredInvariants = Object.keys(schema.fields).some((column) => {
    const info = schema.fields[column];
    return info.pg_default != null || info.not_null != null;
  });
  if (!hasDeclaredInvariants && guards.size === 0) {
    return [];
  }
  const { rows } = await db.query(
    `SELECT column_name, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_name=$1`,
    [schema.name],
  );
  const current = new Map<string, ColumnState>(
    rows.map((row) => [row.column_name, row]),
  );
  const actions: ColumnInvariantAction[] = [];

  for (const column in schema.fields) {
    const info = schema.fields[column];
    const existing = current.get(column);
    const guard = guards.get(notNullGuardName(schema.name, column));
    // Missing columns are handled by the column reconciler. A nullable column
    // added there is picked up on the next invariant pass in the same sync.
    if (existing == null) continue;
    if (
      info.pg_default != null &&
      normalizeDefaultExpression(existing.column_default) !==
        normalizeDefaultExpression(info.pg_default)
    ) {
      actions.push({
        action: "set-default",
        column,
        expression: info.pg_default,
      });
    }
    if (info.not_null === true && existing.is_nullable === "YES") {
      actions.push({
        action: "set-not-null",
        column,
        backfill: info.pg_null_backfill,
      });
    } else if (info.not_null === false && existing.is_nullable === "NO") {
      actions.push({ action: "drop-not-null", column });
    }
    if (info.not_null !== true && guard != null) {
      // An explicit nullable declaration also rolls back an interrupted newer
      // NOT NULL migration before relaxing the column itself.
      actions.push({ action: "drop-not-null-guard", column });
    } else if (existing.is_nullable === "NO" && guard != null) {
      // A process may have stopped after SET NOT NULL but before removing the
      // temporary guard.
      actions.push({ action: "drop-not-null-guard", column });
    }
  }
  return actions;
}

function parseTid(tid: string): [number, number] {
  const match = tid.match(/^\((\d+),(\d+)\)$/);
  if (!match) {
    throw new Error(`invalid PostgreSQL tid '${tid}'`);
  }
  return [Number(match[1]), Number(match[2])];
}

function latestTid(rows: { source_ctid: string }[]): string {
  let latest = FIRST_TID;
  let latestParts = parseTid(latest);
  for (const { source_ctid } of rows) {
    const parts = parseTid(source_ctid);
    if (
      parts[0] > latestParts[0] ||
      (parts[0] === latestParts[0] && parts[1] > latestParts[1])
    ) {
      latest = source_ctid;
      latestParts = parts;
    }
  }
  return latest;
}

async function hasNullRows(
  db: Client,
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM ${quoteField(table)} WHERE ${quoteField(column)} IS NULL
     ) AS exists`,
  );
  return rows[0]?.exists === true;
}

async function backfillNullRows({
  db,
  table,
  column,
  expression,
}: {
  db: Client;
  table: string;
  column: string;
  expression: string;
}): Promise<void> {
  const qTable = quoteField(table);
  const qColumn = quoteField(column);
  let cursor = FIRST_TID;
  let total = 0;

  while (true) {
    const { rows } = await db.query(
      `WITH batch AS MATERIALIZED (
         SELECT ctid AS source_ctid
           FROM ${qTable}
          WHERE ctid > $1::tid AND ${qColumn} IS NULL
          ORDER BY ctid
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       UPDATE ${qTable} AS target
          SET ${qColumn}=${expression}
         FROM batch
        WHERE target.ctid=batch.source_ctid
       RETURNING batch.source_ctid::text AS source_ctid`,
      [cursor, NULL_BACKFILL_BATCH_SIZE],
    );
    if (rows.length > 0) {
      total += rows.length;
      cursor = latestTid(rows as { source_ctid: string }[]);
      continue;
    }
    if (!(await hasNullRows(db, table, column))) {
      if (total > 0) {
        log.info("finished null backfill", { table, column, rows: total });
      }
      return;
    }
    // Rows skipped because another transaction held their row locks are now
    // the only remaining candidates. Start another pass rather than allowing
    // validation to race or fail spuriously.
    cursor = FIRST_TID;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function isExpectedNotNullGuard(definition: string, column: string): boolean {
  const normalized = definition.replace(/[()\s"]/g, "").toLowerCase();
  return normalized === `${column.toLowerCase()}isnotnull`;
}

async function ensureNotNull({
  db,
  table,
  column,
  backfill,
}: {
  db: Client;
  table: string;
  column: string;
  backfill?: string;
}): Promise<void> {
  const qTable = quoteField(table);
  const qColumn = quoteField(column);
  const guard = notNullGuardName(table, column);
  const qGuard = quoteField(guard);
  let state = await getNotNullGuard(db, table, column);
  if (state == null) {
    // NOT VALID avoids scanning old rows, but PostgreSQL immediately enforces
    // the check for all new writes. That closes the race between backfill and
    // promoting the column to NOT NULL.
    await db.query(
      `ALTER TABLE ${qTable} ADD CONSTRAINT ${qGuard} CHECK (${qColumn} IS NOT NULL) NOT VALID`,
    );
    state = { convalidated: false, definition: `(${qColumn} IS NOT NULL)` };
  } else if (!isExpectedNotNullGuard(state.definition, column)) {
    throw new Error(
      `schema sync constraint ${guard} on ${table}.${column} has an unexpected definition: ${state.definition}`,
    );
  }

  if (backfill != null) {
    await backfillNullRows({ db, table, column, expression: backfill });
  } else if (await hasNullRows(db, table, column)) {
    throw new Error(
      `cannot set ${table}.${column} NOT NULL while NULL rows remain; declare pg_null_backfill`,
    );
  }

  if (!state.convalidated) {
    await db.query(`ALTER TABLE ${qTable} VALIDATE CONSTRAINT ${qGuard}`);
  }

  // PostgreSQL can use the validated check to avoid another full-table scan.
  // Keep SET NOT NULL and guard cleanup atomic so a restart observes either a
  // resumable validated guard or the final column invariant.
  await db.query("BEGIN");
  try {
    await db.query(
      `ALTER TABLE ${qTable} ALTER COLUMN ${qColumn} SET NOT NULL`,
    );
    await db.query(`ALTER TABLE ${qTable} DROP CONSTRAINT ${qGuard}`);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

export async function syncTableSchemaColumnInvariants(
  db: Client,
  schema: TableSchema,
): Promise<void> {
  const qTable = quoteField(schema.name);
  const actions = await getColumnInvariantActions(db, schema);
  for (const action of actions) {
    const column = quoteField(action.column);
    if (action.action === "set-default") {
      await db.query(
        `ALTER TABLE ${qTable} ALTER COLUMN ${column} SET DEFAULT ${action.expression}`,
      );
    } else if (action.action === "set-not-null") {
      await ensureNotNull({
        db,
        table: schema.name,
        column: action.column,
        backfill: action.backfill,
      });
    } else if (action.action === "drop-not-null") {
      await db.query(
        `ALTER TABLE ${qTable} ALTER COLUMN ${column} DROP NOT NULL`,
      );
    } else {
      await db.query(
        `ALTER TABLE ${qTable} DROP CONSTRAINT ${quoteField(
          notNullGuardName(schema.name, action.column),
        )}`,
      );
    }
  }
}
