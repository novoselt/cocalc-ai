/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";

type DatabaseClient = Pick<Client, "query">;

export const PURCHASE_COST_CENTS_CONSTRAINT =
  "purchases_cost_must_be_whole_cents";
export const PURCHASE_COST_CENTS_TRIGGER =
  "purchases_require_whole_cent_cost_trigger";
const PURCHASE_COST_CENTS_FUNCTION = "purchases_require_whole_cent_cost";

async function constraintExists(db: DatabaseClient): Promise<boolean> {
  const { rows } = await db.query<{ constraint_exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname=$1
          AND contype='c'
          AND conrelid='purchases'::regclass
          AND convalidated
     ) AS constraint_exists`,
    [PURCHASE_COST_CENTS_CONSTRAINT],
  );
  return rows[0]?.constraint_exists === true;
}

async function triggerExists(db: DatabaseClient): Promise<boolean> {
  const { rows } = await db.query<{ trigger_exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_trigger
        WHERE tgname=$1
          AND tgrelid='purchases'::regclass
          AND NOT tgisinternal
     ) AS trigger_exists`,
    [PURCHASE_COST_CENTS_TRIGGER],
  );
  return rows[0]?.trigger_exists === true;
}

async function dropPurchaseCostCentsTrigger(db: DatabaseClient): Promise<void> {
  await db.query(
    `DROP TRIGGER IF EXISTS ${PURCHASE_COST_CENTS_TRIGGER} ON purchases`,
  );
  await db.query(`DROP FUNCTION IF EXISTS ${PURCHASE_COST_CENTS_FUNCTION}()`);
}

async function installPurchaseCostCentsTrigger(
  db: DatabaseClient,
): Promise<void> {
  await db.query(
    `CREATE OR REPLACE FUNCTION ${PURCHASE_COST_CENTS_FUNCTION}()
     RETURNS TRIGGER AS $$
     BEGIN
       IF TG_OP = 'INSERT' THEN
         NEW.cost := ROUND(NEW.cost, 2);
       ELSIF NEW.cost IS DISTINCT FROM OLD.cost THEN
         NEW.cost := ROUND(NEW.cost, 2);
       END IF;
       RETURN NEW;
     END;
     $$ LANGUAGE plpgsql`,
  );
  await db.query(
    `CREATE TRIGGER ${PURCHASE_COST_CENTS_TRIGGER}
       BEFORE INSERT OR UPDATE OF cost
       ON purchases
       FOR EACH ROW
       EXECUTE FUNCTION ${PURCHASE_COST_CENTS_FUNCTION}()`,
  );
}

async function withShortSchemaLock(
  db: DatabaseClient,
  fn: () => Promise<void>,
): Promise<void> {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await fn();
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// Install a forward-looking guard without rewriting legacy fractional rows.
// Sites whose ledger is already normalized use the permanent check constraint;
// older sites retain the compatibility trigger until an operator normalizes it.
export async function ensurePurchaseCostCentsSchema(
  db: DatabaseClient,
): Promise<void> {
  if (await constraintExists(db)) {
    if (await triggerExists(db)) {
      await withShortSchemaLock(db, async () => {
        await dropPurchaseCostCentsTrigger(db);
      });
    }
    return;
  }
  if (await triggerExists(db)) return;

  await withShortSchemaLock(db, async () => {
    await installPurchaseCostCentsTrigger(db);
  });
}

// PostgreSQL does not allow altering a column type while a trigger definition
// depends on that column. Keep the guard transition atomic so a failed schema
// change rolls back to the original trigger rather than leaving writes
// unguarded.
export async function withPurchaseCostCentsTriggerSuspended<T>(
  db: DatabaseClient,
  fn: () => Promise<T>,
): Promise<T> {
  if (!(await triggerExists(db))) {
    return await fn();
  }

  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await dropPurchaseCostCentsTrigger(db);
    const result = await fn();
    if (!(await constraintExists(db))) {
      await installPurchaseCostCentsTrigger(db);
    }
    await db.query("COMMIT");
    return result;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export async function purchaseCostCentsSchemaNeedsSync(
  db: DatabaseClient,
): Promise<boolean> {
  const hasConstraint = await constraintExists(db);
  const hasTrigger = await triggerExists(db);
  return hasConstraint ? hasTrigger : !hasTrigger;
}
