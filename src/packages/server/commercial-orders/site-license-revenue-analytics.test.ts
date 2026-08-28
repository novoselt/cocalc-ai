/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  getTransactionClient,
  initEphemeralDatabase,
  type PoolClient,
} from "@cocalc/database/pool";
import { uuid } from "@cocalc/util/misc";
import { getSiteLicenseRevenueAnalytics } from "./site-license-revenue-analytics";

describe("site license revenue analytics", () => {
  let client: PoolClient;
  const actor = uuid();

  beforeAll(async () => {
    await initEphemeralDatabase({});
    client = await getTransactionClient();
    await client.query(
      "INSERT INTO accounts (account_id,email_address) VALUES ($1,$2)",
      [actor, `${actor}@example.com`],
    );
  }, 30_000);

  afterAll(async () => {
    await client.query("ROLLBACK");
    client.release();
  });

  async function insertOrder({
    subtotal,
    siteSubtotal = subtotal,
    collectionMode = "manual_invoice",
    workflowState = "ready_to_invoice",
    startsAt = "2026-07-01T00:00:00Z",
    endsAt = "2026-07-03T00:00:00Z",
  }: {
    subtotal: string;
    siteSubtotal?: string;
    collectionMode?: string;
    workflowState?: string;
    startsAt?: string;
    endsAt?: string;
  }): Promise<string> {
    const id = uuid();
    await client.query(
      `INSERT INTO commercial_orders
        (id,order_number,organization_name,workflow_state,collection_mode,
         collection_state,fulfillment_state,currency,agreed_subtotal,
         agreed_total,service_starts_at,service_ends_at,next_action,
         next_action_due_at,approved_at,approved_by_account_id,
         cancelled_at,created_by_account_id)
       VALUES ($1,$2,'Example University',$3,$4,'not_invoiced',
               'not_provisioned','usd',$5,$5,$6,$7,$8,$9,$10,$11,$12,$11)`,
      [
        id,
        `AR-${id.slice(0, 8)}`,
        workflowState,
        collectionMode,
        subtotal,
        startsAt,
        endsAt,
        workflowState === "cancelled" ? "Cancelled" : "Create invoice",
        workflowState === "cancelled" ? null : "2026-07-10T00:00:00Z",
        "2026-06-20T00:00:00Z",
        actor,
        workflowState === "cancelled" ? "2026-06-25T00:00:00Z" : null,
      ],
    );
    await client.query(
      `INSERT INTO commercial_order_items
        (id,commercial_order_id,position,description,quantity,unit_amount,
         subtotal,service_start,service_end,product_kind)
       VALUES ($1,$2,0,'Site license',1,$3,$3,$4,$5,'site_license')`,
      [uuid(), id, siteSubtotal, startsAt, endsAt],
    );
    if (siteSubtotal !== subtotal) {
      const remainder = (Number(subtotal) - Number(siteSubtotal)).toFixed(2);
      await client.query(
        `INSERT INTO commercial_order_items
          (id,commercial_order_id,position,description,quantity,unit_amount,
           subtotal,service_start,service_end,product_kind)
         VALUES ($1,$2,1,'Consulting',1,$3,$3,$4,$5,'consulting')`,
        [uuid(), id, remainder, startsAt, endsAt],
      );
    }
    return id;
  }

  it("keeps contracted, invoiced, and collected values distinct", async () => {
    const contractOrder = await insertOrder({ subtotal: "1.01" });
    const mixedOrder = await insertOrder({
      subtotal: "200.00",
      siteSubtotal: "150.00",
      startsAt: "2026-08-01T00:00:00Z",
      endsAt: "2026-08-03T00:00:00Z",
    });
    await client.query(
      `INSERT INTO commercial_invoices
        (id,commercial_order_id,provider,status,currency,subtotal,tax,total,
         amount_due,amount_paid,sent_at,idempotency_key)
       VALUES ($1,$2,'manual','open','usd','200.00','20.00','220.00',
               '220.00','0','2026-07-04T15:00:00Z',$3)`,
      [uuid(), mixedOrder, `invoice:${mixedOrder}`],
    );
    await client.query(
      `INSERT INTO commercial_payments
        (id,commercial_order_id,provider,amount,currency,status,received_at,
         method,recorded_by_account_id,evidence_reference,idempotency_key)
       VALUES ($1,$2,'manual','220.00','usd','succeeded',
               '2026-07-05T20:00:00Z','wire',$3,'bank statement',$4)`,
      [uuid(), mixedOrder, actor, `payment:${mixedOrder}`],
    );

    const result = await getSiteLicenseRevenueAnalytics({
      request: {
        reason: "test site license analytics",
        start: "2026-07-01",
        end: "2026-08-04",
      },
      client,
      now: new Date("2026-08-04T12:00:00Z"),
    });

    expect(result.rows).toEqual([
      {
        day: "2026-07-01",
        measure: "contracted",
        amount_cents: 51,
        source_count: 1,
      },
      {
        day: "2026-07-02",
        measure: "contracted",
        amount_cents: 50,
        source_count: 1,
      },
      {
        day: "2026-07-04",
        measure: "invoiced",
        amount_cents: 15_000,
        source_count: 1,
      },
      {
        day: "2026-07-05",
        measure: "collected",
        amount_cents: 16_500,
        source_count: 1,
      },
      {
        day: "2026-08-01",
        measure: "contracted",
        amount_cents: 7_500,
        source_count: 1,
      },
      {
        day: "2026-08-02",
        measure: "contracted",
        amount_cents: 7_500,
        source_count: 1,
      },
    ]);
    expect(contractOrder).toBeTruthy();
  });

  it("excludes non-revenue contracts and invalid invoices and payments", async () => {
    const cancelled = await insertOrder({
      subtotal: "100.00",
      workflowState: "cancelled",
    });
    const complimentary = await insertOrder({
      subtotal: "200.00",
      collectionMode: "complimentary",
    });
    const valid = await insertOrder({ subtotal: "300.00" });
    for (const [status, orderId] of [
      ["void", cancelled],
      ["failed", complimentary],
    ] as const) {
      await client.query(
        `INSERT INTO commercial_invoices
          (id,commercial_order_id,provider,status,currency,subtotal,tax,total,
           amount_due,amount_paid,voided_at,idempotency_key)
         VALUES ($1,$2,'manual',$3,'usd','100','0','100','0','0',$4,$5)`,
        [
          uuid(),
          orderId,
          status,
          status === "void" ? "2026-07-02T00:00:00Z" : null,
          `${status}:${orderId}`,
        ],
      );
    }
    await client.query(
      `INSERT INTO commercial_payments
        (id,commercial_order_id,provider,amount,currency,status,received_at,
         method,recorded_by_account_id,evidence_reference,idempotency_key)
       VALUES ($1,$2,'manual','50','usd','failed','2026-07-02T00:00:00Z',
               'wire',$3,'failed transfer',$4)`,
      [uuid(), valid, actor, `failed:${valid}`],
    );

    const result = await getSiteLicenseRevenueAnalytics({
      request: {
        reason: "test exclusion rules",
        start: "2026-07-01",
        end: "2026-07-04",
      },
      client,
    });
    const contracted = result.rows
      .filter(({ measure }) => measure === "contracted")
      .reduce((sum, { amount_cents }) => sum + amount_cents, 0);
    expect(contracted).toBe(30_101);
    expect(result.rows.some(({ measure }) => measure !== "contracted")).toBe(
      false,
    );
  });
});
