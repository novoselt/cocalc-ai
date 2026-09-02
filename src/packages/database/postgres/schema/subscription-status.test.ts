/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import { uuid } from "@cocalc/util/misc";
import {
  ensureSubscriptionStatusSchema,
  SUBSCRIPTION_STATUS_CONSTRAINT,
  subscriptionStatusSchemaNeedsSync,
} from "./subscription-status";

beforeAll(async () => {
  await initEphemeralDatabase({});
}, 15_000);

afterAll(async () => {
  await testCleanup();
});

describe("personal subscription statuses", () => {
  it("normalizes historical nonrenewing states before enforcing the constraint", async () => {
    const pool = getPool();
    const client = await pool.connect();
    const accountIds = [uuid(), uuid(), uuid(), uuid(), uuid()];
    const activeAccountId = accountIds[3];
    const canceledAccountId = accountIds[4];
    try {
      await client.query(
        `ALTER TABLE subscriptions DROP CONSTRAINT ${SUBSCRIPTION_STATUS_CONSTRAINT}`,
      );
      await expect(subscriptionStatusSchemaNeedsSync(client)).resolves.toBe(
        true,
      );
      await client.query(
        `INSERT INTO subscriptions
           (account_id, status, canceled_reason, payment)
         VALUES
           ($1, 'unpaid', NULL, '{"status":"active"}'::jsonb),
           ($2, 'past_due', 'Existing audit reason', NULL),
           ($3, NULL, NULL, NULL),
           ($4, 'active', NULL, '{"status":"paid"}'::jsonb),
           ($5, 'canceled', 'User selected Free', NULL)`,
        accountIds,
      );
      await client.query(
        `UPDATE subscriptions
            SET metadata=jsonb_build_object(
              'type', 'membership',
              'class', 'basic',
              'pending_plan_change', jsonb_build_object(
                'kind', 'downgrade',
                'previous_class', 'standard',
                'previous_interval', 'year',
                'scheduled_at', '2026-09-01T00:00:00.000Z'
              )
            )
          WHERE account_id=$1`,
        [activeAccountId],
      );

      await ensureSubscriptionStatusSchema(client);
      await expect(subscriptionStatusSchemaNeedsSync(client)).resolves.toBe(
        false,
      );

      const { rows } = await client.query(
        `SELECT status, canceled_at, canceled_reason, payment
           FROM subscriptions
          WHERE account_id=ANY($1::uuid[])
          ORDER BY account_id`,
        [accountIds],
      );
      expect(rows).toHaveLength(5);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "canceled",
            canceled_at: expect.any(Date),
            canceled_reason: "Legacy unpaid subscription state retired",
            payment: { status: "canceled" },
          }),
          expect.objectContaining({
            status: "canceled",
            canceled_at: expect.any(Date),
            canceled_reason: "Existing audit reason",
          }),
          expect.objectContaining({
            status: "canceled",
            canceled_at: expect.any(Date),
            canceled_reason: "Legacy subscription without status retired",
          }),
          expect.objectContaining({
            status: "active",
            canceled_at: null,
            canceled_reason: null,
            payment: { status: "paid" },
          }),
          expect.objectContaining({
            status: "canceled",
            canceled_at: null,
            canceled_reason: "User selected Free",
          }),
        ]),
      );

      const { rows: activeRows } = await client.query(
        `SELECT metadata
           FROM subscriptions
          WHERE account_id=$1`,
        [activeAccountId],
      );
      expect(activeRows[0]?.metadata?.pending_plan_change).toMatchObject({
        kind: "downgrade",
        previous_class: "standard",
      });

      const { rows: canceledRows } = await client.query(
        `SELECT status
           FROM subscriptions
          WHERE account_id=$1`,
        [canceledAccountId],
      );
      expect(canceledRows).toEqual([{ status: "canceled" }]);
    } finally {
      await client.query(
        "DELETE FROM subscriptions WHERE account_id=ANY($1::uuid[])",
        [accountIds],
      );
      client.release();
    }
  });

  it("rejects subscription states outside active and canceled", async () => {
    await expect(
      getPool().query(
        "INSERT INTO subscriptions (account_id, status) VALUES ($1, 'unpaid')",
        [uuid()],
      ),
    ).rejects.toThrow();
  });
});
