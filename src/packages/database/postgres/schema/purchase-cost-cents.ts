/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";

export const PURCHASE_COST_CENTS_TRIGGER =
  "purchases_require_whole_cent_cost_trigger";
const PURCHASE_COST_CENTS_FUNCTION = "purchases_require_whole_cent_cost";

export async function ensurePurchaseCostCentsSchema(db: Client): Promise<void> {
  await db.query(
    `CREATE OR REPLACE FUNCTION ${PURCHASE_COST_CENTS_FUNCTION}()
     RETURNS TRIGGER AS $$
     BEGIN
       IF TG_OP = 'INSERT' THEN
         IF NEW.cost IS NOT NULL AND NEW.cost <> ROUND(NEW.cost, 2) THEN
           RAISE EXCEPTION 'purchase cost must be a whole-cent amount'
             USING ERRCODE = '23514';
         END IF;
       ELSIF NEW.cost IS DISTINCT FROM OLD.cost THEN
         IF NEW.cost IS NOT NULL AND NEW.cost <> ROUND(NEW.cost, 2) THEN
           RAISE EXCEPTION 'purchase cost must be a whole-cent amount'
             USING ERRCODE = '23514';
         END IF;
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
  );
  await db.query(
    `DROP TRIGGER IF EXISTS ${PURCHASE_COST_CENTS_TRIGGER} ON purchases`,
  );
  await db.query(
    `CREATE TRIGGER ${PURCHASE_COST_CENTS_TRIGGER}
       BEFORE INSERT OR UPDATE OF cost
       ON purchases
       FOR EACH ROW
       EXECUTE FUNCTION ${PURCHASE_COST_CENTS_FUNCTION}()`,
  );
}

export async function purchaseCostCentsSchemaNeedsSync(
  db: Client,
): Promise<boolean> {
  const { rows } = await db.query<{ trigger_exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_trigger
        WHERE tgname = $1
          AND NOT tgisinternal
     ) AS trigger_exists`,
    [PURCHASE_COST_CENTS_TRIGGER],
  );
  return rows[0]?.trigger_exists !== true;
}
