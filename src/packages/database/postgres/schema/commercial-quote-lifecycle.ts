/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";
import {
  COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT,
  COMMERCIAL_QUOTE_LIFECYCLE_EXPRESSION,
} from "@cocalc/util/db-schema/commercial-orders";

type DatabaseClient = Pick<Client, "query">;

export const LEGACY_COMMERCIAL_QUOTE_STATUS_CONSTRAINT =
  "commercial_quotes_status_check";

async function constraintState(db: DatabaseClient): Promise<{
  lifecycle_exists: boolean;
  lifecycle_validated: boolean;
  legacy_exists: boolean;
}> {
  const { rows } = await db.query<{
    lifecycle_exists: boolean;
    lifecycle_validated: boolean;
    legacy_exists: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname=$1 AND contype='c'
            AND conrelid=to_regclass('commercial_quotes')
       ) AS lifecycle_exists,
       COALESCE((
         SELECT convalidated FROM pg_constraint
          WHERE conname=$1 AND contype='c'
            AND conrelid=to_regclass('commercial_quotes')
       ), false) AS lifecycle_validated,
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname=$2 AND contype='c'
            AND conrelid=to_regclass('commercial_quotes')
       ) AS legacy_exists`,
    [
      COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT,
      LEGACY_COMMERCIAL_QUOTE_STATUS_CONSTRAINT,
    ],
  );
  return (
    rows[0] ?? {
      lifecycle_exists: false,
      lifecycle_validated: false,
      legacy_exists: false,
    }
  );
}

export async function ensureCommercialQuoteLifecycleSchema(
  db: DatabaseClient,
): Promise<void> {
  let state = await constraintState(db);
  if (
    state.lifecycle_exists &&
    state.lifecycle_validated &&
    !state.legacy_exists
  ) {
    return;
  }

  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    state = await constraintState(db);
    if (!state.lifecycle_exists) {
      await db.query(
        `ALTER TABLE commercial_quotes
           ADD CONSTRAINT ${COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT}
           CHECK (${COMMERCIAL_QUOTE_LIFECYCLE_EXPRESSION}) NOT VALID`,
      );
    }
    if (!state.lifecycle_validated) {
      await db.query(
        `ALTER TABLE commercial_quotes
           VALIDATE CONSTRAINT ${COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT}`,
      );
    }
    // The old column-level check only allowed issued and void. Remove it only
    // after the complete replacement lifecycle has been validated.
    await db.query(
      `ALTER TABLE commercial_quotes
         DROP CONSTRAINT IF EXISTS ${LEGACY_COMMERCIAL_QUOTE_STATUS_CONSTRAINT}`,
    );
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export async function commercialQuoteLifecycleSchemaNeedsSync(
  db: DatabaseClient,
): Promise<boolean> {
  const state = await constraintState(db);
  return (
    !state.lifecycle_exists || !state.lifecycle_validated || state.legacy_exists
  );
}
