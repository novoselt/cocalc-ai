/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import { uuid } from "@cocalc/util/misc";
import {
  commercialNextActionSchemaNeedsSync,
  COMMERCIAL_NEXT_ACTION_CONSTRAINT,
  ensureCommercialNextActionSchema,
} from "./commercial-next-action";

beforeAll(async () => {
  await initEphemeralDatabase({});
}, 15_000);

afterAll(async () => {
  await testCleanup();
});

describe("commercial next-action guard", () => {
  it("normalizes legacy tasks and rejects new ad hoc tasks", async () => {
    const pool = getPool();
    const id = uuid();
    await pool.query(
      `ALTER TABLE commercial_orders
         DROP CONSTRAINT IF EXISTS ${COMMERCIAL_NEXT_ACTION_CONSTRAINT}`,
    );
    await pool.query(
      `INSERT INTO commercial_orders
         (id,order_number,organization_name,workflow_state,collection_mode,
          collection_state,fulfillment_state,currency,agreed_subtotal,
          agreed_total,terms_snapshot,next_action,next_action_due_at,
          created_by_account_id,created_at,updated_at,version)
       VALUES ($1,$2,'Legacy Test','draft','stripe_invoice','not_invoiced',
               'not_provisioned','usd',1,1,'{}','Call Alice about PO',NOW(),
               $3,NOW(),NOW(),1)`,
      [id, `AR-TEST-${id.slice(0, 8)}`, uuid()],
    );

    const client = await pool.connect();
    try {
      expect(await commercialNextActionSchemaNeedsSync(client)).toBe(true);
      await ensureCommercialNextActionSchema(client);
      expect(await commercialNextActionSchemaNeedsSync(client)).toBe(false);
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      "SELECT next_action,version FROM commercial_orders WHERE id=$1",
      [id],
    );
    expect(rows[0]).toEqual({ next_action: "Resolve exception", version: 2 });
    await expect(
      pool.query(
        "UPDATE commercial_orders SET next_action='Email customer tomorrow' WHERE id=$1",
        [id],
      ),
    ).rejects.toThrow();

    await pool.query("DELETE FROM commercial_orders WHERE id=$1", [id]);
  });
});
