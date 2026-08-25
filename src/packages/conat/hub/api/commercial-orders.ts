/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type {
  CommercialCollectionMode,
  CommercialCollectionState,
  CommercialEventSource,
  CommercialFulfillmentState,
  CommercialNextAction,
  CommercialOrder,
  CommercialOrderContact,
  CommercialOrderDiagnostics,
  CommercialOrderEvent,
  CommercialOrderItem,
  CommercialOrderSummary,
  CommercialPaymentMethod,
  CommercialSiteLicensePlan,
  CommercialWorkflowState,
} from "@cocalc/util/commercial-orders";
import type { UserSearchResult } from "@cocalc/util/db-schema/accounts";
import { authFirstRequireAccount } from "./util";

interface CommercialAuthenticatedRequest {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
}

export interface CommercialReadRequest extends CommercialAuthenticatedRequest {
  reason: string;
}

export interface CommercialMutationRequest extends CommercialReadRequest {
  source?: CommercialEventSource;
  idempotency_key?: string;
  expected_version?: number;
}

export interface CommercialOrderListRequest extends CommercialReadRequest {
  workflow_states?: CommercialWorkflowState[];
  collection_states?: CommercialCollectionState[];
  fulfillment_states?: CommercialFulfillmentState[];
  assignee_account_id?: string | null;
  organization?: string;
  zendesk_ticket_id?: number;
  site_license_id?: string;
  needs_action?: boolean;
  stale_before?: string;
  next_action_due_before?: string;
  min_amount?: string;
  max_amount?: string;
  search?: string;
  cursor?: string;
  limit?: number;
  max_bytes?: number;
}

export interface CommercialOrderListResponse {
  orders: CommercialOrderSummary[];
  next_cursor?: string;
  truncated: boolean;
  result_bytes: number;
}

export interface CommercialOrderGetRequest extends CommercialReadRequest {
  id: string;
}

export type CommercialAssigneeListRequest = CommercialReadRequest;

export interface CommercialOrderEventsRequest extends CommercialReadRequest {
  id: string;
  cursor?: string;
  limit?: number;
  max_bytes?: number;
}

export interface CommercialOrderEventsResponse {
  events: CommercialOrderEvent[];
  next_cursor?: string;
  truncated: boolean;
  result_bytes: number;
}

export type CommercialOrderItemInput = Pick<
  CommercialOrderItem,
  "description" | "quantity" | "unit_amount" | "subtotal" | "product_kind"
> &
  Partial<
    Pick<
      CommercialOrderItem,
      | "id"
      | "position"
      | "service_start"
      | "service_end"
      | "product_reference"
      | "metadata"
    >
  >;

export type CommercialOrderContactInput = Pick<
  CommercialOrderContact,
  "role" | "name_snapshot" | "email_snapshot"
> &
  Partial<
    Pick<
      CommercialOrderContact,
      "id" | "crm_person_id" | "organization_snapshot"
    >
  >;

export interface CommercialOrderCreateRequest extends CommercialMutationRequest {
  organization_name: string;
  crm_organization_id?: string;
  customer_account_id?: string;
  site_license_id?: string;
  stripe_customer_id?: string;
  zendesk_ticket_ids?: number[];
  workflow_state?: CommercialWorkflowState;
  collection_mode?: CommercialCollectionMode;
  currency?: string;
  agreed_subtotal: string;
  agreed_total?: string;
  service_starts_at?: string;
  service_ends_at?: string;
  payment_terms_days?: number;
  po_number?: string;
  customer_reference?: string;
  terms_snapshot?: Record<string, unknown>;
  assignee_account_id?: string;
  next_action: CommercialNextAction;
  next_action_due_at?: string;
  items: CommercialOrderItemInput[];
  contacts: CommercialOrderContactInput[];
}

export interface CommercialOrderUpdateRequest extends CommercialMutationRequest {
  id: string;
  changes: Partial<
    Pick<
      CommercialOrder,
      | "crm_organization_id"
      | "organization_name"
      | "customer_account_id"
      | "site_license_id"
      | "stripe_customer_id"
      | "zendesk_ticket_ids"
      | "workflow_state"
      | "collection_mode"
      | "currency"
      | "agreed_subtotal"
      | "agreed_total"
      | "service_starts_at"
      | "service_ends_at"
      | "payment_terms_days"
      | "po_number"
      | "customer_reference"
      | "terms_snapshot"
      | "assignee_account_id"
      | "next_action"
      | "next_action_due_at"
    >
  >;
  items?: CommercialOrderItemInput[];
  contacts?: CommercialOrderContactInput[];
}

