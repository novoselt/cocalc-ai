/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";

export const ACCOUNT_NOTIFICATION_REVISION_SEQUENCE =
  "account_notification_index_revision_seq";
export const ACCOUNT_NOTIFICATION_REVISION_TRIGGER =
  "account_notification_index_set_revision_trigger";
const ACCOUNT_NOTIFICATION_REVISION_FUNCTION =
  "account_notification_index_set_revision";
export const ACCOUNT_NOTIFICATION_REVISION_LOCK =
  "account_notification_index_revision";

export async function ensureAccountNotificationRevisionSchema(
  db: Client,
): Promise<void> {
  await db.query(
    `CREATE SEQUENCE IF NOT EXISTS ${ACCOUNT_NOTIFICATION_REVISION_SEQUENCE} AS BIGINT`,
  );
  await db.query(
    `ALTER TABLE account_notification_index
       ALTER COLUMN revision
       DROP DEFAULT`,
  );
  await db.query(
    `CREATE OR REPLACE FUNCTION ${ACCOUNT_NOTIFICATION_REVISION_FUNCTION}()
     RETURNS TRIGGER AS $$
     BEGIN
       IF TG_OP = 'INSERT' OR (
         OLD.kind,
         OLD.project_id,
         OLD.summary,
         OLD.created_at
       ) IS DISTINCT FROM (
         NEW.kind,
         NEW.project_id,
         NEW.summary,
         NEW.created_at
       ) THEN
         PERFORM pg_advisory_xact_lock(
           hashtext('${ACCOUNT_NOTIFICATION_REVISION_LOCK}'),
           hashtext(NEW.account_id::TEXT)
         );
         NEW.revision := nextval('${ACCOUNT_NOTIFICATION_REVISION_SEQUENCE}');
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
  );
  await db.query(
    `DROP TRIGGER IF EXISTS ${ACCOUNT_NOTIFICATION_REVISION_TRIGGER}
       ON account_notification_index`,
  );
  await db.query(
    `CREATE TRIGGER ${ACCOUNT_NOTIFICATION_REVISION_TRIGGER}
       BEFORE INSERT OR UPDATE OF kind, project_id, summary, created_at
       ON account_notification_index
       FOR EACH ROW
       EXECUTE FUNCTION ${ACCOUNT_NOTIFICATION_REVISION_FUNCTION}()`,
  );
}

export async function accountNotificationRevisionSchemaNeedsSync(
  db: Client,
): Promise<boolean> {
  const { rows } = await db.query<{
    sequence_exists: boolean;
    trigger_exists: boolean;
  }>(
    `SELECT
       to_regclass($1) IS NOT NULL AS sequence_exists,
       EXISTS (
         SELECT 1
           FROM pg_trigger
          WHERE tgname = $2
            AND NOT tgisinternal
       ) AS trigger_exists`,
    [
      ACCOUNT_NOTIFICATION_REVISION_SEQUENCE,
      ACCOUNT_NOTIFICATION_REVISION_TRIGGER,
    ],
  );
  const row = rows[0];
  return row?.sequence_exists !== true || row.trigger_exists !== true;
}
