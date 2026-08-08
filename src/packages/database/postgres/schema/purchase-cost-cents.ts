/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { type Client } from "@cocalc/database/pool";

type DatabaseClient = Pick<Client, "query">;

export const PURCHASE_COST_CENTS_CONSTRAINT =
  "purchases_cost_must_be_whole_cents";
export const PURCHASE_COST_CENTS_TRIGGER =
  "purchases_require_whole_cent_cost_trigger";
const PURCHASE_COST_CENTS_FUNCTION = "purchases_require_whole_cent_cost";

type PurchaseCostCentsGuard = "constraint" | "trigger" | "none";

export interface PurchaseCostCentsAccountImpact {
  account_id: string;
  balance_before: string;
  balance_after: string;
  balance_delta: string;
  balance_would_change: boolean;
  would_become_negative: boolean;
}

export interface PurchaseCostCentsMigrationResult {
  executed: boolean;
  guard_before: PurchaseCostCentsGuard;
  affected_account_ids: string[];
  fractional_purchases: number;
  account_impacts: PurchaseCostCentsAccountImpact[];
  affected_statement_ids: number[];
  externalized_statement_ids: number[];
  normalized_purchases: number;
  reconciled_statements: number;
}

export interface PurchaseCostCentsMigrationOptions {
  execute?: boolean;
  allowBalanceChanges?: boolean;
  allowStatementRewrites?: boolean;
}

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

