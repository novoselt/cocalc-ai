/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { uuid } from "@cocalc/util/misc";
import dayjs from "dayjs";
import { before, after, getPool } from "@cocalc/server/test";
import { SUBSCRIPTION_RENEWAL } from "@cocalc/util/db-schema/purchases";
import {
  createTestAccount,
  createTestMembershipSubscription,
} from "@cocalc/server/purchases/test-data";
import createCredit from "@cocalc/server/purchases/create-credit";
import getBalance from "@cocalc/server/purchases/get-balance";
import { bindSubscriptionRenewalPaymentIntent } from "../subscription-renewal-attempts";

const mockCreatePaymentIntent = jest.fn();
const mockGetStripeCustomerId = jest.fn();
const mockGetServerSettings = jest.fn();
const mockSend = jest.fn();
const mockSupport = jest.fn();
const mockUrl = jest.fn();
const mockUseBalanceTowardSubscriptions = jest.fn();
const mockAdminAlert = jest.fn();
const mockRetrievePaymentIntent = jest.fn();
const mockUpdatePaymentIntent = jest.fn();

jest.mock("./create-payment-intent", () => ({
  __esModule: true,
  default: (...args: any[]) => mockCreatePaymentIntent(...args),
}));

jest.mock("./util", () => ({
  getStripeCustomerId: (...args: any[]) => mockGetStripeCustomerId(...args),
}));

jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: (...args: any[]) => mockGetServerSettings(...args),
}));

jest.mock("@cocalc/server/messages/send", () => ({
  __esModule: true,
  default: (...args: any[]) => mockSend(...args),
  name: jest.fn().mockResolvedValue("Test User"),
  support: (...args: any[]) => mockSupport(...args),
  url: (...args: any[]) => mockUrl(...args),
}));

jest.mock("@cocalc/server/messages/admin-alert", () => ({
  __esModule: true,
  default: (...args: any[]) => mockAdminAlert(...args),
}));

jest.mock("@cocalc/server/stripe/connection", () => ({
  __esModule: true,
  default: jest.fn(async () => ({
    paymentIntents: {
      retrieve: (...args: any[]) => mockRetrievePaymentIntent(...args),
      update: (...args: any[]) => mockUpdatePaymentIntent(...args),
    },
  })),
}));

jest.mock("../subscription-renewal-notice", () => ({
  useBalanceTowardSubscriptions: (...args: any[]) =>
    mockUseBalanceTowardSubscriptions(...args),
}));

import createSubscriptionPayment, {
  processSubscriptionRenewal,
  processSubscriptionRenewalFailure,
} from "./create-subscription-payment";

beforeAll(async () => {
  await before({ noConat: true });
}, 15000);
afterAll(after);

