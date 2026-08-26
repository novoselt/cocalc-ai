/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export const COMMERCIAL_WORKFLOW_STATES = [
  "draft",
  "awaiting_customer",
  "ready_to_invoice",
  "awaiting_payment",
  "complete",
  "cancelled",
] as const;

export type CommercialWorkflowState =
  (typeof COMMERCIAL_WORKFLOW_STATES)[number];

// This is the single operational task an assignee owns next. Detailed context
// belongs in audited order notes, not in an unbounded queue-state string.
export const COMMERCIAL_NEXT_ACTIONS = [
  "Review agreement",
  "Contact customer",
  "Await customer response",
  "Confirm billing details",
  "Obtain purchase order",
  "Approve agreement",
  "Create invoice",
  "Send invoice",
  "Collect payment",
  "Follow up on overdue payment",
  "Reconcile payment",
  "Provision service",
  "Resolve exception",
  "Complete",
  "Cancelled",
] as const;

export type CommercialNextAction = (typeof COMMERCIAL_NEXT_ACTIONS)[number];

export const COMMERCIAL_COLLECTION_MODES = [
  "stripe_invoice",
  "manual_invoice",
  "complimentary",
] as const;

export type CommercialCollectionMode =
  (typeof COMMERCIAL_COLLECTION_MODES)[number];

export const COMMERCIAL_COLLECTION_STATES = [
  "not_invoiced",
  "draft_invoice",
  "open",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "uncollectible",
  "waived",
] as const;

export type CommercialCollectionState =
  (typeof COMMERCIAL_COLLECTION_STATES)[number];

export const COMMERCIAL_FULFILLMENT_STATES = [
  "not_provisioned",
  "provisioned",
  "ended",
] as const;

export type CommercialFulfillmentState =
  (typeof COMMERCIAL_FULFILLMENT_STATES)[number];

export const COMMERCIAL_CONTACT_ROLES = [
  "primary",
  "billing",
  "procurement",
  "technical",
  "manager",
] as const;

export type CommercialContactRole = (typeof COMMERCIAL_CONTACT_ROLES)[number];

export const COMMERCIAL_INVOICE_STATUSES = [
  "creating",
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
  "failed",
] as const;

export type CommercialInvoiceStatus =
  (typeof COMMERCIAL_INVOICE_STATUSES)[number];

export const COMMERCIAL_QUOTE_STATUSES = ["issued", "void"] as const;

export type CommercialQuoteStatus = (typeof COMMERCIAL_QUOTE_STATUSES)[number];

export const COMMERCIAL_PAYMENT_METHODS = [
  "card",
  "ach",
  "bank_transfer",
  "check",
  "wire",
  "credit",
  "other",
] as const;

export type CommercialPaymentMethod =
  (typeof COMMERCIAL_PAYMENT_METHODS)[number];

export const COMMERCIAL_EVENT_SOURCES = [
  "admin-ui",
  "cli",
  "stripe-webhook",
  "reconciler",
  "migration",
  "system",
] as const;

export type CommercialEventSource = (typeof COMMERCIAL_EVENT_SOURCES)[number];

