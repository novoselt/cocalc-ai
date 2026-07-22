/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const mockUserIsInGroup = jest.fn();
const mockGetConn = jest.fn();
const mockSend = jest.fn();

jest.mock("@cocalc/server/accounts/is-in-group", () => ({
  __esModule: true,
  default: (...args: any[]) => mockUserIsInGroup(...args),
}));

jest.mock("@cocalc/server/stripe/connection", () => ({
  __esModule: true,
  default: (...args: any[]) => mockGetConn(...args),
}));

jest.mock("@cocalc/server/messages/send", () => ({
  __esModule: true,
  default: (...args: any[]) => mockSend(...args),
  name: jest.fn().mockResolvedValue("Test User"),
  support: jest.fn().mockResolvedValue("Support"),
  url: jest.fn(async (...args) => args.join("/")),
}));

import { uuid } from "@cocalc/util/misc";
import { after, before, getPool } from "@cocalc/server/test";
import createCredit from "./create-credit";
import createPurchase from "./create-purchase";
import createRefund from "./create-refund";
import getBalance from "./get-balance";
import {
  createTestAccount,
  createTestMembershipSubscription,
} from "./test-data";

beforeAll(async () => {
  await before({ noConat: true });
}, 15_000);
afterAll(after);

describe("membership admin refund", () => {
  beforeEach(() => {
    mockUserIsInGroup.mockReset().mockResolvedValue(true);
    mockSend.mockReset().mockResolvedValue(undefined);
    mockGetConn.mockReset().mockResolvedValue({
      charges: {
        list: jest.fn().mockResolvedValue({ data: [{ id: "ch_membership" }] }),
        retrieve: jest.fn().mockResolvedValue({
          id: "ch_membership",
          amount: 2400,
          amount_refunded: 0,
          refunded: false,
        }),
      },
      invoicePayments: {
        list: jest.fn().mockResolvedValue({ data: [] }),
      },
      invoices: {
        retrieve: jest.fn().mockResolvedValue({
          id: "in_membership",
          charge: "ch_membership",
          payment_intent: "pi_membership",
        }),
      },
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: "pi_membership",
          invoice: "in_membership",
          latest_charge: "ch_membership",
          metadata: { invoice_id: "in_membership" },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      refunds: {
        create: jest.fn().mockResolvedValue({
          id: "re_membership",
          status: "succeeded",
        }),
        list: jest.fn().mockResolvedValue({ data: [] }),
      },
    });
  });

  it("refunds membership and Stripe credit independently", async () => {
    const account_id = uuid();
    const admin_account_id = uuid();
    await createTestAccount(account_id);
    const creditId = await createCredit({
      account_id,
      amount: 24,
      invoice_id: "pi_membership",
      description: { purpose: "membership-change" },
    });
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 24,
        end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    );
    const membershipPurchaseId = await createPurchase({
      account_id,
      service: "membership",
      cost: 24,
      description: {
        type: "membership",
        subscription_id,
        credit_id: creditId,
        class: "member",
        interval: "month",
      },
      tag: "membership-change",
      period_start: new Date(),
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      client: null,
    });
    await getPool().query(
      `UPDATE subscriptions
          SET latest_purchase_id=$2,
              payment=$3
        WHERE id=$1`,
      [
        subscription_id,
        membershipPurchaseId,
        {
          payment_intent_id: "pi_membership",
          amount: 24,
          created: Date.now(),
          status: "paid",
          new_expires_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
        },
      ],
    );

    const refundPurchaseId = await createRefund({
      account_id: admin_account_id,
      purchase_id: membershipPurchaseId,
      reason: "duplicate",
      notes: "Duplicate membership charge",
    });
    await expect(
      createRefund({
        account_id: admin_account_id,
        purchase_id: membershipPurchaseId,
        reason: "duplicate",
        notes: "Duplicate membership charge",
      }),
    ).resolves.toBe(refundPurchaseId);

    expect(mockGetConn).not.toHaveBeenCalled();

    const { rows: subscriptions } = await getPool().query(
      `SELECT status, current_period_end, canceled_reason,
              payment#>>'{status}' AS payment_status
         FROM subscriptions
        WHERE id=$1`,
      [subscription_id],
    );
    expect(subscriptions[0].status).toBe("canceled");
    expect(subscriptions[0].payment_status).toBe("canceled");
    expect(
      new Date(subscriptions[0].current_period_end).getTime(),
    ).toBeLessThanOrEqual(Date.now());
    expect(subscriptions[0].canceled_reason).toContain("Admin refund");

    const { rows: originals } = await getPool().query(
      `SELECT id, description->>'refund_purchase_id' AS refund_purchase_id
         FROM purchases
        WHERE id IN ($1,$2)
        ORDER BY id`,
      [creditId, membershipPurchaseId],
    );
    expect(originals).toEqual([
      { id: creditId, refund_purchase_id: null },
      {
        id: membershipPurchaseId,
        refund_purchase_id: `${refundPurchaseId}`,
      },
    ]);

    const { rows: refunds } = await getPool().query(
      `SELECT cost, description
         FROM purchases
        WHERE service='refund'
          AND account_id=$1
        ORDER BY id`,
      [account_id],
    );
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0].cost)).toBe(-24);
    expect(refunds[0].description).toMatchObject({
      purchase_id: membershipPurchaseId,
    });
    expect(Number(await getBalance({ account_id }))).toBe(24);
    expect(mockSend).toHaveBeenCalledTimes(1);

    await createRefund({
      account_id: admin_account_id,
      purchase_id: creditId,
      reason: "duplicate",
      notes: "Refund the related Stripe charge",
    });

    const stripe = await mockGetConn.mock.results[0].value;
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        charge: "ch_membership",
        reason: "duplicate",
      }),
      { idempotencyKey: `cocalc-refund-purchase-${creditId}` },
    );
    expect(Number(await getBalance({ account_id }))).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("refunds an older membership period without touching its credit", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const creditId = await createCredit({
      account_id,
      amount: 24,
      invoice_id: "pi_old_membership",
      description: { purpose: "subscription-renewal" },
    });
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      {
        cost: 24,
      },
    );
    const oldPurchaseId = await createPurchase({
      account_id,
      service: "membership",
      cost: 24,
      description: {
        type: "membership",
        subscription_id,
        credit_id: creditId,
        class: "member",
        interval: "month",
      },
      client: null,
    });
    const latestPurchaseId = await createPurchase({
      account_id,
      service: "membership",
      cost: 24,
      description: {
        type: "membership",
        subscription_id,
        class: "member",
        interval: "month",
      },
      client: null,
    });
    await getPool().query(
      "UPDATE subscriptions SET latest_purchase_id=$2 WHERE id=$1",
      [subscription_id, latestPurchaseId],
    );

    const refundPurchaseId = await createRefund({
      account_id: uuid(),
      purchase_id: oldPurchaseId,
      reason: "requested_by_customer",
      notes: "Wrong period",
    });

    expect(mockGetConn).not.toHaveBeenCalled();
    const { rows: purchases } = await getPool().query(
      `SELECT id, description
         FROM purchases
        WHERE id IN ($1,$2,$3)
        ORDER BY id`,
      [creditId, oldPurchaseId, latestPurchaseId],
    );
    expect(purchases[0]?.description?.refund_purchase_id).toBeUndefined();
    expect(purchases[1]?.description?.refund_purchase_id).toBe(
      refundPurchaseId,
    );
    expect(purchases[2]?.description?.refund_purchase_id).toBeUndefined();
    const { rows: subscriptions } = await getPool().query(
      "SELECT status, latest_purchase_id FROM subscriptions WHERE id=$1",
      [subscription_id],
    );
    expect(subscriptions[0]).toMatchObject({
      latest_purchase_id: latestPurchaseId,
      status: "canceled",
    });
  });

  it("restores balance-funded membership cost without calling Stripe", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    await createCredit({
      account_id,
      amount: 24,
      description: { purpose: "account-credit" },
    });
    const { subscription_id } = await createTestMembershipSubscription(
      account_id,
      { cost: 24 },
    );
    const membershipPurchaseId = await createPurchase({
      account_id,
      service: "membership",
      cost: 24,
      description: {
        type: "membership",
        subscription_id,
        class: "member",
        interval: "month",
      },
      tag: "membership-change",
      client: null,
    });
    await getPool().query(
      "UPDATE subscriptions SET latest_purchase_id=$2 WHERE id=$1",
      [subscription_id, membershipPurchaseId],
    );

    await createRefund({
      account_id: uuid(),
      purchase_id: membershipPurchaseId,
      reason: "requested_by_customer",
      notes: "Balance-funded membership",
    });

    expect(mockGetConn).not.toHaveBeenCalled();
    expect(Number(await getBalance({ account_id }))).toBe(24);
    const { rows } = await getPool().query(
      "SELECT status, current_period_end FROM subscriptions WHERE id=$1",
      [subscription_id],
    );
    expect(rows[0]?.status).toBe("canceled");
    expect(new Date(rows[0]?.current_period_end).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it("creates an accounting reversal for another finalized service", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const purchaseId = await createPurchase({
      account_id,
      service: "dedicated-host",
      cost: 3,
      description: {
        type: "dedicated-host",
        host_id: uuid(),
        provider: "test",
        funding_lane: "prepaid",
        hourly_cost_usd: 1,
      },
      client: null,
    });

    const refundPurchaseId = await createRefund({
      account_id: uuid(),
      purchase_id: purchaseId,
      reason: "duplicate",
      notes: "Duplicate accounting transaction",
    });

    expect(mockGetConn).not.toHaveBeenCalled();
    const { rows } = await getPool().query(
      "SELECT cost, description FROM purchases WHERE id=$1",
      [refundPurchaseId],
    );
    expect(Number(rows[0]?.cost)).toBe(-3);
    expect(rows[0]?.description).toMatchObject({
      purchase_id: purchaseId,
      reason: "duplicate",
      type: "refund",
    });
    expect(Number(await getBalance({ account_id }))).toBe(0);
  });

  it("reverses non-subscription membership products without cancellation", async () => {
    const account_id = uuid();
    await createTestAccount(account_id);
    const purchaseId = await createPurchase({
      account_id,
      service: "membership",
      cost: 30,
      description: {
        type: "membership-package",
        package_id: uuid(),
        kind: "test-package",
        membership_class: "member",
        seat_count: 1,
        seat_price: 30,
        total_price: 30,
      },
      client: null,
    });

    const refundPurchaseId = await createRefund({
      account_id: uuid(),
      purchase_id: purchaseId,
      reason: "duplicate",
      notes: "Duplicate package transaction",
    });

    expect(mockGetConn).not.toHaveBeenCalled();
    const { rows } = await getPool().query(
      "SELECT cost, description FROM purchases WHERE id=$1",
      [refundPurchaseId],
    );
    expect(Number(rows[0]?.cost)).toBe(-30);
    expect(rows[0]?.description?.purchase_id).toBe(purchaseId);
  });
});
