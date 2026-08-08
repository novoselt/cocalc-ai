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
  PURCHASE_COST_CENTS_TRIGGER,
  purchaseCostCentsSchemaNeedsSync,
  withPurchaseCostCentsTriggerSuspended,
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

describe("purchase cost whole-cent guard", () => {
  it("restores the trigger atomically around cost type changes", async () => {
    const pool = getPool();
    await dropPurchaseCostGuard();
    const client = await pool.connect();
    try {
      await ensurePurchaseCostCentsSchema(client);
      await withPurchaseCostCentsTriggerSuspended(client, async () => {
        await client.query(
          "ALTER TABLE purchases ALTER COLUMN cost TYPE numeric(21,10)",
        );
      });
      expect(await purchaseCostCentsSchemaNeedsSync(client)).toBe(false);

      await expect(
        withPurchaseCostCentsTriggerSuspended(client, async () => {
          throw new Error("simulated schema failure");
        }),
      ).rejects.toThrow("simulated schema failure");
      expect(await purchaseCostCentsSchemaNeedsSync(client)).toBe(false);
    } finally {
      await withPurchaseCostCentsTriggerSuspended(client, async () => {
        await client.query(
          "ALTER TABLE purchases ALTER COLUMN cost TYPE numeric(20,10)",
        );
      });
      client.release();
    }
  });

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
});
