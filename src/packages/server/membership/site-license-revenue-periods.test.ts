/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import { after, before } from "@cocalc/server/test";
import {
  createTestAccount,
  createTestMembershipTier,
} from "@cocalc/server/purchases/test-data";
import { uuid } from "@cocalc/util/misc";

import { adminProvisionSiteLicense } from "./site-licenses";
import {
  deleteSiteLicenseRevenuePeriod,
  getSiteLicenseRevenueSeriesLocal,
  listSiteLicenseRevenuePeriods,
  saveSiteLicenseRevenuePeriod,
} from "./site-license-revenue-periods";

beforeAll(async () => {
  await before({ noConat: true });
}, 15_000);

afterAll(after);

describe("site-license revenue periods", () => {
  const adminAccountId = uuid();
  const ordinaryAccountId = uuid();
  const membershipClass = `site-revenue-${uuid()}`;
  let siteLicenseId = "";

  beforeAll(async () => {
    await createTestAccount(adminAccountId);
    await createTestAccount(ordinaryAccountId);
    await createTestMembershipTier({
      id: membershipClass,
      priority: 10,
      price_yearly: 100,
    });
    await getPool().query(
      "UPDATE accounts SET groups=ARRAY['admin']::text[] WHERE account_id=$1",
      [adminAccountId],
    );
    const overview = await adminProvisionSiteLicense({
      actor_account_id: adminAccountId,
      name: "Revenue Period Test",
      organization_name: "Analytical Engines Ltd.",
      allowed_domains: [],
      pools: [
        {
          pool_name: "Members",
          membership_class: membershipClass,
          seat_count: 10,
          requires_approval: false,
          verification_policy: "email-domain",
        },
      ],
    });
    siteLicenseId = overview.site_license.id;
  });

  it("keeps revenue configuration admin-only", async () => {
    await expect(
      listSiteLicenseRevenuePeriods({
        actor_account_id: ordinaryAccountId,
        site_license_id: siteLicenseId,
      }),
    ).rejects.toThrow("must be an admin");
    await expect(
      saveSiteLicenseRevenuePeriod({
        actor_account_id: ordinaryAccountId,
        site_license_id: siteLicenseId,
        starts_on: "2026-08-01",
        ends_on: "2026-08-31",
        amount_cents: 10_000,
      }),
    ).rejects.toThrow("must be an admin");
  });

  it("creates, edits, overlaps, and deletes inclusive periods", async () => {
    const first = await saveSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      starts_on: "2026-08-17",
      ends_on: "2027-08-31",
      amount_cents: 400_000,
      invoice_number: "INV-2026-0042",
      notes: "Initial agreement",
      metadata: { crm_order: "order-42" },
    });
    const overlapping = await saveSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      starts_on: "2027-08-01",
      ends_on: "2027-08-31",
      amount_cents: 12_500,
    });

    const updated = await saveSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      period_id: first.id,
      starts_on: first.starts_on,
      ends_on: "2027-09-30",
      amount_cents: 450_000,
      invoice_number: first.invoice_number,
      notes: "Extended agreement",
      metadata: first.metadata,
    });
    expect(updated).toMatchObject({
      id: first.id,
      starts_on: "2026-08-17",
      ends_on: "2027-09-30",
      amount_cents: 450_000,
      invoice_number: "INV-2026-0042",
      notes: "Extended agreement",
      created_by_account_id: adminAccountId,
      updated_by_account_id: adminAccountId,
    });

    expect(
      await listSiteLicenseRevenuePeriods({
        actor_account_id: adminAccountId,
        site_license_id: siteLicenseId,
      }),
    ).toEqual([
      expect.objectContaining({ id: overlapping.id }),
      expect.objectContaining({ id: first.id }),
    ]);

    await expect(
      deleteSiteLicenseRevenuePeriod({
        actor_account_id: adminAccountId,
        site_license_id: siteLicenseId,
        period_id: overlapping.id,
      }),
    ).resolves.toEqual({ deleted: true });
    await expect(
      deleteSiteLicenseRevenuePeriod({
        actor_account_id: adminAccountId,
        site_license_id: siteLicenseId,
        period_id: overlapping.id,
      }),
    ).resolves.toEqual({ deleted: false });

    const { rows } = await getPool().query<{
      action: string;
      before_value: Record<string, unknown> | null;
      after_value: Record<string, unknown> | null;
    }>(
      `SELECT action, before_value, after_value
         FROM site_license_revenue_period_audit_log
        WHERE site_license_id=$1
        ORDER BY created`,
      [siteLicenseId],
    );
    expect(rows.map(({ action }) => action)).toEqual([
      "created",
      "created",
      "updated",
      "deleted",
    ]);
    expect(rows[2]?.before_value).toMatchObject({ amount_cents: 400_000 });
    expect(rows[2]?.after_value).toMatchObject({ amount_cents: 450_000 });
    expect(rows[3]?.before_value).toMatchObject({ id: overlapping.id });
    expect(rows[3]?.after_value).toBeNull();
  });

  it("rejects invalid periods and fractional cents", async () => {
    await expect(
      saveSiteLicenseRevenuePeriod({
        actor_account_id: adminAccountId,
        site_license_id: siteLicenseId,
        starts_on: "2026-09-01",
        ends_on: "2026-08-01",
        amount_cents: 100,
      }),
    ).rejects.toThrow("ends_on must be on or after starts_on");
    await expect(
      saveSiteLicenseRevenuePeriod({
        actor_account_id: adminAccountId,
        site_license_id: siteLicenseId,
        starts_on: "2026-08-01",
        ends_on: "2026-09-01",
        amount_cents: 100.5,
      }),
    ).rejects.toThrow("whole-cent amount");
  });

  it("projects every cent over inclusive days and replaces edited buckets", async () => {
    async function revenueByDay() {
      const { rows } = await getSiteLicenseRevenueSeriesLocal({
        query: { start: "2030-01-01", end: "2030-01-04" },
      });
      return new Map(rows.map((row) => [`${row.day}`, row.revenue_cents]));
    }
    function incrementalRevenue(
      current: Map<string, number>,
      baseline: Map<string, number>,
    ) {
      return ["2030-01-01", "2030-01-02", "2030-01-03"].map(
        (day) => (current.get(day) ?? 0) - (baseline.get(day) ?? 0),
      );
    }

    const baseline = await revenueByDay();
    const period = await saveSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      starts_on: "2030-01-01",
      ends_on: "2030-01-03",
      amount_cents: 10,
    });
    const initialProjection = await getPool().query<{
      revenue_cents: number | string;
    }>(
      `SELECT revenue_cents
         FROM site_license_revenue_daily_allocations
        WHERE period_id=$1
        ORDER BY day`,
      [period.id],
    );
    expect(
      initialProjection.rows.map(({ revenue_cents }) => Number(revenue_cents)),
    ).toEqual([4, 3, 3]);
    expect(incrementalRevenue(await revenueByDay(), baseline)).toEqual([
      4, 3, 3,
    ]);

    const overlap = await saveSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      starts_on: "2030-01-01",
      ends_on: "2030-01-03",
      amount_cents: 6,
    });
    expect(incrementalRevenue(await revenueByDay(), baseline)).toEqual([
      6, 5, 5,
    ]);
    await deleteSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      period_id: overlap.id,
    });
    expect(incrementalRevenue(await revenueByDay(), baseline)).toEqual([
      4, 3, 3,
    ]);

    const edited = await saveSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      period_id: period.id,
      starts_on: "2030-01-01",
      ends_on: "2030-01-02",
      amount_cents: 7,
    });
    expect(edited).toMatchObject({
      starts_on: "2030-01-01",
      ends_on: "2030-01-02",
      amount_cents: 7,
    });
    const projected = await getPool().query<{
      day: Date | string;
      revenue_cents: number | string;
    }>(
      `SELECT day, revenue_cents
         FROM site_license_revenue_daily_allocations
        WHERE period_id=$1
        ORDER BY day`,
      [period.id],
    );
    expect(
      projected.rows.map(({ day, revenue_cents }) => ({
        day: new Date(day).toISOString().slice(0, 10),
        revenue_cents: Number(revenue_cents),
      })),
    ).toEqual([
      { day: "2030-01-01", revenue_cents: 4 },
      { day: "2030-01-02", revenue_cents: 3 },
    ]);
    expect(incrementalRevenue(await revenueByDay(), baseline)).toEqual([
      4, 3, 0,
    ]);

    await deleteSiteLicenseRevenuePeriod({
      actor_account_id: adminAccountId,
      site_license_id: siteLicenseId,
      period_id: period.id,
    });
    expect(await revenueByDay()).toEqual(baseline);
  });
});
