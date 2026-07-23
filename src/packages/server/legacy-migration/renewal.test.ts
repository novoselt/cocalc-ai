/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import dayjs from "dayjs";

import getPool from "@cocalc/database/pool";
import { after, before } from "@cocalc/server/test";
import {
  createTestAccount,
  createTestMembershipSubscription,
  createTestMembershipTier,
} from "@cocalc/server/purchases/test-data";
import { uuid } from "@cocalc/util/misc";
import { configureFinancialMembershipRenewalHomeBay } from ".";

beforeAll(async () => {
  await before({ noConat: true });
}, 15_000);
afterAll(after);

describe("legacy migration membership renewal configuration", () => {
  beforeEach(async () => {
    await getPool().query("DELETE FROM subscription_renewal_attempts");
    await getPool().query("DELETE FROM subscriptions");
    await createTestMembershipTier({
      id: "member",
      price_monthly: 20,
      price_yearly: 200,
    });
    await createTestMembershipTier({
      id: "pro",
      price_monthly: 200,
      price_yearly: 1800,
    });
  });

  it("replaces a pending attempt when tier and interval change", async () => {
    const account_id = uuid();
    const end = dayjs().add(20, "day").toDate();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      { class: "member", cost: 10, end, interval: "month" },
    );
    await getPool().query(
      `UPDATE subscriptions
          SET metadata=metadata || $2::jsonb
        WHERE id=$1`,
      [
        subscription_id,
        {
          source_id: "legacy-migration",
          promo_grant: true,
        },
      ],
    );

    await configureFinancialMembershipRenewalHomeBay({
      account_id,
      membership_class: "pro",
      membership_interval: "year",
    });
    await configureFinancialMembershipRenewalHomeBay({
      account_id,
      membership_class: "member",
      membership_interval: "month",
    });

    const { rows } = await getPool().query(
      `SELECT s.cost, s.interval, s.metadata,
              a.state, a.amount, a.target_period_end
         FROM subscriptions s
         JOIN subscription_renewal_attempts a
           ON a.subscription_id=s.id
        WHERE s.id=$1`,
      [subscription_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      interval: "month",
      state: "scheduled",
    });
    expect(Number(rows[0].amount)).toBe(Number(rows[0].cost));
    expect(rows[0].metadata).toMatchObject({
      renewal_class: "member",
      renewal_configured: true,
      renewal_interval: "month",
    });
    expect(dayjs(rows[0].target_period_end).diff(dayjs(end), "month")).toBe(1);
  });
});
