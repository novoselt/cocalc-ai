/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { getLogger } from "@cocalc/backend/logger";
import type { BayOpsCrmOutreachZendeskEvent } from "@cocalc/conat/inter-bay/api";
import type { Request, Response } from "express";

import getPool from "@cocalc/database/pool";
import { getServerSettings } from "@cocalc/database/settings/server-settings";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getConfiguredClusterSeedBayId } from "@cocalc/server/cluster-config";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";

const logger = getLogger("server:crm:outreach:webhook");
const MAX_AGE_MS = 5 * 60_000;

export type OutreachZendeskEventEnvelope = BayOpsCrmOutreachZendeskEvent;

function singleHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function verifyZendeskWebhookSignature({
  body,
  timestamp,
  signature,
  secret,
  now = Date.now(),
}: {
  body: Buffer;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
}): boolean {
  const receivedAt = new Date(timestamp).valueOf();
  if (!Number.isFinite(receivedAt) || Math.abs(now - receivedAt) > MAX_AGE_MS)
    return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp)
    .update(body)
    .digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function normalizeOutreachZendeskEvent(
  value: any,
): OutreachZendeskEventEnvelope {
  const eventId = `${value?.event_id ?? value?.id ?? ""}`.trim();
  const eventType =
    `${value?.event_type ?? value?.type ?? "ticket.updated"}`.trim();
  const ticketId = Number(
    value?.zendesk_ticket_id ?? value?.ticket_id ?? value?.ticket?.id,
  );
  const commentId = Number(
    value?.zendesk_comment_id ?? value?.comment_id ?? value?.comment?.id,
  );
  const occurredAt = new Date(
    value?.occurred_at ?? value?.timestamp ?? Date.now(),
  );
  if (!eventId || eventId.length > 500)
    throw Error("event_id is required and must be at most 500 characters");
  if (!eventType || eventType.length > 100)
    throw Error("event_type is required and must be at most 100 characters");
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0)
    throw Error("zendesk_ticket_id must be a positive integer");
  if (!Number.isFinite(occurredAt.valueOf()))
    throw Error("occurred_at must be a timestamp");
  const suppliedPayload =
    value?.payload != null && typeof value.payload === "object"
      ? value.payload
      : {};
  return {
    event_id: eventId,
    event_type: eventType,
    zendesk_ticket_id: ticketId,
    zendesk_comment_id:
      Number.isSafeInteger(commentId) && commentId > 0 ? commentId : undefined,
    occurred_at: occurredAt.toISOString(),
    payload: {
      ticket_status:
        `${value?.ticket_status ?? value?.ticket?.status ?? suppliedPayload.ticket_status ?? ""}`.slice(
          0,
          50,
        ),
      source:
        `${value?.source ?? suppliedPayload.source ?? "zendesk-webhook"}`.slice(
          0,
          100,
        ),
    },
  };
}

export function validateOutreachZendeskEventEnvelope(
  value: unknown,
): OutreachZendeskEventEnvelope {
  const event = value as Partial<OutreachZendeskEventEnvelope> | null;
  if (event == null || typeof event !== "object") {
    throw Error("CRM outreach Zendesk event must be an object");
  }
  if (typeof event.event_id !== "string") {
    throw Error("event_id must be a string");
  }
  if (typeof event.event_type !== "string") {
    throw Error("event_type must be a string");
  }
  if (typeof event.zendesk_ticket_id !== "number") {
    throw Error("zendesk_ticket_id must be a number");
  }
  if (
    event.zendesk_comment_id != null &&
    typeof event.zendesk_comment_id !== "number"
  ) {
    throw Error("zendesk_comment_id must be a number");
  }
  if (typeof event.occurred_at !== "string" || !event.occurred_at.trim()) {
    throw Error("occurred_at must be a timestamp string");
  }
  if (
    event.payload != null &&
    (typeof event.payload !== "object" || Array.isArray(event.payload))
  ) {
    throw Error("payload must be an object");
  }
  return normalizeOutreachZendeskEvent(event);
}

export async function enqueueOutreachZendeskEvent(
  event: OutreachZendeskEventEnvelope,
): Promise<void> {
  const normalizedEvent = validateOutreachZendeskEventEnvelope(event);
  if (getConfiguredBayId() !== getConfiguredClusterSeedBayId()) {
    await getInterBayBridge()
      .bayOps(getConfiguredClusterSeedBayId(), { timeout_ms: 30_000 })
      .ingestCrmOutreachZendeskEventInternal({
        event: normalizedEvent,
      });
    return;
  }
  await getPool().query(
    `INSERT INTO crm_outreach_zendesk_events
      (event_id,zendesk_ticket_id,zendesk_comment_id,event_type,occurred_at,payload,state,attempt_count,next_attempt_at)
     VALUES($1,$2,$3,$4,$5,$6,'pending',0,NOW()) ON CONFLICT(event_id) DO NOTHING`,
    [
      normalizedEvent.event_id,
      normalizedEvent.zendesk_ticket_id,
      normalizedEvent.zendesk_comment_id ?? null,
      normalizedEvent.event_type,
      normalizedEvent.occurred_at,
      normalizedEvent.payload ?? {},
    ],
  );
}

export default async function outreachZendeskWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const settings = await getServerSettings();
  if (settings.crm_outreach_webhook_enabled !== true) {
    res.status(503).json({ error: "crm_outreach_webhook_disabled" });
    return;
  }
  const secret = `${settings.crm_outreach_zendesk_webhook_secret ?? ""}`;
  if (!secret) {
    res.status(503).json({ error: "crm_outreach_webhook_not_configured" });
    return;
  }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const timestamp = singleHeader(
    req.headers["x-zendesk-webhook-signature-timestamp"],
  );
  const signature = singleHeader(req.headers["x-zendesk-webhook-signature"]);
  if (!verifyZendeskWebhookSignature({ body, timestamp, signature, secret })) {
    logger.warn("CRM outreach Zendesk webhook signature rejected");
    res.status(401).json({ error: "invalid_zendesk_webhook_signature" });
    return;
  }
  try {
    const event = normalizeOutreachZendeskEvent(
      JSON.parse(body.toString("utf8")),
    );
    await enqueueOutreachZendeskEvent(event);
    res.status(202).json({ accepted: true, event_id: event.event_id });
  } catch (err) {
    logger.warn("CRM outreach Zendesk webhook rejected", { error: `${err}` });
    res.status(400).json({ error: "invalid_zendesk_webhook_event" });
  }
}