export type CommercialOrderRevisionRequest = CommercialOrderUpdateRequest;

export interface CommercialOrderAssignRequest extends CommercialMutationRequest {
  id: string;
  assignee_account_id?: string | null;
  next_action?: CommercialNextAction;
  next_action_due_at?: string | null;
}

export interface CommercialOrderNoteRequest extends CommercialMutationRequest {
  id: string;
  note: string;
}

export interface CommercialOrderTransitionRequest extends CommercialMutationRequest {
  id: string;
}

export interface CommercialInvoicePreview {
  order_id: string;
  order_number: string;
  organization_name: string;
  stripe_customer_id?: string | null;
  billing_contacts: CommercialOrderContact[];
  items: CommercialOrderItem[];
  currency: string;
  subtotal: string;
  total: string;
  due_at: string;
  payment_terms_days: number;
  po_number?: string | null;
  customer_reference?: string | null;
  invoice_memo?: string | null;
  billing_address?: Record<string, string> | null;
  metadata: Record<string, string>;
  ready: boolean;
  blockers: string[];
}

export interface CommercialInvoicePreviewRequest extends CommercialReadRequest {
  id: string;
}

export interface CommercialInvoiceMutationRequest extends CommercialMutationRequest {
  id: string;
  commercial_invoice_id?: string;
}

export interface CommercialReconcilePreviewRequest extends CommercialReadRequest {
  id: string;
  commercial_invoice_id?: string;
}

export interface CommercialReconcilePreview {
  order_id: string;
  commercial_invoice_id: string;
  provider_invoice_id?: string | null;
  local_status: string;
  local_total: string;
  local_amount_due: string;
  last_reconciled_at?: string | null;
  stale: boolean;
  ready: boolean;
  blockers: string[];
}

export interface CommercialInvoiceLinkRequest extends CommercialMutationRequest {
  id: string;
  provider_invoice_id: string;
}

export interface CommercialManualPaymentRequest extends CommercialMutationRequest {
  id: string;
  commercial_invoice_id?: string;
  amount: string;
  currency: string;
  received_at?: string;
  method: CommercialPaymentMethod;
  evidence_reference: string;
  provider_payment_id?: string;
}

export interface CommercialManualInvoiceIssueRequest extends CommercialMutationRequest {
  id: string;
  invoice_reference: string;
  due_at?: string;
  issued_at?: string;
  document_url?: string;
  evidence_reference?: string;
}

export interface CommercialFulfillmentPreviewRequest extends CommercialReadRequest {
  id: string;
}

export interface CommercialFulfillmentPlan {
  order_id: string;
  adapter: "site_license";
  action: "create" | "link" | "update" | "none";
  site_license_id?: string | null;
  plan?: CommercialSiteLicensePlan;
  planned_changes: string[];
  ready: boolean;
  blockers: string[];
}

export interface CommercialProvisionRequest extends CommercialMutationRequest {
  id: string;
  allow_before_payment?: boolean;
  existing_site_license_id?: string;
}

export interface CommercialDiagnosticsRequest extends CommercialReadRequest {
  reconcile?: boolean;
}

export interface CommercialStripeEventRetryRequest extends CommercialMutationRequest {
  event_id: string;
}

export interface CommercialStripeEventRetryResult {
  event_id: string;
  status: "pending";
  commercial_order_id: string;
}

export interface CommercialBackfillRequest extends CommercialMutationRequest {
  candidates: Array<{
    organization_name: string;
    site_license_id?: string;
    customer_account_id?: string;
    zendesk_ticket_ids?: number[];
    agreed_total: string;
    currency?: string;
    next_action: CommercialNextAction;
    next_action_due_at?: string;
  }>;
  commit?: boolean;
}

export interface CommercialBackfillResponse {
  preview: boolean;
  created: CommercialOrder[];
  skipped: Array<{ index: number; reason: string }>;
}