describe("createSubscriptionPayment", () => {
  beforeEach(async () => {
    await getPool().query("DELETE FROM subscriptions");
    mockCreatePaymentIntent.mockReset().mockImplementation(async (opts) => {
      await bindSubscriptionRenewalPaymentIntent({
        account_id: opts.account_id,
        attempt_id: opts.metadata.renewal_attempt_id,
        payment_intent_id: "pi_renewal",
        stripe_invoice_id: "in_renewal",
        subscription_id: Number(opts.metadata.subscription_id),
      });
      return {
        hosted_invoice_url: "https://stripe.example/invoice",
        payment_intent: "pi_renewal",
      };
    });
    mockGetStripeCustomerId.mockReset().mockResolvedValue("cus_123");
    mockGetServerSettings.mockReset().mockResolvedValue({
      site_name: "CoCalc",
    });
    mockSend.mockReset().mockResolvedValue(undefined);
    mockSupport.mockReset().mockResolvedValue("support");
    mockUrl.mockReset().mockImplementation(async (path) => path);
    mockUseBalanceTowardSubscriptions.mockReset().mockResolvedValue(false);
    mockAdminAlert.mockReset().mockResolvedValue(undefined);
    mockRetrievePaymentIntent.mockReset();
    mockUpdatePaymentIntent.mockReset().mockResolvedValue(undefined);
  });

  it("does not process immediately before the renewal payment state is recorded", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { cost, subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() - 60_000),
      },
    );

    await createSubscriptionPayment({
      account_id,
      subscription_id,
    });

    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id,
        force: true,
        metadata: expect.objectContaining({
          renewal_attempt_id: expect.any(String),
          subscription_id: `${subscription_id}`,
        }),
        processImmediately: false,
        purpose: SUBSCRIPTION_RENEWAL,
      }),
    );

    const { rows } = await getPool().query(
      "SELECT payment FROM subscriptions WHERE id=$1",
      [subscription_id],
    );
    expect(rows[0].payment).toMatchObject({
      amount: cost,
      payment_intent_id: "pi_renewal",
      status: "active",
      subscription_id,
    });
  });

  it("adopts a matching legacy renewal payment intent", async () => {
    const account_id = uuid();
    const end = new Date(Date.now() - 60_000);
    await createTestAccount(account_id);
    const { cost, subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end,
      },
    );
    const targetPeriodEnd = dayjs(end).add(1, "month").valueOf();
    await getPool().query("UPDATE subscriptions SET payment=$2 WHERE id=$1", [
      subscription_id,
      {
        amount: cost,
        new_expires_ms: targetPeriodEnd,
        payment_intent_id: "pi_legacy_renewal",
        status: "active",
        subscription_id,
      },
    ]);
    mockRetrievePaymentIntent.mockResolvedValue({
      id: "pi_legacy_renewal",
      metadata: {
        account_id,
        invoice_id: "in_legacy_renewal",
        purpose: SUBSCRIPTION_RENEWAL,
        subscription_id: `${subscription_id}`,
        total_excluding_tax_usd: `${cost}`,
      },
      status: "requires_payment_method",
    });

    await expect(
      createSubscriptionPayment({ account_id, subscription_id }),
    ).resolves.toEqual({ payment_intent_id: "pi_legacy_renewal" });

    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    const { rows } = await getPool().query(
      `SELECT a.id, a.payment_intent_id, a.stripe_invoice_id, s.payment
         FROM subscription_renewal_attempts a
         JOIN subscriptions s ON s.id=a.subscription_id
        WHERE a.subscription_id=$1`,
      [subscription_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      payment_intent_id: "pi_legacy_renewal",
      stripe_invoice_id: "in_legacy_renewal",
      payment: {
        amount: cost,
        payment_intent_id: "pi_legacy_renewal",
        renewal_attempt_id: rows[0].id,
        status: "active",
        subscription_id,
      },
    });
    expect(mockUpdatePaymentIntent).toHaveBeenCalledWith(
      "pi_legacy_renewal",
      expect.objectContaining({
        metadata: expect.objectContaining({
          renewal_attempt_id: rows[0].id,
        }),
      }),
    );
  });

  it("does not adopt a legacy renewal intent owned by another account", async () => {
    const account_id = uuid();
    const end = new Date(Date.now() - 60_000);
    await createTestAccount(account_id);
    const { cost, subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end,
      },
    );
    await getPool().query("UPDATE subscriptions SET payment=$2 WHERE id=$1", [
      subscription_id,
      {
        amount: cost,
        new_expires_ms: dayjs(end).add(1, "month").valueOf(),
        payment_intent_id: "pi_wrong_owner",
        status: "active",
        subscription_id,
      },
    ]);
    mockRetrievePaymentIntent.mockResolvedValue({
      id: "pi_wrong_owner",
      metadata: {
        account_id: uuid(),
        purpose: SUBSCRIPTION_RENEWAL,
        subscription_id: `${subscription_id}`,
        total_excluding_tax_usd: `${cost}`,
      },
      status: "requires_payment_method",
    });

    await expect(
      createSubscriptionPayment({ account_id, subscription_id }),
    ).rejects.toThrow(/does not match the durable renewal attempt/);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    expect(mockUpdatePaymentIntent).not.toHaveBeenCalled();
  });

  it("renews entirely from balance without accessing Stripe", async () => {
    const account_id = uuid();
    const end = new Date(Date.now() - 60_000);
    await createTestAccount(account_id);
    await createCredit({ account_id, amount: 100 });
    const { cost, subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end,
      },
    );
    mockUseBalanceTowardSubscriptions.mockResolvedValue(true);

    await expect(
      createSubscriptionPayment({ account_id, subscription_id }),
    ).resolves.toEqual({});

    expect(mockGetStripeCustomerId).not.toHaveBeenCalled();
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    expect(Number(await getBalance({ account_id }))).toBe(100 - cost);

    const { rows: subscriptions } = await getPool().query(
      `SELECT current_period_end, payment
         FROM subscriptions
        WHERE id=$1`,
      [subscription_id],
    );
    expect(new Date(subscriptions[0].current_period_end).getTime()).toBe(
      dayjs(end).add(1, "month").valueOf(),
    );
    expect(subscriptions[0].payment).toMatchObject({
      amount: cost,
      status: "paid",
      subscription_id,
    });
    expect(subscriptions[0].payment.payment_intent_id).toBeNull();

    const { rows: purchases } = await getPool().query(
      `SELECT cost
         FROM purchases
        WHERE account_id=$1
          AND service='membership'
          AND (description->>'subscription_id')::int=$2`,
      [account_id, subscription_id],
    );
    expect(purchases).toHaveLength(1);
    expect(Number(purchases[0].cost)).toBe(cost);

    const { rows: attempts } = await getPool().query(
      `SELECT payment_intent_id, state
         FROM subscription_renewal_attempts
        WHERE subscription_id=$1
        ORDER BY period_end`,
      [subscription_id],
    );
    expect(attempts).toEqual([
      { payment_intent_id: null, state: "succeeded" },
      { payment_intent_id: null, state: "scheduled" },
    ]);
  });

  it("does not let the legacy payment route collect before period end", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        end: new Date(Date.now() + 60_000),
      },
    );

    await expect(
      createSubscriptionPayment({ account_id, subscription_id }),
    ).rejects.toThrow(/is not available/);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it("cancels a stale attempt before creating Stripe state", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() - 60_000),
      },
    );
    const { rows: attempts } = await getPool().query(
      `SELECT id
         FROM subscription_renewal_attempts
        WHERE subscription_id=$1`,
      [subscription_id],
    );
    await getPool().query(
      "UPDATE subscriptions SET status='canceled' WHERE id=$1",
      [subscription_id],
    );

    await expect(
      createSubscriptionPayment({
        account_id,
        subscription_id,
        renewal_attempt_id: attempts[0].id,
      }),
    ).rejects.toThrow(/does not match/);

    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    const { rows } = await getPool().query(
      `SELECT state
         FROM subscription_renewal_attempts
        WHERE id=$1`,
      [attempts[0].id],
    );
    expect(rows).toEqual([{ state: "canceled" }]);
  });

  it("fulfills one durable attempt once and schedules the next period", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() - 60_000),
      },
    );
    const { rows: attempts } = await getPool().query(
      `SELECT id
         FROM subscription_renewal_attempts
        WHERE subscription_id=$1`,
      [subscription_id],
    );
    const paymentIntent = {
      id: "pi_durable",
      metadata: {
        renewal_attempt_id: attempts[0].id,
        subscription_id: `${subscription_id}`,
      },
    };

    await processSubscriptionRenewal({
      account_id,
      paymentIntent,
      amount: 72,
    });
    await processSubscriptionRenewal({
      account_id,
      paymentIntent,
      amount: 72,
    });

    const { rows: purchases } = await getPool().query(
      `SELECT id
         FROM purchases
        WHERE account_id=$1
          AND service='membership'
          AND (description->>'subscription_id')::int=$2`,
      [account_id, subscription_id],
    );
    const { rows: renewalRows } = await getPool().query(
      `SELECT state
         FROM subscription_renewal_attempts
        WHERE subscription_id=$1
        ORDER BY period_end`,
      [subscription_id],
    );
    expect(purchases).toHaveLength(1);
    expect(renewalRows).toEqual([
      { state: "succeeded" },
      { state: "scheduled" },
    ]);
  });

  it("ignores a callback that does not own the current renewal attempt", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { end, subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() - 60_000),
      },
    );
    const { rows: attempts } = await getPool().query(
      `UPDATE subscription_renewal_attempts
          SET payment_intent_id='pi_current'
        WHERE subscription_id=$1
        RETURNING id`,
      [subscription_id],
    );

    await processSubscriptionRenewal({
      account_id,
      paymentIntent: {
        id: "pi_stale",
        metadata: {
          renewal_attempt_id: attempts[0].id,
          subscription_id: `${subscription_id}`,
        },
      },
      amount: 72,
    });

    const { rows: subscriptions } = await getPool().query(
      `SELECT current_period_end
         FROM subscriptions
        WHERE id=$1`,
      [subscription_id],
    );
    const { rows: purchases } = await getPool().query(
      `SELECT id
         FROM purchases
        WHERE account_id=$1
          AND service='membership'
          AND (description->>'subscription_id')::int=$2`,
      [account_id, subscription_id],
    );
    expect(new Date(subscriptions[0].current_period_end).getTime()).toBe(
      end.getTime(),
    );
    expect(purchases).toHaveLength(0);
  });

  it("ignores a callback whose durable attempt record is gone", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() - 60_000),
      },
    );

    await processSubscriptionRenewal({
      account_id,
      paymentIntent: {
        id: "pi_orphaned",
        metadata: {
          renewal_attempt_id: uuid(),
          subscription_id: `${subscription_id}`,
        },
      },
      amount: 72,
    });

    const { rows } = await getPool().query(
      `SELECT id
         FROM purchases
        WHERE account_id=$1
          AND service='membership'
          AND (description->>'subscription_id')::int=$2`,
      [account_id, subscription_id],
    );
    expect(rows).toHaveLength(0);
  });

  it("cancels membership only after a terminal renewal failure", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(Date.now() - 60_000),
      },
    );
    const { rows: attempts } = await getPool().query(
      `SELECT id
         FROM subscription_renewal_attempts
        WHERE subscription_id=$1`,
      [subscription_id],
    );

    await processSubscriptionRenewalFailure({
      account_id,
      paymentIntent: {
        id: "pi_failed",
        status: "requires_payment_method",
        metadata: {
          renewal_attempt_id: attempts[0].id,
          subscription_id: `${subscription_id}`,
        },
      },
    });

    const { rows } = await getPool().query(
      `SELECT s.status, a.state
         FROM subscriptions s
         JOIN subscription_renewal_attempts a ON a.subscription_id=s.id
        WHERE s.id=$1`,
      [subscription_id],
    );
    expect(rows).toEqual([{ state: "failed", status: "canceled" }]);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: `Subscription Id=${subscription_id} Canceled`,
        to_ids: [account_id],
      }),
    );
    expect(mockAdminAlert).not.toHaveBeenCalled();
  });

  it("does not duplicate renewal purchases when a payment intent is retried", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 72,
        status: "past_due",
      },
    );
    const newExpiresMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
    await getPool().query("UPDATE subscriptions SET payment=$2 WHERE id=$1", [
      subscription_id,
      {
        new_expires_ms: newExpiresMs,
        payment_intent_id: "pi_retry",
        status: "active",
      },
    ]);

    const paymentIntent = {
      metadata: {
        subscription_id: `${subscription_id}`,
        credit_id: "987",
      },
    };
    await processSubscriptionRenewal({
      account_id,
      paymentIntent,
      amount: 72,
    });
    await processSubscriptionRenewal({
      account_id,
      paymentIntent,
      amount: 72,
    });

    const { rows: purchases } = await getPool().query(
      `SELECT id, description
         FROM purchases
        WHERE account_id=$1
          AND service='membership'
          AND description->>'type'='membership'
          AND (description->>'subscription_id')::int=$2`,
      [account_id, subscription_id],
    );
    expect(purchases).toHaveLength(1);
    expect(purchases[0].description).toMatchObject({ credit_id: 987 });

    const { rows: subscriptions } = await getPool().query(
      "SELECT latest_purchase_id, payment FROM subscriptions WHERE id=$1",
      [subscription_id],
    );
    expect(subscriptions[0].latest_purchase_id).toBe(purchases[0].id);
    expect(subscriptions[0].payment).toMatchObject({ status: "paid" });
  });

  it("converts a legacy migration grant to its configured renewal class when paid", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        class: "member",
        cost: 72,
        interval: "year",
        status: "past_due",
      },
    );
    const newExpiresMs = Date.now() + 365 * 24 * 60 * 60 * 1000;
    await getPool().query(
      `
      UPDATE subscriptions
         SET payment=$2,
             metadata=metadata || $3::jsonb
       WHERE id=$1
      `,
      [
        subscription_id,
        {
          new_expires_ms: newExpiresMs,
          payment_intent_id: "pi_legacy_renewal",
          status: "active",
        },
        JSON.stringify({
          grant: true,
          source_id: "legacy-migration",
          renewal_configured: true,
          renewal_class: "basic",
          renewal_interval: "year",
        }),
      ],
    );

    await processSubscriptionRenewal({
      account_id,
      paymentIntent: {
        metadata: { subscription_id: `${subscription_id}` },
      },
      amount: 72,
    });

    const { rows: purchases } = await getPool().query(
      `SELECT description
         FROM purchases
        WHERE account_id=$1
          AND service='membership'
          AND description->>'type'='membership'
          AND (description->>'subscription_id')::int=$2`,
      [account_id, subscription_id],
    );
    expect(purchases).toHaveLength(1);
    expect(purchases[0].description).toMatchObject({
      class: "basic",
      interval: "year",
    });

    const { rows: subscriptions } = await getPool().query(
      "SELECT metadata, interval FROM subscriptions WHERE id=$1",
      [subscription_id],
    );
    expect(subscriptions[0].metadata).toMatchObject({
      class: "basic",
      grant: false,
      renewal_class: "basic",
      renewal_interval: "year",
    });
    expect(subscriptions[0].interval).toBe("year");
  });
});
