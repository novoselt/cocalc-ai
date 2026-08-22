/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { v4 as uuid } from "uuid";

import getPool from "@cocalc/database/pool";
import { isValidUUID } from "@cocalc/util/misc";

const TABLE = "account_resource_quarantine_audit_log";

let schemaPromise: Promise<void> | undefined;

function normalizeReason(reason?: string | null): string | null {
  const trimmed = `${reason ?? ""}`.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

export async function ensureAccountResourceQuarantineAuditLogSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          id UUID PRIMARY KEY,
          account_id UUID NOT NULL,
          actor_account_id UUID,
          reason TEXT,
          result JSONB NOT NULL DEFAULT '{}'::jsonb,
          created TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        ALTER TABLE ${TABLE}
          ADD COLUMN IF NOT EXISTS created TIMESTAMPTZ
      `);
      // Older deployments created this column as a nullable timestamp without
      // a default. Serialize reconciliation across hub processes and interpret
      // any legacy wall-clock values as UTC during the type conversion.
      await pool.query(`
        DO $$
        DECLARE
          created_type TEXT;
        BEGIN
          LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;
          SELECT data_type
            INTO created_type
            FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = '${TABLE}'
             AND column_name = 'created';

          IF created_type = 'timestamp without time zone' THEN
            ALTER TABLE ${TABLE}
              ALTER COLUMN created TYPE TIMESTAMPTZ
              USING created AT TIME ZONE 'UTC';
          ELSIF created_type <> 'timestamp with time zone' THEN
            RAISE EXCEPTION 'unexpected %.created type: %', '${TABLE}', created_type;
          END IF;

          UPDATE ${TABLE}
             SET created = NOW()
           WHERE created IS NULL;
          ALTER TABLE ${TABLE}
            ALTER COLUMN created SET DEFAULT NOW(),
            ALTER COLUMN created SET NOT NULL;
        END
        $$
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${TABLE}_account_id_idx ON ${TABLE} (account_id)`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${TABLE}_actor_account_id_idx ON ${TABLE} (actor_account_id)`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${TABLE}_created_idx ON ${TABLE} (created)`,
      );
    })().catch((err) => {
      schemaPromise = undefined;
      throw err;
    });
  }
  await schemaPromise;
}

export async function recordAccountResourceQuarantineAuditEvent({
  account_id,
  actor_account_id,
  reason,
  result,
}: {
  account_id: string;
  actor_account_id?: string | null;
  reason?: string | null;
  result?: Record<string, unknown> | null;
}): Promise<void> {
  if (!isValidUUID(account_id)) {
    throw new Error("account_id must be a valid uuid");
  }
  const actor =
    actor_account_id && isValidUUID(actor_account_id) ? actor_account_id : null;
  await ensureAccountResourceQuarantineAuditLogSchema();
  await getPool().query(
    `INSERT INTO ${TABLE}
       (id, account_id, actor_account_id, reason, result, created)
     VALUES
       ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [
      uuid(),
      account_id,
      actor,
      normalizeReason(reason),
      JSON.stringify(result ?? {}),
    ],
  );
}
