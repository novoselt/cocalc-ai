/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";

const mockCentralLog = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock("@cocalc/database/postgres/central-log", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCentralLog(...args),
}));
jest.mock("@cocalc/server/stripe/connection", () => ({
  __esModule: true,
  default: async () => ({ publishable_key: "pk_test_receivables" }),
}));
jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "reconcile-test-bay",
}));
jest.mock("@cocalc/server/cluster-config", () => ({
  getConfiguredClusterSeedBayId: () => "reconcile-test-bay",
}));

import getPool from "@cocalc/database/pool";
import {
  enqueueCommercialStripeEvent,
  processCommercialStripeEventQueue,
} from "./reconcile";

const describePglite =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe : describe.skip;

describePglite("commercial Stripe event queue", () => {
  const mockReconcile = jest.fn();
  const mockReconcileQuote = jest.fn();
  const originalEnv = {
    COCALC_DB: process.env.COCALC_DB,
    COCALC_PGLITE_DATA_DIR: process.env.COCALC_PGLITE_DATA_DIR,
  };

  beforeAll(async () => {
    process.env.COCALC_DB = "pglite";
    process.env.COCALC_PGLITE_DATA_DIR = "memory://";
    const { SCHEMA } = await import("@cocalc/util/db-schema");
    const { syncSchema } =
      await import("@cocalc/database/postgres/schema/sync");
    await syncSchema({
      commercial_stripe_events: SCHEMA.commercial_stripe_events,
    });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCentralLog.mockResolvedValue(undefined);
    await getPool().query("DELETE FROM commercial_stripe_events");
  });

  afterAll(async () => {
    const { closePglite } = await import("@cocalc/database/pglite");
    await closePglite();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function enqueue() {
    const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
    await enqueueCommercialStripeEvent({
      event_id: eventId,
      event_type: "invoice.updated",
      livemode: false,
      commercial_order_id: randomUUID(),
      commercial_invoice_id: randomUUID(),
    });
    return eventId;
  }

  it("uses exponential retry delay and dead-letters after bounded attempts", async () => {
    const eventId = await enqueue();
    mockReconcile.mockRejectedValue(Error("temporary Stripe outage"));

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await getPool().query(
        "UPDATE commercial_stripe_events SET next_attempt_at=NOW() WHERE event_id=$1",
        [eventId],
      );
      const result = await processCommercialStripeEventQueue(1, mockReconcile, {
        warn: mockLoggerWarn,
      });
      expect(result.failed).toBe(1);
      const { rows } = await getPool().query(
        "SELECT status,attempt_count,next_attempt_at,processed_at FROM commercial_stripe_events WHERE event_id=$1",
        [eventId],
      );
      expect(rows[0].attempt_count).toBe(attempt);
      if (attempt < 8) {
        expect(rows[0].status).toBe("failed");
        expect(new Date(rows[0].next_attempt_at).getTime()).toBeGreaterThan(
          Date.now(),
        );
      } else {
        expect(rows[0].status).toBe("dead_letter");
        expect(rows[0].processed_at).toBeTruthy();
      }
    }
    expect(mockCentralLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "commercial_stripe_webhook_dead_lettered",
      }),
    );
  });

  it("dead-letters a permanent identity mismatch immediately", async () => {
    const eventId = await enqueue();
    mockReconcile.mockRejectedValue(
      Error("Stripe invoice metadata does not match the commercial invoice"),
    );
    await processCommercialStripeEventQueue(1, mockReconcile, {
      warn: mockLoggerWarn,
    });
    const { rows } = await getPool().query(
      "SELECT status,attempt_count FROM commercial_stripe_events WHERE event_id=$1",
      [eventId],
    );
    expect(rows[0]).toMatchObject({ status: "dead_letter", attempt_count: 1 });
  });

  it("marks successful delivery processed", async () => {
    const eventId = await enqueue();
    mockReconcile.mockResolvedValue({});
    await expect(
      processCommercialStripeEventQueue(1, mockReconcile, {
        warn: mockLoggerWarn,
      }),
    ).resolves.toEqual({ processed: 1, failed: 0 });
    expect(mockLoggerWarn.mock.calls).toEqual([]);
    const { rows } = await getPool().query(
      "SELECT status,processed_at FROM commercial_stripe_events WHERE event_id=$1",
      [eventId],
    );
    expect(rows[0].status).toBe("processed");
    expect(rows[0].processed_at).toBeTruthy();
  });

  it("routes quote events through quote reconciliation", async () => {
    const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
    const orderId = randomUUID();
    const quoteId = randomUUID();
    await enqueueCommercialStripeEvent({
      event_id: eventId,
      event_type: "quote.finalized",
      livemode: false,
      commercial_order_id: orderId,
      commercial_quote_id: quoteId,
      provider_quote_id: "qt_test_quote",
    });
    mockReconcileQuote.mockResolvedValue({});

    await expect(
      processCommercialStripeEventQueue(
        1,
        mockReconcile,
        { warn: mockLoggerWarn },
        mockReconcileQuote,
      ),
    ).resolves.toEqual({ processed: 1, failed: 0 });

    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockReconcileQuote).toHaveBeenCalledWith({
      order_id: orderId,
      commercial_quote_id: quoteId,
      reason: "Stripe webhook quote.finalized",
      source: "stripe-webhook",
      event_idempotency_key: `stripe-event:${eventId}`,
    });
  });
});
