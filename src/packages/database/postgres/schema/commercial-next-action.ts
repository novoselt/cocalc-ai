/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";
import { COMMERCIAL_NEXT_ACTIONS } from "@cocalc/util/commercial-orders";

type DatabaseClient = Pick<Client, "query">;

export const COMMERCIAL_NEXT_ACTION_CONSTRAINT =
  "commercial_orders_next_action_check";

const allowedActionsSql = COMMERCIAL_NEXT_ACTIONS.map(
  (action) => `'${action.replace(/'/g, "''")}'`,
).join(",");

async function constraintState(
  db: DatabaseClient,
): Promise<{ exists: boolean; validated: boolean }> {
  const { rows } = await db.query<{
    exists: boolean;
    validated: boolean;
  }>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname=$1
          AND contype='c'
          AND conrelid=to_regclass('commercial_orders')
     ) AS exists,
     COALESCE((
       SELECT convalidated
         FROM pg_constraint
        WHERE conname=$1
          AND contype='c'
          AND conrelid=to_regclass('commercial_orders')
     ), false) AS validated`,
    [COMMERCIAL_NEXT_ACTION_CONSTRAINT],
  );
  return rows[0] ?? { exists: false, validated: false };
}

// Existing orders predate the standard task vocabulary. Keep terminal orders
// terminal and route any other legacy task to explicit operator review.
async function normalizeLegacyActions(db: DatabaseClient): Promise<void> {
  await db.query(
    `UPDATE commercial_orders
        SET next_action = CASE
          WHEN workflow_state='complete' THEN 'Complete'
          WHEN workflow_state='cancelled' THEN 'Cancelled'
          ELSE 'Resolve exception'
        END,
            updated_at = NOW(),
            version = version + 1
      WHERE next_action NOT IN (${allowedActionsSql})`,
  );
}

export async function ensureCommercialNextActionSchema(
  db: DatabaseClient,
): Promise<void> {
  let state = await constraintState(db);
  if (state.exists && state.validated) return;

  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await normalizeLegacyActions(db);
    state = await constraintState(db);
    if (!state.exists) {
      await db.query(
        `ALTER TABLE commercial_orders
           ADD CONSTRAINT ${COMMERCIAL_NEXT_ACTION_CONSTRAINT}
           CHECK (next_action IN (${allowedActionsSql})) NOT VALID`,
      );
    }
    await db.query(
      `ALTER TABLE commercial_orders
         VALIDATE CONSTRAINT ${COMMERCIAL_NEXT_ACTION_CONSTRAINT}`,
    );
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export async function commercialNextActionSchemaNeedsSync(
  db: DatabaseClient,
): Promise<boolean> {
  const state = await constraintState(db);
  return !state.exists || !state.validated;
}