export interface CommercialOrdersApi {
  list: (
    opts: CommercialOrderListRequest,
  ) => Promise<CommercialOrderListResponse>;
  get: (opts: CommercialOrderGetRequest) => Promise<CommercialOrder>;
  listAssignees: (
    opts: CommercialAssigneeListRequest,
  ) => Promise<UserSearchResult[]>;
  events: (
    opts: CommercialOrderEventsRequest,
  ) => Promise<CommercialOrderEventsResponse>;
  create: (opts: CommercialOrderCreateRequest) => Promise<CommercialOrder>;
  update: (opts: CommercialOrderUpdateRequest) => Promise<CommercialOrder>;
  revise: (opts: CommercialOrderRevisionRequest) => Promise<CommercialOrder>;
  assign: (opts: CommercialOrderAssignRequest) => Promise<CommercialOrder>;
  addNote: (opts: CommercialOrderNoteRequest) => Promise<CommercialOrder>;
  approve: (opts: CommercialOrderTransitionRequest) => Promise<CommercialOrder>;
  cancel: (opts: CommercialOrderTransitionRequest) => Promise<CommercialOrder>;
  invoicePreview: (
    opts: CommercialInvoicePreviewRequest,
  ) => Promise<CommercialInvoicePreview>;
  createInvoiceDraft: (
    opts: CommercialInvoiceMutationRequest,
  ) => Promise<CommercialOrder>;
  linkExistingInvoice: (
    opts: CommercialInvoiceLinkRequest,
  ) => Promise<CommercialOrder>;
  sendInvoice: (
    opts: CommercialInvoiceMutationRequest,
  ) => Promise<CommercialOrder>;
  voidInvoice: (
    opts: CommercialInvoiceMutationRequest,
  ) => Promise<CommercialOrder>;
  reconcileInvoice: (
    opts: CommercialInvoiceMutationRequest,
  ) => Promise<CommercialOrder>;
  reconcilePreview: (
    opts: CommercialReconcilePreviewRequest,
  ) => Promise<CommercialReconcilePreview>;
  recordManualPayment: (
    opts: CommercialManualPaymentRequest,
  ) => Promise<CommercialOrder>;
  issueManualInvoice: (
    opts: CommercialManualInvoiceIssueRequest,
  ) => Promise<CommercialOrder>;
  fulfillmentPreview: (
    opts: CommercialFulfillmentPreviewRequest,
  ) => Promise<CommercialFulfillmentPlan>;
  provision: (opts: CommercialProvisionRequest) => Promise<CommercialOrder>;
  endFulfillment: (
    opts: CommercialOrderTransitionRequest,
  ) => Promise<CommercialOrder>;
  diagnostics: (
    opts: CommercialDiagnosticsRequest,
  ) => Promise<CommercialOrderDiagnostics>;
  retryStripeEvent: (
    opts: CommercialStripeEventRetryRequest,
  ) => Promise<CommercialStripeEventRetryResult>;
  backfill: (
    opts: CommercialBackfillRequest,
  ) => Promise<CommercialBackfillResponse>;
}

export const commercialOrders = {
  list: authFirstRequireAccount,
  get: authFirstRequireAccount,
  listAssignees: authFirstRequireAccount,
  events: authFirstRequireAccount,
  create: authFirstRequireAccount,
  update: authFirstRequireAccount,
  revise: authFirstRequireAccount,
  assign: authFirstRequireAccount,
  addNote: authFirstRequireAccount,
  approve: authFirstRequireAccount,
  cancel: authFirstRequireAccount,
  invoicePreview: authFirstRequireAccount,
  createInvoiceDraft: authFirstRequireAccount,
  linkExistingInvoice: authFirstRequireAccount,
  sendInvoice: authFirstRequireAccount,
  voidInvoice: authFirstRequireAccount,
  reconcileInvoice: authFirstRequireAccount,
  reconcilePreview: authFirstRequireAccount,
  recordManualPayment: authFirstRequireAccount,
  issueManualInvoice: authFirstRequireAccount,
  fulfillmentPreview: authFirstRequireAccount,
  provision: authFirstRequireAccount,
  endFulfillment: authFirstRequireAccount,
  diagnostics: authFirstRequireAccount,
  retryStripeEvent: authFirstRequireAccount,
  backfill: authFirstRequireAccount,
};
