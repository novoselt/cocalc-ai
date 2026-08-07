/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import { uuid } from "@cocalc/util/misc";
import {
  ensurePurchaseCostCentsSchema,
  PURCHASE_COST_CENTS_CONSTRAINT,
  purchaseCostCentsSchemaNeedsSync,
} from "./purchase-cost-cents";

beforeAll(async () => {
  await initEphemeralDatabase({});
}, 15_000);

afterAll(async () => {
  await testCleanup();
});

describe("purchase cost whole-cent migration", () => {
  it("normalizes legacy purchases and reconciles derived accounting state", async () => {
    const pool = getPool();
    const account_id = uuid();
    const last_sent = new Date("2026-07-02T02:00:00.000Z");
    await pool.query(
      `ALTER TABLE purchases
         DROP CONSTRAINT IF EXISTS ${PURCHASE_COST_CENTS_CONSTRAINT}`,
    );
    await pool.query(
      "DROP TRIGGER IF EXISTS purchases_require_whole_cent_cost_trigger ON purchases",
    );
    await pool.query(
      "DROP FUNCTION IF EXISTS purchases_require_whole_cent_cost()",
    );
    await pool.query(
      "INSERT INTO accounts (account_id, email_address, balance) VALUES ($1, $2, 999)",
      [account_id, `${account_id}@example.com`],
    );

    const { rows: dayStatements } = await pool.query<{ id: number }>(
      `INSERT INTO statements
         (interval, account_id, time, balance, total_charges, num_charges,
          total_credits, num_credits, last_sent)
       VALUES
         ('day', $1, '2026-07-02T00:00:00Z', -0.01, 0.01, 2, 0, 0, $2),
         ('day', $1, '2026-07-03T00:00:00Z', 0, 0, 0, -0.01, 1, NULL)
       RETURNING id`,
      [account_id, last_sent],
    );
    const { rows: monthStatements } = await pool.query<{ id: number }>(
      `INSERT INTO statements
         (interval, account_id, time, balance, total_charges, num_charges,
          total_credits, num_credits)
       VALUES
         ('month', $1, '2026-08-01T00:00:00Z', 0, 0.01, 2, -0.01, 1)
       RETURNING id`,
      [account_id],
    );
    const [firstDay, secondDay] = dayStatements;
    const [month] = monthStatements;

    await pool.query(
      `INSERT INTO purchases
         (time, account_id, cost, service, description,
          day_statement_id, month_statement_id)
       VALUES
         ('2026-07-01T01:00:00Z', $1, 0.005, 'dedicated-host', '{}', $2, $4),
         ('2026-07-01T02:00:00Z', $1, 0.005, 'dedicated-host', '{}', $2, $4),
         ('2026-07-02T01:00:00Z', $1, -0.005, 'refund', '{}', $3, $4)`,
      [account_id, firstDay.id, secondDay.id, month.id],
    );
    await pool.query(
      `INSERT INTO purchases
         (time, account_id, cost, cost_so_far, period_start, service,
          description)
       VALUES (NOW(), $1, NULL, 0.006, NOW(), 'dedicated-host', '{}')`,
      [account_id],
    );

    const client = await pool.connect();
    try {
      const result = await ensurePurchaseCostCentsSchema(client);
      expect(result).toEqual({
        affected_account_ids: [account_id],
        normalized_purchases: 3,
        reconciled_statements: 3,
      });
    } finally {
      client.release();
    }

    const { rows: purchases } = await pool.query(
      `SELECT cost, cost_so_far
         FROM purchases
        WHERE account_id=$1
        ORDER BY time`,
      [account_id],
    );
    expect(purchases).toEqual([
      { cost: "0.0100000000", cost_so_far: null },
      { cost: "0.0100000000", cost_so_far: null },
      { cost: "-0.0100000000", cost_so_far: null },
      { cost: null, cost_so_far: "0.0060000000" },
    ]);

    const { rows: statements } = await pool.query(
      `SELECT id, interval, balance, total_charges, num_charges,
              total_credits, num_credits, last_sent
         FROM statements
        WHERE account_id=$1
        ORDER BY id`,
      [account_id],
    );
    expect(statements).toEqual([
      {
        id: firstDay.id,
        interval: "day",
        balance: "-0.0200000000",
        total_charges: "0.0200000000",
        num_charges: 2,
        total_credits: "0.0000000000",
        num_credits: 0,
        last_sent,
      },
      {
        id: secondDay.id,
        interval: "day",
        balance: "-0.0100000000",
        total_charges: "0.0000000000",
        num_charges: 0,
        total_credits: "-0.0100000000",
        num_credits: 1,
        last_sent: null,
      },
      {
        id: month.id,
        interval: "month",
        balance: "-0.0100000000",
        total_charges: "0.0200000000",
        num_charges: 2,
        total_credits: "-0.0100000000",
        num_credits: 1,
        last_sent: null,
      },
    ]);

    const { rows: accounts } = await pool.query(
      "SELECT balance FROM accounts WHERE account_id=$1",
      [account_id],
    );
    expect(accounts[0].balance).toBe("-0.0200000000");
    await expect(
      pool.query(
        `INSERT INTO purchases
           (time, account_id, cost, service, description)
         VALUES (NOW(), $1, 0.001, 'dedicated-host', '{}')`,
        [account_id],
      ),
    ).rejects.toThrow();

    const secondClient = await pool.connect();
    try {
      expect(await purchaseCostCentsSchemaNeedsSync(secondClient)).toBe(false);
      await expect(
        ensurePurchaseCostCentsSchema(secondClient),
      ).resolves.toEqual({
        affected_account_ids: [],
        normalized_purchases: 0,
        reconciled_statements: 0,
      });
    } finally {
      secondClient.release();
    }
  });
});
