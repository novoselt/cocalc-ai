/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getPool } from "@cocalc/server/test";
import { after, before } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import adminCreateMembershipPackagePurchase from "./admin-membership-package";
import { createTestAccount, createTestMembershipTier } from "./test-data";

beforeAll(async () => {
  await before({ noConat: true });
}, 15000);

afterAll(after);

describe("admin membership package purchase", () => {
  const membershipClass = `admin-package-${uuid()}`;

  beforeAll(async () => {
    await createTestMembershipTier({
      id: membershipClass,
      priority: 25,
      price_monthly: 20,
      price_yearly: 200,
      team_visible: true,
    });
  });

  it("atomically creates a custom-price package and reuses its idempotency key", async () => {
    const admin_account_id = uuid();
    const user_account_id = uuid();
    await createTestAccount(admin_account_id);
    await createTestAccount(user_account_id);
    await getPool().query(
      "UPDATE accounts SET groups=$2::TEXT[] WHERE account_id=$1",
      [admin_account_id, ["admin"]],
    );
    const starts_at = new Date("2026-08-10T00:00:00Z");
    const expires_at = new Date("2026-08-22T00:00:00Z");
    const options = {
      admin_account_id,
      user_account_id,
      product: {
        type: "membership-package" as const,
        kind: "team" as const,
        membership_class: membershipClass,
        seat_count: 5,
        interval: "month" as const,
        starts_at,
        expires_at,
      },
      price: 25,
      source: "free" as const,
      reason: "support ticket 20443 approved offer",
      idempotency_key: "ticket-20443-test",
      pricing_note: "custom camp package",
    };

    const created = await adminCreateMembershipPackagePurchase(options);
    expect(created).toMatchObject({
      price: 25,
      standard_price: 100,
      existing: false,
    });
    expect(created.credit_id).toBeDefined();
    expect(created.starts_at).toEqual(starts_at);
    expect(created.expires_at).toEqual(expires_at);

    const repeated = await adminCreateMembershipPackagePurchase(options);
    expect(repeated).toMatchObject({
      package_id: created.package_id,
      purchase_id: created.purchase_id,
      credit_id: created.credit_id,
      existing: true,
    });

    const packages = await getPool().query(
      `SELECT purchase_id, seat_count, starts_at, expires_at, metadata
         FROM membership_packages
        WHERE id=$1 AND owner_account_id=$2`,
      [created.package_id, user_account_id],
    );
    expect(packages.rows).toHaveLength(1);
    expect(packages.rows[0]).toMatchObject({
      purchase_id: created.purchase_id,
      seat_count: 5,
    });
    expect(packages.rows[0].metadata).toMatchObject({
      admin_custom_price: 25,
      standard_total_price: 100,
    });

    const audit = await getPool().query(
      `SELECT reason, metadata
         FROM account_admin_audit_log
        WHERE account_id=$1 AND action='membership-package-purchase'`,
      [user_account_id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].reason).toBe("support ticket 20443 approved offer");
    expect(audit.rows[0].metadata).toMatchObject({
      package_id: created.package_id,
      purchase_id: created.purchase_id,
      custom_price: 25,
      standard_price: 100,
      seat_count: 5,
      source: "free",
    });
  });
});
