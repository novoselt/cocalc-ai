/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export const CRM_OUTREACH_KINDS = [
  "adoption_pilot",
  "renewal",
  "expansion",
  "other",
] as const;
export type CrmOutreachKind = (typeof CRM_OUTREACH_KINDS)[number];

export const CRM_OUTREACH_TEMPLATE_STATES = [
  "draft",
  "active",
  "retired",
] as const;
export type CrmOutreachTemplateState =
  (typeof CRM_OUTREACH_TEMPLATE_STATES)[number];

export const CRM_OUTREACH_FOLLOW_UP_POLICIES = ["no_response", "none"] as const;
export type CrmOutreachFollowUpPolicy =
  (typeof CRM_OUTREACH_FOLLOW_UP_POLICIES)[number];

export const CRM_OUTREACH_BATCH_STATES = [
  "draft",
  "approved",
  "queued",
  "sending",
  "paused",
  "complete",
  "cancelled",
] as const;
export type CrmOutreachBatchState = (typeof CRM_OUTREACH_BATCH_STATES)[number];

export const CRM_OUTREACH_DELIVERY_STATES = [
  "draft",
  "approved",
  "queued",
  "creating_ticket",
  "notification_requested",
  "replied",
  "closed",
  "suppressed",
  "failed",
  "cancelled",
] as const;
export type CrmOutreachDeliveryState =
  (typeof CRM_OUTREACH_DELIVERY_STATES)[number];

export const CRM_OUTREACH_SUGGESTED_ACTIONS = [
  "await_response",
  "review_and_follow_up",
  "verify_delivery",
  "close_no_response",
] as const;
export type CrmOutreachSuggestedAction =
  (typeof CRM_OUTREACH_SUGGESTED_ACTIONS)[number];

export const CRM_OUTREACH_SUPPRESSION_SCOPES = [
  "email",
  "person",
  "organization",
  "domain",
] as const;
export type CrmOutreachSuppressionScope =
  (typeof CRM_OUTREACH_SUPPRESSION_SCOPES)[number];

export const CRM_OUTREACH_SUPPRESSION_REASONS = [
  "opt_out",
  "hard_bounce",
  "complaint",
  "invalid_address",
  "manual",
  "legal",
  "other",
] as const;
export type CrmOutreachSuppressionReason =
  (typeof CRM_OUTREACH_SUPPRESSION_REASONS)[number];

export const CRM_OUTREACH_SUPPRESSION_SOURCES = [
  "opt_out_link",
  "zendesk",
  "provider",
  "admin_ui",
  "cli",
] as const;
export type CrmOutreachSuppressionSource =
  (typeof CRM_OUTREACH_SUPPRESSION_SOURCES)[number];

export const CRM_OUTREACH_PROVIDER_OPERATION_STATES = [
  "queued",
  "started",
  "succeeded",
  "failed",
  "indeterminate",
  "cancelled",
] as const;
export type CrmOutreachProviderOperationState =
  (typeof CRM_OUTREACH_PROVIDER_OPERATION_STATES)[number];

export interface CrmOutreachTemplate {
  id: string;
  template_key: string;
  revision: number;
  name: string;
  kind: CrmOutreachKind;
  status: CrmOutreachTemplateState;
  subject_template: string;
  body_markdown_template: string;
  required_fields: string[];
  follow_up_policy: CrmOutreachFollowUpPolicy;
  follow_up_after_days?: number | null;
  max_followups?: number | null;
  final_review_after_days?: number | null;
  created_by_account_id: string;
  activated_by_account_id?: string | null;
  retired_by_account_id?: string | null;
  created_at: string;
  activated_at?: string | null;
  retired_at?: string | null;
}

