/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import { toDecimal } from "@cocalc/util/money";
import { uuid } from "@cocalc/util/misc";
import {
  ensurePurchaseCostCentsSchema,
  migratePurchaseCostsToCents,
  PURCHASE_COST_CENTS_CONSTRAINT,
  PURCHASE_COST_CENTS_TRIGGER,
  purchaseCostCentsSchemaNeedsSync,
} from "./purchase-cost-cents";

beforeAll(async () => {
  await initEphemeralDatabase({});
}, 15_000);

afterAll(async () => {
  await testCleanup();
});

async function dropPurchaseCostGuard(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `ALTER TABLE purchases
       DROP CONSTRAINT IF EXISTS ${PURCHASE_COST_CENTS_CONSTRAINT}`,
  );
  await pool.query(
    `DROP TRIGGER IF EXISTS ${PURCHASE_COST_CENTS_TRIGGER} ON purchases`,
  );
  await pool.query(
    "DROP FUNCTION IF EXISTS purchases_require_whole_cent_cost()",
  );
}

describe("purchase cost whole-cent guard and migration", () => {
  it("normalizes new writes without rewriting legacy fractional costs", async () => {
    const pool = getPool();
    const account_id = uuid();
    await dropPurchaseCostGuard();
    try {
      await pool.query(
        "INSERT INTO accounts (account_id, email_address, balance) VALUES ($1, $2, 0)",
        [account_id, `${account_id}@example.com`],
      );
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO purchases
           (time, account_id, cost, service, description)
         VALUES (NOW(), $1, 0.005, 'dedicated-host', '{}')
         RETURNING id`,
        [account_id],
      );

      const client = await pool.connect();
      try {
        await ensurePurchaseCostCentsSchema(client);
        expect(await purchaseCostCentsSchemaNeedsSync(client)).toBe(false);
      } finally {
        client.release();
      }

      await expect(
        pool.query("UPDATE purchases SET notes='preserved' WHERE id=$1", [
          rows[0].id,
        ]),
      ).resolves.toBeDefined();
      const legacy = await pool.query(
        "SELECT cost, notes FROM purchases WHERE id=$1",
        [rows[0].id],
      );
      expect(legacy.rows[0]).toEqual({
        cost: "0.0050000000",
        notes: "preserved",
      });
      const inserted = await pool.query(
        `INSERT INTO purchases
           (time, account_id, cost, service, description)
         VALUES (NOW(), $1, 0.006, 'dedicated-host', '{}')
         RETURNING cost`,
        [account_id],
      );
      expect(inserted.rows[0].cost).toBe("0.0100000000");
      const updated = await pool.query(
        "UPDATE purchases SET cost=0.004 WHERE id=$1 RETURNING cost",
        [rows[0].id],
      );
      expect(updated.rows[0].cost).toBe("0.0000000000");
    } finally {
      await pool.query("DELETE FROM purchases WHERE account_id=$1", [
        account_id,
      ]);
      await pool.query("DELETE FROM accounts WHERE account_id=$1", [
        account_id,
      ]);
    }
  });

  it("reports and gates balance-changing statement rewrites", async () => {
    const pool = getPool();
    const account_id = uuid();
    const last_sent = new Date("2026-07-02T02:00:00.000Z");
    await dropPurchaseCostGuard();
    try {
      await pool.query(
        "INSERT INTO accounts (account_id, email_address, balance) VALUES ($1, $2, 999)",
        [account_id, `${account_id}@example.com`],
      );
      const { rows: statementRows } = await pool.query<{ id: number }>(
        `INSERT INTO statements
           (interval, account_id, time, balance, total_charges, num_charges,
            total_credits, num_credits, last_sent)
         VALUES ('day', $1, '2026-07-02T00:00:00Z', 0, 0.01, 2,
                 -0.01, 1, $2)
         RETURNING id`,
        [account_id, last_sent],
      );
      const statement_id = statementRows[0].id;
      await pool.query(
        `INSERT INTO purchases
           (time, account_id, cost, service, description, day_statement_id)
         VALUES
           ('2026-07-01T01:00:00Z', $1, 0.005, 'dedicated-host', '{}', $2),
           ('2026-07-01T02:00:00Z', $1, 0.005, 'dedicated-host', '{}', $2),
           ('2026-07-01T03:00:00Z', $1, -0.01, 'refund', '{}', $2)`,
        [account_id, statement_id],
      );

      const client = await pool.connect();
      try {
        await ensurePurchaseCostCentsSchema(client);
        const preview = await migratePurchaseCostsToCents(client);
        expect(preview).toMatchObject({
          executed: false,
          guard_before: "trigger",
          affected_account_ids: [account_id],
          fractional_purchases: 2,
          affected_statement_ids: [statement_id],
          externalized_statement_ids: [statement_id],
          normalized_purchases: 0,
          reconciled_statements: 0,
        });
        expect(preview.account_impacts).toHaveLength(1);
        expect(preview.account_impacts[0]).toMatchObject({
          account_id,
          balance_would_change: true,
          would_become_negative: true,
        });
        expect(
          toDecimal(preview.account_impacts[0].balance_before).toNumber(),
        ).toBe(0);
        expect(
          toDecimal(preview.account_impacts[0].balance_after).toNumber(),
        ).toBe(-0.01);

        await expect(
          migratePurchaseCostsToCents(client, { execute: true }),
        ).rejects.toThrow("--allow-balance-changes");
        await expect(
          migratePurchaseCostsToCents(client, {
            execute: true,
            allowBalanceChanges: true,
          }),
        ).rejects.toThrow("--allow-statement-rewrites");
        await expect(
          migratePurchaseCostsToCents(client, {
            execute: true,
            allowBalanceChanges: true,
            allowStatementRewrites: true,
          }),
        ).resolves.toMatchObject({
          executed: true,
          normalized_purchases: 2,
          reconciled_statements: 1,
        });
        expect(await purchaseCostCentsSchemaNeedsSync(client)).toBe(false);
      } finally {
        client.release();
      }

      const purchases = await pool.query(
        `SELECT cost
           FROM purchases
          WHERE account_id=$1
          ORDER BY time`,
        [account_id],
      );
      expect(purchases.rows).toEqual([
        { cost: "0.0100000000" },
        { cost: "0.0100000000" },
        { cost: "-0.0100000000" },
      ]);
      const statements = await pool.query(
        `SELECT balance, total_charges, total_credits, last_sent
           FROM statements
          WHERE id=$1`,
        [statement_id],
      );
      expect(statements.rows[0]).toEqual({
        balance: "-0.0100000000",
        total_charges: "0.0200000000",
        total_credits: "-0.0100000000",
        last_sent,
      });
      const accounts = await pool.query(
        "SELECT balance FROM accounts WHERE account_id=$1",
        [account_id],
      );
      expect(accounts.rows[0].balance).toBe("-0.0100000000");
      await expect(
        pool.query(
          `INSERT INTO purchases
             (time, account_id, cost, service, description)
           VALUES (NOW(), $1, 0.001, 'dedicated-host', '{}')`,
          [account_id],
        ),
      ).rejects.toThrow(PURCHASE_COST_CENTS_CONSTRAINT);
    } finally {
      await pool.query("DELETE FROM purchases WHERE account_id=$1", [
        account_id,
      ]);
      await pool.query("DELETE FROM statements WHERE account_id=$1", [
        account_id,
      ]);
      await pool.query("DELETE FROM accounts WHERE account_id=$1", [
        account_id,
      ]);
    }
  });
});
