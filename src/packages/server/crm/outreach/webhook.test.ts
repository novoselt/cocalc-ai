/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createHmac } from "node:crypto";

import {
  normalizeOutreachZendeskEvent,
  verifyZendeskWebhookSignature,
} from "./webhook";

describe("CRM outreach Zendesk webhook", () => {
  it("accepts an exact recent signature and rejects tampering or staleness", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    const timestamp = new Date(now).toISOString();
    const body = Buffer.from('{"event_id":"evt-1"}');
    const secret = "test-webhook-secret";
    const signature = createHmac("sha256", secret)
      .update(timestamp)
      .update(body)
      .digest("base64");
    expect(
      verifyZendeskWebhookSignature({
        body,
        timestamp,
        signature,
        secret,
        now,
      }),
    ).toBe(true);
    expect(
      verifyZendeskWebhookSignature({
        body: Buffer.from('{"event_id":"tampered"}'),
        timestamp,
        signature,
        secret,
        now,
      }),
    ).toBe(false);
    expect(
      verifyZendeskWebhookSignature({
        body,
        timestamp,
        signature,
        secret,
        now: now + 5 * 60_000 + 1,
      }),
    ).toBe(false);
  });

  it("normalizes only bounded ticket event data", () => {
    expect(
      normalizeOutreachZendeskEvent({
        event_id: "evt-1",
        type: "ticket.comment_created",
        ticket: { id: 20599, status: "open" },
        comment: { id: 1234, body: "not retained" },
        timestamp: "2026-08-26T12:00:00Z",
      }),
    ).toEqual({
      event_id: "evt-1",
      event_type: "ticket.comment_created",
      zendesk_ticket_id: 20599,
      zendesk_comment_id: 1234,
      occurred_at: "2026-08-26T12:00:00.000Z",
      payload: {
        ticket_status: "open",
        source: "zendesk-webhook",
      },
    });
    expect(() => normalizeOutreachZendeskEvent({ event_id: "evt-2" })).toThrow(
      "zendesk_ticket_id must be a positive integer",
    );
  });
});
