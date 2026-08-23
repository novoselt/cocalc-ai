/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { getLogger } from "@cocalc/backend/logger";
import * as metrics from "@cocalc/backend/metrics";
import type { CommercialOrderDiagnostics } from "@cocalc/util/commercial-orders";

const logger = getLogger("server:commercial-orders:observability");

type MetricSet = {
  queueCount?: any;
  queueAmount?: any;
  operator?: any;
  providerFailure?: any;
  reconciliation?: any;
  reconciliationLag?: any;
  providerMismatch?: any;
  webhookLatency?: any;
};

let metricSet: MetricSet | undefined;

function getMetrics(): MetricSet {
  if (metricSet != null) return metricSet;
  try {
    metricSet = {
      queueCount: metrics.newGauge(
        "server",
        "commercial_receivables_queue_count",
        "Current commercial receivables queue counts.",
        ["queue"],
      ),
      queueAmount: metrics.newGauge(
        "server",
        "commercial_receivables_queue_amount",
        "Current exact commercial receivables amounts represented as decimal gauges.",
        ["queue", "currency"],
      ),
      operator: metrics.newCounter(
        "server",
        "commercial_receivables_operator_total",
        "Commercial receivables operator API outcomes.",
        ["action", "result"],
      ),
      providerFailure: metrics.newCounter(
        "server",
        "commercial_receivables_provider_failure_total",
        "Commercial receivables provider operation failures.",
        ["operation"],
      ),
      reconciliation: metrics.newCounter(
        "server",
        "commercial_receivables_reconciliation_total",
        "Commercial receivables reconciliation outcomes.",
        ["source", "result"],
      ),
      reconciliationLag: metrics.newGauge(
        "server",
        "commercial_receivables_reconciliation_lag_seconds",
        "Age in seconds of the oldest nonterminal Stripe invoice reconciliation.",
      ),
      providerMismatch: metrics.newGauge(
        "server",
        "commercial_receivables_provider_local_mismatch_count",
        "Current number of Stripe invoices whose normalized provider state differs from local state.",
      ),
      webhookLatency: metrics.newHistogram(
        "server",
        "commercial_receivables_webhook_latency_seconds",
        "Seconds from Stripe event creation to local commercial reconciliation.",
        { buckets: [0.1, 0.5, 1, 2.5, 5, 15, 60, 300, 1800] },
      ),
    };
  } catch (err) {
    logger.debug(`commercial receivables metrics unavailable: ${err}`);
    metricSet = {};
  }
  return metricSet;
}

export function recordCommercialOperator(
  action: string,
  result: "success" | "error" | "conflict" | "replay",
): void {
  getMetrics().operator?.labels(action, result).inc();
}

export function recordCommercialProviderFailure(operation: string): void {
  getMetrics().providerFailure?.labels(operation).inc();
}

export function recordCommercialReconciliation(
  source: "webhook" | "scheduled" | "manual",
  result: "success" | "failed" | "ignored",
): void {
  getMetrics().reconciliation?.labels(source, result).inc();
}

export function recordCommercialWebhookLatency(latencyMs: number): void {
  if (Number.isFinite(latencyMs) && latencyMs >= 0) {
    getMetrics().webhookLatency?.observe(latencyMs / 1000);
  }
}

export function updateCommercialQueueMetrics(
  diagnostics: CommercialOrderDiagnostics,
): void {
  const current = getMetrics();
  for (const [queue, value] of Object.entries(diagnostics.counts)) {
    current.queueCount?.labels(queue).set(value);
  }
  for (const [queue, amount] of Object.entries(diagnostics.amounts)) {
    const numeric = Number(amount);
    if (Number.isFinite(numeric)) {
      current.queueAmount?.labels(queue, "usd").set(numeric);
    }
  }
  current.reconciliationLag?.set(
    diagnostics.reconciliation.oldest_reconciliation_lag_seconds,
  );
  current.providerMismatch?.set(
    diagnostics.reconciliation.provider_local_mismatch_count,
  );
}
