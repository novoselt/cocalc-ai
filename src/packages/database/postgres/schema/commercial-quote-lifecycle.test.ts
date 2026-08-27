/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";
import { testCleanup } from "@cocalc/database/test-utils";
import { COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT } from "@cocalc/util/db-schema/commercial-orders";
import { uuid } from "@cocalc/util/misc";
import {
  commercialQuoteLifecycleSchemaNeedsSync,
  ensureCommercialQuoteLifecycleSchema,
  LEGACY_COMMERCIAL_QUOTE_STATUS_CONSTRAINT,
} from "./commercial-quote-lifecycle";

beforeAll(async () => {
  await initEphemeralDatabase({});
}, 15_000);

afterAll(async () => {
  await testCleanup();
});

describe("commercial quote lifecycle guard", () => {
  it("replaces the legacy status guard and permits document-free drafts", async () => {
    const pool = getPool();
    await pool.query(
      `ALTER TABLE commercial_quotes
         DROP CONSTRAINT IF EXISTS ${COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT}`,
    );
    await pool.query(
      `ALTER TABLE commercial_quotes
         ADD CONSTRAINT ${LEGACY_COMMERCIAL_QUOTE_STATUS_CONSTRAINT}
         CHECK (status IN ('issued','void'))`,
    );

    const client = await pool.connect();
    try {
      expect(await commercialQuoteLifecycleSchemaNeedsSync(client)).toBe(true);
      await ensureCommercialQuoteLifecycleSchema(client);
      expect(await commercialQuoteLifecycleSchemaNeedsSync(client)).toBe(false);
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT conname,convalidated
         FROM pg_constraint
        WHERE conrelid=to_regclass('commercial_quotes')
          AND conname IN ($1,$2)
        ORDER BY conname`,
      [
        COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT,
        LEGACY_COMMERCIAL_QUOTE_STATUS_CONSTRAINT,
      ],
    );
    expect(rows).toEqual([
      {
        conname: COMMERCIAL_QUOTE_LIFECYCLE_CONSTRAINT,
        convalidated: true,
      },
    ]);

    const quoteId = uuid();
    await pool.query(
      `INSERT INTO commercial_quotes
         (id,commercial_order_id,quote_number,status,provider,
          provider_quote_id,provider_status,currency,subtotal,total,
          valid_until,snapshot,provider_snapshot,created_by_account_id,
          idempotency_key,created_at,updated_at)
       VALUES ($1,$2,$3,'draft','stripe',$4,'draft','usd',25,25,
               NOW()+INTERVAL '30 days','{}','{}',$5,$6,NOW(),NOW())`,
      [
        quoteId,
        uuid(),
        `QT-TEST-${quoteId.slice(0, 8)}`,
        "qt_test",
        uuid(),
        uuid(),
      ],
    );
    await pool.query("DELETE FROM commercial_quotes WHERE id=$1", [quoteId]);
  });

  it("requires retained documents for an issued quote", async () => {
    const pool = getPool();
    const quoteId = uuid();
    await expect(
      pool.query(
        `INSERT INTO commercial_quotes
           (id,commercial_order_id,quote_number,status,provider,
            provider_quote_id,provider_status,currency,subtotal,total,
            issued_at,valid_until,snapshot,provider_snapshot,
            created_by_account_id,idempotency_key,created_at,updated_at)
         VALUES ($1,$2,$3,'issued','stripe',$4,'open','usd',25,25,
                 NOW(),NOW()+INTERVAL '30 days','{}','{}',$5,$6,NOW(),NOW())`,
        [
          quoteId,
          uuid(),
          `QT-TEST-${quoteId.slice(0, 8)}`,
          "qt_test",
          uuid(),
          uuid(),
        ],
      ),
    ).rejects.toThrow();
  });
});