async function getGuard(db: DatabaseClient): Promise<PurchaseCostCentsGuard> {
  if (await constraintExists(db)) return "constraint";
  return (await triggerExists(db)) ? "trigger" : "none";
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

// Install a forward-looking guard only. Existing fractional rows are preserved
// until an operator explicitly reviews and runs the offline migration below.
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

async function inspectPurchaseCostCentsMigration(
  db: DatabaseClient,
): Promise<PurchaseCostCentsMigrationResult> {
  const guard_before = await getGuard(db);
  const { rows: purchaseCountRows } = await db.query<{
    fractional_purchases: number;
  }>(
    `SELECT COUNT(*)::int AS fractional_purchases
       FROM purchases
      WHERE cost IS NOT NULL
        AND cost <> ROUND(cost, 2)`,
  );
  const { rows: accountImpacts } = await db.query<
    PurchaseCostCentsAccountImpact & {
      balance_before: unknown;
      balance_after: unknown;
      balance_delta: unknown;
    }
  >(
    `WITH affected AS (
       SELECT DISTINCT account_id
         FROM purchases
        WHERE cost IS NOT NULL
          AND cost <> ROUND(cost, 2)
     ), balances AS (
       SELECT affected.account_id,
              ROUND(
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
                ),
                2
              ) AS balance_before,
              ROUND(
                -COALESCE(
                  SUM(
                    COALESCE(
                      ROUND(purchases.cost, 2),
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
                ),
                2
              ) AS balance_after
         FROM affected
         LEFT JOIN purchases
           ON purchases.account_id=affected.account_id
        GROUP BY affected.account_id
     )
     SELECT account_id,
            balance_before::text,
            balance_after::text,
            (balance_after - balance_before)::text AS balance_delta,
            balance_after <> balance_before AS balance_would_change,
            balance_before >= 0 AND balance_after < 0
              AS would_become_negative
       FROM balances
      ORDER BY account_id`,
  );
  const { rows: statementRows } = await db.query<{
    id: number;
    externalized: boolean;
  }>(
    `SELECT statements.id,
            (
              statements.last_sent IS NOT NULL OR
              statements.automatic_payment IS NOT NULL OR
              statements.automatic_payment_intent_id IS NOT NULL OR
              statements.paid_purchase_id IS NOT NULL
            ) AS externalized
       FROM statements
      WHERE statements.account_id IN (
        SELECT DISTINCT account_id
          FROM purchases
         WHERE cost IS NOT NULL
           AND cost <> ROUND(cost, 2)
      )
      ORDER BY statements.id`,
  );
  const account_impacts = accountImpacts.map((row) => ({
    ...row,
    balance_before: `${row.balance_before}`,
    balance_after: `${row.balance_after}`,
    balance_delta: `${row.balance_delta}`,
  }));
  return {
    executed: false,
    guard_before,
    affected_account_ids: account_impacts.map(({ account_id }) => account_id),
    fractional_purchases:
      Number(purchaseCountRows[0]?.fractional_purchases) || 0,
    account_impacts,
    affected_statement_ids: statementRows.map(({ id }) => Number(id)),
    externalized_statement_ids: statementRows
      .filter(({ externalized }) => externalized)
      .map(({ id }) => Number(id)),
    normalized_purchases: 0,
    reconciled_statements: 0,
  };
}

function assertMigrationApproved({
  report,
  allowBalanceChanges,
  allowStatementRewrites,
}: {
  report: PurchaseCostCentsMigrationResult;
  allowBalanceChanges: boolean;
  allowStatementRewrites: boolean;
}): void {
  const changedAccounts = report.account_impacts.filter(
    ({ balance_would_change }) => balance_would_change,
  );
  if (changedAccounts.length && !allowBalanceChanges) {
    throw Error(
      `migration would change ${changedAccounts.length} account balance(s); review the dry-run report and pass --allow-balance-changes`,
    );
  }
  if (report.affected_statement_ids.length && !allowStatementRewrites) {
    throw Error(
      `migration would rewrite ${report.affected_statement_ids.length} statement(s), including ${report.externalized_statement_ids.length} sent or payment-linked statement(s); review the dry-run report and pass --allow-statement-rewrites`,
    );
  }
}

export async function migratePurchaseCostsToCents(
  db: DatabaseClient,
  {
    execute = false,
    allowBalanceChanges = false,
    allowStatementRewrites = false,
  }: PurchaseCostCentsMigrationOptions = {},
): Promise<PurchaseCostCentsMigrationResult> {
  if (!execute) {
    return await inspectPurchaseCostCentsMigration(db);
  }

  await db.query("BEGIN");
  try {
    // This migration is intentionally offline-only. A short lock timeout makes
    // a mistaken attempt against a live cluster fail instead of causing an
    // open-ended production outage.
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query(
      "LOCK TABLE purchases, statements, accounts IN ACCESS EXCLUSIVE MODE",
    );
    const report = await inspectPurchaseCostCentsMigration(db);
    assertMigrationApproved({
      report,
      allowBalanceChanges,
      allowStatementRewrites,
    });
    if (report.guard_before === "constraint") {
      await db.query("COMMIT");
      return { ...report, executed: true };
    }

    const { rows: normalizedPurchases } = await db.query<{ id: number }>(
      `UPDATE purchases
          SET cost=ROUND(cost, 2)
        WHERE cost IS NOT NULL
          AND cost <> ROUND(cost, 2)
      RETURNING id`,
    );
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
          WHERE statements.account_id = ANY($1::uuid[])
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
      [report.affected_account_ids],
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
          WHERE account_id = ANY($1::uuid[])
       )
       UPDATE statements AS target
          SET balance=cumulative.balance
         FROM cumulative
        WHERE target.id=cumulative.id`,
      [report.affected_account_ids],
    );
    await db.query(
      `WITH balances AS (
         SELECT accounts.account_id,
                ROUND(
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
                  ),
                  2
                ) AS balance
           FROM accounts
           LEFT JOIN purchases
             ON purchases.account_id=accounts.account_id
          WHERE accounts.account_id = ANY($1::uuid[])
          GROUP BY accounts.account_id
       )
       UPDATE accounts AS target
          SET balance=balances.balance
         FROM balances
        WHERE target.account_id=balances.account_id`,
      [report.affected_account_ids],
    );
    await db.query(
      `ALTER TABLE purchases
         ADD CONSTRAINT ${PURCHASE_COST_CENTS_CONSTRAINT}
         CHECK (cost IS NULL OR cost=ROUND(cost, 2))`,
    );
    await dropPurchaseCostCentsTrigger(db);
    await db.query("COMMIT");
    return {
      ...report,
      executed: true,
      normalized_purchases: normalizedPurchases.length,
      reconciled_statements: reconciledStatements.length,
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

export async function runPurchaseCostCentsMigration(
  options: PurchaseCostCentsMigrationOptions = {},
): Promise<PurchaseCostCentsMigrationResult> {
  const client = await getPool().connect();
  try {
    return await migratePurchaseCostsToCents(client, options);
  } finally {
    client.release();
  }
}

export async function purchaseCostCentsSchemaNeedsSync(
  db: DatabaseClient,
): Promise<boolean> {
  const hasConstraint = await constraintExists(db);
  const hasTrigger = await triggerExists(db);
  return hasConstraint ? hasTrigger : !hasTrigger;
}