export interface CrmOutreachBatch {
  id: string;
  outreach_number: string;
  name: string;
  purpose: string;
  kind: CrmOutreachKind;
  state: CrmOutreachBatchState;
  template_id?: string | null;
  template_snapshot: Record<string, unknown>;
  owner_account_id: string;
  recipient_count: number;
  approved_recipient_count: number;
  created_by_account_id: string;
  approved_by_account_id?: string | null;
  updated_by_account_id: string;
  queued_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  paused_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmOutreachDelivery {
  id: string;
  batch_id: string;
  organization_id: string;
  person_id: string;
  person_email_id: string;
  opportunity_id?: string | null;
  task_id?: string | null;
  kind: CrmOutreachKind;
  recipient_name: string;
  normalized_email: string;
  recipient_domain: string;
  subject: string;
  body_plain_text: string;
  body_markdown: string;
  rendered_html: string;
  footer: string;
  template_snapshot: Record<string, unknown>;
  state: CrmOutreachDeliveryState;
  provider_external_id: string;
  zendesk_ticket_id?: number | null;
  opening_zendesk_comment_id?: number | null;
  last_zendesk_comment_id?: number | null;
  last_zendesk_status?: string | null;
  zendesk_sync_metadata: Record<string, unknown>;
  first_view_observed_at?: string | null;
  last_view_observed_at?: string | null;
  view_observation_count: number;
  follow_up_policy: CrmOutreachFollowUpPolicy;
  follow_up_after_days: number;
  max_followups: number;
  final_review_after_days: number;
  notification_requested_at?: string | null;
  follow_up_due_at?: string | null;
  last_follow_up_at?: string | null;
  follow_up_attempt_count: number;
  follow_up_suggested_action: CrmOutreachSuggestedAction;
  approved_at?: string | null;
  queued_at?: string | null;
  provider_submitted_at?: string | null;
  replied_at?: string | null;
  closed_at?: string | null;
  cancelled_at?: string | null;
  next_attempt_at: string;
  attempt_count: number;
  last_error?: string | null;
  opt_out_token_digest: string;
  override_reason?: string | null;
  created_by_account_id: string;
  approved_by_account_id?: string | null;
  updated_by_account_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmContactSuppression {
  id: string;
  scope: CrmOutreachSuppressionScope;
  normalized_scope_value: string;
  organization_id?: string | null;
  person_id?: string | null;
  person_email_id?: string | null;
  reason: CrmOutreachSuppressionReason;
  source: CrmOutreachSuppressionSource;
  source_reference?: string | null;
  note?: string | null;
  active: boolean;
  created_by_account_id?: string | null;
  revoked_by_account_id?: string | null;
  created_at: string;
  revoked_at?: string | null;
  revocation_reason?: string | null;
  version: number;
}

export interface CrmOutreachProviderOperation {
  id: string;
  delivery_id: string;
  operation: "create_ticket" | "add_comment" | "reconcile_ticket";
  idempotency_key: string;
  payload_hash: string;
  state: CrmOutreachProviderOperationState;
  attempt_number: number;
  provider_external_id: string;
  zendesk_ticket_id?: number | null;
  rate_limit_snapshot: Record<string, unknown>;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  not_before: string;
  provider_status?: string | null;
  error_category?: string | null;
  error_text?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at: string;
}

export interface CrmOutreachEngagementEvent {
  id: string;
  delivery_id: string;
  kind: "view_observed";
  provider: "my_read_receipts";
  provider_event_id: string;
  zendesk_ticket_id: number;
  zendesk_comment_id: number;
  observed_at: string;
  ingested_at: string;
  provenance: Record<string, unknown>;
}

export interface CrmOutreachLimits {
  enabled: boolean;
  mutations_enabled: boolean;
  delivery_enabled: boolean;
  webhook_enabled: boolean;
  max_recipients_per_batch: number;
  send_per_minute: number;
  send_per_hour: number;
  send_per_day: number;
  send_per_domain_per_day: number;
  contact_cooldown_days: number;
  default_followup_days: number;
  default_max_followups: number;
  default_final_review_days: number;
  worker_concurrency: number;
  worker_batch_size: number;
  retry_max_attempts: number;
  retry_base_seconds: number;
  rolling_usage: {
    minute: number;
    hour: number;
    day: number;
    by_domain: Record<string, number>;
  };
  provider_not_before?: string | null;
  next_eligible_send_at?: string | null;
  hard_bounds: Record<string, { min: number; max: number }>;
}

export interface CrmOutreachBatchDetail {
  batch: CrmOutreachBatch;
  deliveries: CrmOutreachDelivery[];
}

export interface CrmOutreachDiagnostics {
  checked_at: string;
  configured: {
    submitter_id: boolean;
    group_id: boolean;
    form_id: boolean;
    support_address: boolean;
    postal_address: boolean;
    footer: boolean;
    webhook_secret: boolean;
    read_receipts_mode: string;
    read_receipts_identity: boolean;
  };
  limits: CrmOutreachLimits;
  counts: Record<string, number>;
  oldest_queued_at?: string | null;
  worker_heartbeat_at?: string | null;
  provider_backoff_until?: string | null;
  problems: Array<{ code: string; count: number; detail: string }>;
}

export const CRM_OUTREACH_VIEW_CAVEAT =
  "A view observation may be caused by an email proxy, preview, or security scanner; it is not proof that a person read the message.";
