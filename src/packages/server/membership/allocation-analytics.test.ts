/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getTransactionClient, type PoolClient } from "@cocalc/database/pool";
import {
  allocateWholeCentsByDay,
  projectMembershipAllocationFact,
  recordMembershipAllocationFact,
  recordMembershipAllocationRefund,
} from "./allocation-analytics";

describe("membership allocation analytics", () => {
  it("spreads whole-cent remainders over the first days", () => {
    const rows = allocateWholeCentsByDay({
      allocation_start: "2026-08-03T18:00:00Z",
      allocation_end: "2026-08-08T18:00:00Z",
      revenue_cents: 13,
    });
    expect(rows).toEqual([
      { day: "2026-08-03", revenue_cents: 3 },
      { day: "2026-08-04", revenue_cents: 3 },
      { day: "2026-08-05", revenue_cents: 3 },
      { day: "2026-08-06", revenue_cents: 2 },
      { day: "2026-08-07", revenue_cents: 2 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.revenue_cents, 0)).toBe(13);
  });

  it("allocates negative adjustments exactly", () => {
    const rows = allocateWholeCentsByDay({
      allocation_start: "2026-08-03",
      allocation_end: "2026-08-08",
      revenue_cents: -13,
    });
    expect(rows.map(({ revenue_cents }) => revenue_cents)).toEqual([
      -3, -3, -3, -2, -2,
    ]);
    expect(rows.reduce((sum, row) => sum + row.revenue_cents, 0)).toBe(-13);
  });

  describe("database projection", () => {
    let client: PoolClient;

    beforeAll(async () => {
      client = await getTransactionClient();
    }, 30_000);

    afterAll(async () => {
      await client.query("ROLLBACK");
      client.release();
    }, 30_000);

    it("projects a fact once and preserves exact daily totals", async () => {
      await recordMembershipAllocationFact({
        fact_key: "test:membership:first-paid",
        occurred_at: new Date("2026-08-03T18:00:00Z"),
        bay_id: "test-bay",
        account_id: "00000000-0000-4000-8000-000000000001",
        channel: "personal",
        source_kind: "purchase",
        membership_class: "standard",
        billing_interval: "month",
        lifecycle: "first_paid",
        allocation_start: new Date("2026-08-03T18:00:00Z"),
        allocation_end: new Date("2026-08-08T18:00:00Z"),
        active_memberships: 1,
        revenue: 0.13,
        purchase_id: 1,
        subscription_id: 2,
        client,
      });

      expect(
        await projectMembershipAllocationFact({
          fact_key: "test:membership:first-paid",
          client,
        }),
      ).toBe(true);
      expect(
        await projectMembershipAllocationFact({
          fact_key: "test:membership:first-paid",
          client,
        }),
      ).toBe(false);

      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS days,
              SUM(active_memberships)::int AS memberships,
              SUM(revenue_cents)::int AS revenue_cents,
              SUM(fact_count)::int AS fact_count
         FROM membership_daily_allocations`,
      );
      expect(rows[0]).toEqual({
        days: 5,
        memberships: 5,
        revenue_cents: 13,
        fact_count: 5,
      });
    });

    it("rejects fractional-cent facts", async () => {
      await expect(
        recordMembershipAllocationFact({
          fact_key: "test:fractional",
          account_id: "00000000-0000-4000-8000-000000000001",
          channel: "personal",
          source_kind: "purchase",
          membership_class: "standard",
          billing_interval: "month",
          lifecycle: "first_paid",
          allocation_start: "2026-08-03",
          allocation_end: "2026-08-04",
          active_memberships: 1,
          revenue: 0.001,
          client,
        }),
      ).rejects.toThrow("whole cents");
    });

    it("records exact compensating facts without rewriting the originals", async () => {
      for (const [suffix, memberships, revenue] of [
        ["target", 1, 20],
        ["credit", -1, -8],
      ] as const) {
        await recordMembershipAllocationFact({
          fact_key: `test:upgrade:${suffix}`,
          account_id: "00000000-0000-4000-8000-000000000001",
          channel: "personal",
          source_kind:
            suffix === "target" ? "plan-change" : "plan-change-credit",
          membership_class: suffix,
          billing_interval: "month",
          lifecycle: "plan_change",
          tier_change: "upgrade",
          allocation_start: "2026-08-03",
          allocation_end: "2026-09-03",
          active_memberships: memberships,
          revenue,
          purchase_id: 123,
          subscription_id: 456,
          client,
        });
      }

      expect(
        await recordMembershipAllocationRefund({
          original_purchase_id: 123,
          refund_purchase_id: 124,
          client,
        }),
      ).toBe(2);
      expect(
        await recordMembershipAllocationRefund({
          original_purchase_id: 123,
          refund_purchase_id: 124,
          client,
        }),
      ).toBe(0);

      const { rows } = await client.query(
        `SELECT membership_class,
                SUM(active_memberships)::int AS active_memberships,
                SUM(revenue_cents)::int AS revenue_cents,
                COUNT(*)::int AS fact_count
           FROM membership_allocation_facts
          WHERE purchase_id IN (123,124)
          GROUP BY membership_class
          ORDER BY membership_class`,
      );
      expect(rows).toEqual([
        {
          membership_class: "credit",
          active_memberships: 0,
          revenue_cents: 0,
          fact_count: 2,
        },
        {
          membership_class: "target",
          active_memberships: 0,
          revenue_cents: 0,
          fact_count: 2,
        },
      ]);
    });
  });
});
