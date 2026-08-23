/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Flex, Tag, Typography } from "antd";
import type { ReactNode } from "react";

import { Icon } from "@cocalc/frontend/components";
import type {
  CommercialCollectionState,
  CommercialFulfillmentState,
  CommercialOrder,
  CommercialOrderSummary,
  CommercialWorkflowState,
} from "@cocalc/util/commercial-orders";

const { Text } = Typography;

export const WORKFLOW_LABELS: Record<CommercialWorkflowState, string> = {
  draft: "Draft",
  awaiting_customer: "Awaiting customer",
  ready_to_invoice: "Ready to invoice",
  awaiting_payment: "Awaiting payment",
  complete: "Complete",
  cancelled: "Cancelled",
};

export const COLLECTION_LABELS: Record<CommercialCollectionState, string> = {
  not_invoiced: "Not invoiced",
  draft_invoice: "Draft invoice",
  open: "Open",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  uncollectible: "Uncollectible",
  waived: "Waived",
};

export const FULFILLMENT_LABELS: Record<CommercialFulfillmentState, string> = {
  not_provisioned: "Not provisioned",
  provisioned: "Provisioned",
  ended: "Ended",
};

export function formatMoney(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency.toUpperCase()}`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(value);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}

export function formatDate(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatShortId(value?: string | null): string {
  if (!value) return "Not set";
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function humanizeKey(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatReceivablesError(error: unknown): string {
  const value = `${error}`;
  if (!value.includes("disabled by site settings")) return value;
  return `${value}. Enable the corresponding Billing & Commerce → Accounts Receivable feature flag in Admin → Site Settings, then retry.`;
}

export function StateTriplet({
  order,
  compact = false,
}: {
  order: Pick<
    CommercialOrder | CommercialOrderSummary,
    "workflow_state" | "collection_state" | "fulfillment_state"
  >;
  compact?: boolean;
}) {
  const states: Array<{ label: string; value: string }> = [
    { label: "Workflow", value: WORKFLOW_LABELS[order.workflow_state] },
    { label: "Collection", value: COLLECTION_LABELS[order.collection_state] },
    {
      label: "Fulfillment",
      value: FULFILLMENT_LABELS[order.fulfillment_state],
    },
  ];
  return (
    <Flex gap={compact ? 2 : "small"} vertical={compact} wrap={!compact}>
      {states.map(({ label, value }) => (
        <Tag key={label} style={{ marginInlineEnd: 0 }}>
          <Text strong>{label}:</Text> {value}
        </Tag>
      ))}
    </Flex>
  );
}

export function IndependentStateAlerts({
  order,
}: {
  order: Pick<
    CommercialOrder | CommercialOrderSummary,
    "collection_state" | "fulfillment_state"
  >;
}) {
  const collectionSatisfied = ["paid", "waived"].includes(
    order.collection_state,
  );
  return (
    <Flex vertical gap="small" role="status" aria-live="polite">
      {order.fulfillment_state === "provisioned" && !collectionSatisfied ? (
        <Alert
          showIcon
          type="warning"
          title="Service is provisioned, but collection is not complete"
          description="Fulfillment does not imply payment. Keep collection follow-up active."
        />
      ) : null}
      {order.collection_state === "paid" &&
      order.fulfillment_state === "not_provisioned" ? (
        <Alert
          showIcon
          type="warning"
          title="Payment is complete, but service is not provisioned"
          description="Collection does not imply fulfillment. Provision or link the promised service."
        />
      ) : null}
    </Flex>
  );
}

export function ExternalLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} <Icon name="external-link" />
    </a>
  );
}
