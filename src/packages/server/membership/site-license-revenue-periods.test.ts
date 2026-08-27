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
});