export interface CommercialOrderItem {
  id: string;
  commercial_order_id: string;
  position: number;
  description: string;
  quantity: string;
  unit_amount: string;
  subtotal: string;
  service_start?: string | null;
  service_end?: string | null;
  product_kind: string;
  product_reference?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CommercialOrderContact {
  id: string;
  commercial_order_id: string;
  crm_person_id?: string | null;
  role: CommercialContactRole;
  name_snapshot: string;
  email_snapshot: string;
  organization_snapshot?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercialInvoice {
  id: string;
  commercial_order_id: string;
  provider: "stripe" | "manual";
  provider_customer_id?: string | null;
  provider_invoice_id?: string | null;
  provider_payment_intent_id?: string | null;
  status: CommercialInvoiceStatus;
  currency: string;
  subtotal: string;
  tax: string;
  total: string;
  amount_due: string;
  amount_paid: string;
  due_at?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf_url?: string | null;
  sent_at?: string | null;
  paid_at?: string | null;
  voided_at?: string | null;
  last_reconciled_at?: string | null;
  reconcile_attempt_count: number;
  last_reconcile_error?: string | null;
  idempotency_key: string;
  provider_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CommercialQuote {
  id: string;
  commercial_order_id: string;
  quote_number: string;
  status: CommercialQuoteStatus;
  currency: string;
  subtotal: string;
  total: string;
  issued_at: string;
  valid_until: string;
  voided_at?: string | null;
  document_filename: string;
  document_mime_type: "application/pdf";
  document_sha256: string;
  document_size: number;
  snapshot: Record<string, unknown>;
  created_by_account_id: string;
  voided_by_account_id?: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface CommercialPayment {
  id: string;
  commercial_order_id: string;
  commercial_invoice_id?: string | null;
  provider: string;
  provider_payment_id?: string | null;
  amount: string;
  currency: string;
  status: string;
  received_at: string;
  method: CommercialPaymentMethod;
  recorded_by_account_id?: string | null;
  evidence_reference?: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface CommercialOrderEvent {
  id: string;
  commercial_order_id: string;
  event_type: string;
  actor_account_id?: string | null;
  source: CommercialEventSource;
  reason: string;
  idempotency_key: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CommercialOrder {
  id: string;
  order_number: string;
  crm_organization_id?: string | null;
  organization_name: string;
  customer_account_id?: string | null;
  stripe_customer_id?: string | null;
  site_license_id?: string | null;
  zendesk_ticket_ids: number[];
  workflow_state: CommercialWorkflowState;
  collection_mode: CommercialCollectionMode;
  collection_state: CommercialCollectionState;
  fulfillment_state: CommercialFulfillmentState;
  currency: string;
  agreed_subtotal: string;
  agreed_total: string;
  service_starts_at?: string | null;
  service_ends_at?: string | null;
  payment_terms_days?: number | null;
  po_number?: string | null;
  customer_reference?: string | null;
  terms_snapshot: Record<string, unknown>;
  assignee_account_id?: string | null;
  next_action: CommercialNextAction;
  next_action_due_at?: string | null;
  approved_at?: string | null;
  approved_by_account_id?: string | null;
  provisioned_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_by_account_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  items: CommercialOrderItem[];
  contacts: CommercialOrderContact[];
  quotes: CommercialQuote[];
  invoices: CommercialInvoice[];
  payments: CommercialPayment[];
}

export interface CommercialOrderSummary extends Omit<
  CommercialOrder,
  "items" | "contacts" | "quotes" | "invoices" | "payments" | "terms_snapshot"
> {
  billing_email?: string | null;
  latest_invoice_id?: string | null;
  latest_invoice_status?: CommercialInvoiceStatus | null;
  latest_invoice_amount_due?: string | null;
  latest_invoice_due_at?: string | null;
  latest_invoice_sent_at?: string | null;
  latest_invoice_created_at?: string | null;
  last_activity_at: string;
}

export interface CommercialSiteLicensePlan {
  name: string;
  organization_name?: string;
  owner_account_id: string;
  manager_account_ids?: string[];
  allowed_domains: string[];
  pools: Array<{
    membership_class: string;
    seat_limit: number;
    label?: string;
  }>;
  starts_at: string;
  expires_at: string;
  custom_terms_url?: string;
  custom_policy_url?: string;
  terms_version_label?: string;
  renewal_policy?: string;
  overage_policy?: string;
  metadata?: Record<string, unknown>;
}

export interface CommercialUnlinkedStripeInvoice {
  provider_invoice_id: string;
  status: string;
  currency: string;
  amount_due: string;
  commercial_order_id?: string | null;
  commercial_invoice_id?: string | null;
  order_number?: string | null;
  created_at?: string | null;
}

export interface CommercialOrderDiagnostics {
  generated_at: string;
  counts: Record<string, number>;
  amounts: Record<string, string>;
  reconciliation: {
    provider_local_mismatch_count: number;
    oldest_reconciliation_lag_seconds: number;
  };
  stale_invoice_ids: string[];
  inconsistent_order_ids: string[];
  review_queues: {
    truncated: Record<string, boolean>;
    active_commercial_site_license_ids: string[];
    unlinked_commercial_stripe_invoices: CommercialUnlinkedStripeInvoice[];
    failed_stripe_events: Array<{
      event_id: string;
      event_type: string;
      status: string;
      commercial_order_id?: string | null;
      commercial_invoice_id?: string | null;
      provider_invoice_id?: string | null;
      attempt_count: number;
      next_attempt_at: string;
      last_error?: string | null;
      created_at: string;
      updated_at: string;
    }>;
    indeterminate_provider_operations: Array<{
      id: string;
      commercial_order_id: string;
      commercial_invoice_id?: string | null;
      operation: string;
      status: string;
      attempt_count: number;
      last_error?: string | null;
      remote_started_at?: string | null;
      completed_at?: string | null;
      created_at: string;
      updated_at: string;
    }>;
    /** @deprecated Use failed_stripe_events for actionable details. */
    failed_stripe_event_ids: string[];
    /** @deprecated Use indeterminate_provider_operations. */
    indeterminate_provider_operation_ids: string[];
    open_orders_missing_due_date_ids: string[];
  };
}
