/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";

export const PURCHASE_COST_CENTS_CONSTRAINT =
  "purchases_cost_must_be_whole_cents";

// Removed after upgrading databases that briefly used the trigger-based guard.
const LEGACY_PURCHASE_COST_CENTS_TRIGGER =
  "purchases_require_whole_cent_cost_trigger";
const LEGACY_PURCHASE_COST_CENTS_FUNCTION = "purchases_require_whole_cent_cost";

export interface PurchaseCostCentsMigrationResult {
  affected_account_ids: string[];
  normalized_purchases: number;
  reconciled_statements: number;
}

async function constraintExists(db: Client): Promise<boolean> {
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

async function dropLegacyTrigger(db: Client): Promise<void> {
  await db.query(
    `DROP TRIGGER IF EXISTS ${LEGACY_PURCHASE_COST_CENTS_TRIGGER} ON purchases`,
  );
  await db.query(
    `DROP FUNCTION IF EXISTS ${LEGACY_PURCHASE_COST_CENTS_FUNCTION}()`,
  );
}

export async function ensurePurchaseCostCentsSchema(
  db: Client,
): Promise<PurchaseCostCentsMigrationResult> {
  if (await constraintExists(db)) {
    await dropLegacyTrigger(db);
    return {
      affected_account_ids: [],
      normalized_purchases: 0,
      reconciled_statements: 0,
    };
  }

  await db.query("BEGIN");
  try {
    // This is a one-time ledger migration. Lock all derived accounting state so
    // purchases, statements, and cached balances change as one atomic unit.
    await db.query(
      "LOCK TABLE purchases, statements, accounts IN ACCESS EXCLUSIVE MODE",
    );
    // Another hub may have completed the migration while this one waited for
    // the table locks during a rolling deployment.
    if (await constraintExists(db)) {
      await dropLegacyTrigger(db);
      await db.query("COMMIT");
      return {
        affected_account_ids: [],
        normalized_purchases: 0,
        reconciled_statements: 0,
      };
    }
    await db.query(
      `CREATE TEMP TABLE purchase_cost_cents_affected_accounts
         ON COMMIT DROP AS
       SELECT DISTINCT account_id
         FROM purchases
        WHERE cost IS NOT NULL
          AND cost <> ROUND(cost, 2)`,
    );

    const { rows: affectedAccounts } = await db.query<{
      account_id: string;
    }>(
      `SELECT account_id
         FROM purchase_cost_cents_affected_accounts
        ORDER BY account_id`,
    );
    const { rows: normalizedPurchases } = await db.query<{ id: number }>(
      `UPDATE purchases
          SET cost=ROUND(cost, 2)
        WHERE cost IS NOT NULL
          AND cost <> ROUND(cost, 2)
      RETURNING id`,
    );

    // Reconcile statements in place so their ids, delivery history, and
    // payment metadata remain intact.
    const { rows: reconciledStatements } = await db.query<{ id: number }>(
      `WITH totals AS (
         SELECT statements.id,
                COALESCE(
                  SUM(purchases.cost) FILTER (WHERE purchases.cost > 0),
                  0
                ) AS total_charges,
                COUNT(purchases.id) FILTER (
                  WHERE purchases.cost > 0
                )::integer AS num_charges,
                COALESCE(
                  SUM(purchases.cost) FILTER (WHERE purchases.cost < 0),
                  0
                ) AS total_credits,
                COUNT(purchases.id) FILTER (
                  WHERE purchases.cost < 0
                )::integer AS num_credits
           FROM statements
           LEFT JOIN purchases
             ON purchases.account_id=statements.account_id
            AND (
              (statements.interval='day' AND
               purchases.day_statement_id=statements.id)
              OR
              (statements.interval='month' AND
               purchases.month_statement_id=statements.id)
            )
          WHERE statements.account_id IN (
            SELECT account_id
              FROM purchase_cost_cents_affected_accounts
          )
          GROUP BY statements.id
       )
       UPDATE statements AS target
          SET total_charges=totals.total_charges,
              num_charges=totals.num_charges,
              total_credits=totals.total_credits,
              num_credits=totals.num_credits
         FROM totals
        WHERE target.id=totals.id
      RETURNING target.id`,
    );

    await db.query(
      `WITH cumulative AS (
         SELECT id,
                -SUM(total_charges + total_credits) OVER (
                  PARTITION BY account_id, interval
                  ORDER BY id
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS balance
           FROM statements
          WHERE account_id IN (
            SELECT account_id
              FROM purchase_cost_cents_affected_accounts
          )
       )
       UPDATE statements AS target
          SET balance=cumulative.balance
         FROM cumulative
        WHERE target.id=cumulative.id`,
    );

    await db.query(
      `WITH balances AS (
         SELECT affected.account_id,
                -COALESCE(
                  SUM(
                    COALESCE(
                      purchases.cost,
                      ROUND(
                        COALESCE(
                          purchases.cost_so_far,
                          purchases.cost_per_hour * (
                            EXTRACT(
                              EPOCH FROM (
                                COALESCE(purchases.period_end, NOW()) -
                                purchases.period_start
                              )
                            )::numeric / 3600
                          )
                        ),
                        2
                      )
                    )
                  ),
                  0
                ) AS balance
           FROM purchase_cost_cents_affected_accounts AS affected
           LEFT JOIN purchases
             ON purchases.account_id=affected.account_id
          GROUP BY affected.account_id
       )
       UPDATE accounts AS target
          SET balance=balances.balance
         FROM balances
        WHERE target.account_id=balances.account_id`,
    );

    await db.query(
      `ALTER TABLE purchases
         ADD CONSTRAINT ${PURCHASE_COST_CENTS_CONSTRAINT}
         CHECK (cost IS NULL OR cost=ROUND(cost, 2))`,
    );
    await dropLegacyTrigger(db);
    await db.query("COMMIT");
    return {
      affected_account_ids: affectedAccounts.map(
        ({ account_id }) => `${account_id}`,
      ),
      normalized_purchases: normalizedPurchases.length,
      reconciled_statements: reconciledStatements.length,
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export async function purchaseCostCentsSchemaNeedsSync(
  db: Client,
): Promise<boolean> {
  return !(await constraintExists(db));
}
