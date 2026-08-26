/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { getLogger } from "@cocalc/backend/logger";
import * as metrics from "@cocalc/backend/metrics";
import type { CrmOutreachDiagnostics } from "@cocalc/util/crm-outreach";

const logger = getLogger("server:crm:outreach:observability");

type MetricSet = {
  queue?: any;
  provider?: any;
  providerLatency?: any;
  webhookLag?: any;
  engagement?: any;
  suppression?: any;
};

let metricSet: MetricSet | undefined;

function getMetrics(): MetricSet {
  if (metricSet != null) return metricSet;
  try {
    metricSet = {
      queue: metrics.newGauge(
        "server",
        "crm_outreach_queue_count",
        "Current CRM outreach operational queue counts.",
        ["queue"],
      ),
      provider: metrics.newCounter(
        "server",
        "crm_outreach_provider_operation_total",
        "CRM outreach Zendesk provider operation outcomes.",
        ["operation", "result"],
      ),
      providerLatency: metrics.newHistogram(
        "server",
        "crm_outreach_provider_latency_seconds",
        "CRM outreach Zendesk provider operation latency.",
        {
          labels: ["operation"],
          buckets: [0.1, 0.5, 1, 2.5, 5, 15, 30, 60],
        },
      ),
      webhookLag: metrics.newHistogram(
        "server",
        "crm_outreach_webhook_lag_seconds",
        "Time from Zendesk outreach event occurrence to CRM processing.",
        { buckets: [1, 5, 15, 60, 300, 900, 3600, 21600] },
      ),
      engagement: metrics.newCounter(
        "server",
        "crm_outreach_engagement_total",
        "CRM outreach engagement observations by kind.",
        ["kind"],
      ),
      suppression: metrics.newCounter(
        "server",
        "crm_outreach_suppression_total",
        "CRM outreach suppression changes.",
        ["action", "scope"],
      ),
    };
  } catch (err) {
    logger.debug(`CRM outreach metrics unavailable: ${err}`);
    metricSet = {};
  }
  return metricSet;
}

export function recordOutreachProviderOperation(
  operation: string,
  result: string,
  latencyMs: number,
): void {
  const current = getMetrics();
  current.provider?.labels(operation, result).inc();
  if (Number.isFinite(latencyMs) && latencyMs >= 0)
    current.providerLatency?.labels(operation).observe(latencyMs / 1_000);
}

export function recordOutreachWebhookLag(occurredAt: unknown): void {
  const timestamp = new Date(`${occurredAt ?? ""}`).valueOf();
  if (Number.isFinite(timestamp)) {
    getMetrics().webhookLag?.observe(
      Math.max(0, Date.now() - timestamp) / 1_000,
    );
  }
}

export function recordOutreachEngagement(kind: string): void {
  getMetrics().engagement?.labels(kind).inc();
}

export function recordOutreachSuppression(
  action: "add" | "revoke",
  scope: string,
): void {
  getMetrics().suppression?.labels(action, scope).inc();
}

export function updateOutreachQueueMetrics(
  diagnostics: CrmOutreachDiagnostics,
): void {
  const current = getMetrics();
  for (const [queue, count] of Object.entries(diagnostics.counts))
    current.queue?.labels(queue).set(count);
}
