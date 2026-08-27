/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { BuildIdentity } from "./build-identity";

/**
 * Increment when an importer must treat the CRM data/API shape as a new
 * contract rather than replaying a plan prepared against an older shape.
 */
export const CRM_SCHEMA_CONTRACT_VERSION = 1 as const;

export const CRM_FEATURE_FLAGS = {
  visible: "crm_visible",
  mutate: "crm_mutations_enabled",
  pipeline: "crm_pipeline_mutations_enabled",
  zendesk: "crm_zendesk_linking_enabled",
  commercial: "crm_commercial_integration_enabled",
  metrics: "crm_metric_projections_enabled",
  export: "crm_exports_enabled",
  backfill: "crm_backfill_enabled",
  outreach: "crm_outreach_enabled",
  outreachMutate: "crm_outreach_mutations_enabled",
  outreachDelivery: "crm_outreach_delivery_enabled",
  outreachWebhook: "crm_outreach_webhook_enabled",
  outreachReadReceipts: "crm_outreach_read_receipts_enabled",
} as const;

export type CrmCapability = keyof typeof CRM_FEATURE_FLAGS;
export type CrmFeatureFlagName = (typeof CRM_FEATURE_FLAGS)[CrmCapability];
export type CrmFeatureFlagSnapshot = Record<CrmFeatureFlagName, boolean>;

export type CrmServerBuildIdentity = {
  source: "launchpad-environment" | "star-environment" | "package-metadata";
} & {
  [Key in keyof BuildIdentity]-?: NonNullable<BuildIdentity[Key]> | null;
};

export interface CrmRuntimeContract {
  crm_schema_contract_version: typeof CRM_SCHEMA_CONTRACT_VERSION;
  server_build: CrmServerBuildIdentity;
  feature_flags: CrmFeatureFlagSnapshot;
}

export const CRM_ORGANIZATION_TYPES = [
  "university",
  "college",
  "school",
  "research_lab",
  "company",
  "government",
  "nonprofit",
  "individual",
  "other",
] as const;
export type CrmOrganizationType = (typeof CRM_ORGANIZATION_TYPES)[number];

export const CRM_LIFECYCLE_STAGES = [
  "prospect",
  "pilot",
  "customer",
  "renewal",
  "former_customer",
  "inactive",
] as const;
export type CrmLifecycleStage = (typeof CRM_LIFECYCLE_STAGES)[number];

export const CRM_ORGANIZATION_STATUSES = [
  "active",
  "merged",
  "archived",
] as const;
export type CrmOrganizationStatus = (typeof CRM_ORGANIZATION_STATUSES)[number];

export const CRM_DOMAIN_KINDS = [
  "primary",
  "secondary",
  "department",
  "legacy",
] as const;
export type CrmDomainKind = (typeof CRM_DOMAIN_KINDS)[number];

export const CRM_DOMAIN_STATES = [
  "suggested",
  "verified",
  "rejected",
  "retired",
] as const;
export type CrmDomainState = (typeof CRM_DOMAIN_STATES)[number];

export const CRM_PERSON_ROLES = [
  "primary_contact",
  "instructor",
  "decision_maker",
  "billing",
  "procurement",
  "technical",
  "site_license_manager",
  "executive_sponsor",
] as const;
export type CrmPersonRole = (typeof CRM_PERSON_ROLES)[number];

export const CRM_OPPORTUNITY_KINDS = [
  "adoption_pilot",
  "new_site_license",
  "renewal",
  "expansion",
  "private_cloud",
  "training_services",
  "other",
] as const;
export type CrmOpportunityKind = (typeof CRM_OPPORTUNITY_KINDS)[number];

export const CRM_OPPORTUNITY_STAGES = [
  "discovery",
  "qualified",
  "proposal",
  "verbal_commitment",
  "procurement",
  "won",
  "lost",
  "on_hold",
] as const;
export type CrmOpportunityStage = (typeof CRM_OPPORTUNITY_STAGES)[number];

export const CRM_TASK_TYPES = [
  "contact",
  "meeting",
  "discovery",
  "proposal",
  "quote",
  "procurement",
  "invoice",
  "payment_follow_up",
  "provisioning",
  "renewal",
  "technical_follow_up",
  "review",
] as const;
export type CrmTaskType = (typeof CRM_TASK_TYPES)[number];

export const CRM_TASK_STATES = [
  "open",
  "waiting",
  "completed",
  "cancelled",
] as const;
export type CrmTaskState = (typeof CRM_TASK_STATES)[number];

export const CRM_TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CrmTaskPriority = (typeof CRM_TASK_PRIORITIES)[number];

export const CRM_ACTIVITY_KINDS = [
  "note",
  "call",
  "meeting",
  "mutation",
  "opportunity",
  "task",
  "commercial_order",
  "site_license",
  "stripe",
  "zendesk",
  "system",
] as const;
export type CrmActivityKind = (typeof CRM_ACTIVITY_KINDS)[number];

export const CRM_EXTERNAL_PROVIDERS = ["zendesk", "stripe", "cocalc"] as const;
export type CrmExternalProvider = (typeof CRM_EXTERNAL_PROVIDERS)[number];

export const CRM_EXTERNAL_OBJECT_KINDS = [
  "organization",
  "person",
  "requester",
  "ticket",
  "customer",
  "account",
  "commercial_order",
  "site_license",
  "project",
] as const;
export type CrmExternalObjectKind = (typeof CRM_EXTERNAL_OBJECT_KINDS)[number];

export const CRM_EXTERNAL_REFERENCE_VERIFICATION_STATES = [
  "suggested",
  "verified",
  "rejected",
  "retired",
] as const;
export type CrmExternalReferenceVerificationState =
  (typeof CRM_EXTERNAL_REFERENCE_VERIFICATION_STATES)[number];

export interface CrmOrganization {
  id: string;
  customer_number: string;
  display_name: string;
  legal_name?: string | null;
  aliases: string[];
  website?: string | null;
  timezone?: string | null;
  organization_type: CrmOrganizationType;
  lifecycle_stage: CrmLifecycleStage;
  relationship_owner_account_id?: string | null;
  parent_organization_id?: string | null;
  status: CrmOrganizationStatus;
  merged_into_organization_id?: string | null;
  created_by_account_id: string;
  updated_by_account_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmOrganizationDomain {
  id: string;
  organization_id: string;
  normalized_domain: string;
  display_domain: string;
  kind: CrmDomainKind;
  state: CrmDomainState;
  verification_method?: string | null;
  evidence_reference?: string | null;
  generic_domain: boolean;
  created_by_account_id: string;
  updated_by_account_id: string;
  created_at: string;
  updated_at: string;
  verified_at?: string | null;
  retired_at?: string | null;
  version: number;
}

export interface CrmPersonEmail {
  id: string;
  person_id: string;
  email_address: string;
  normalized_email: string;
  kind: "work" | "billing" | "personal" | "other";
  is_primary: boolean;
  verified: boolean;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmPersonAccount {
  id: string;
  person_id: string;
  account_id: string;
  state: "suggested" | "verified" | "rejected" | "retired";
  evidence_reference?: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmOrganizationPerson {
  id: string;
  organization_id: string;
  person_id: string;
  roles: CrmPersonRole[];
  title?: string | null;
  department?: string | null;
  state: "active" | "former" | "retired";
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmPerson {
  id: string;
  display_name: string;
  website?: string | null;
  linkedin_url?: string | null;
  facebook_url?: string | null;
  x_url?: string | null;
  note?: string | null;
  timezone?: string | null;
  status: "active" | "merged" | "archived";
  merged_into_person_id?: string | null;
  created_by_account_id: string;
  updated_by_account_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  emails: CrmPersonEmail[];
  accounts: CrmPersonAccount[];
  organizations: CrmOrganizationPerson[];
}

export interface CrmExternalReference {
  id: string;
  organization_id: string;
  person_id?: string | null;
  opportunity_id?: string | null;
  provider: CrmExternalProvider;
  object_kind: CrmExternalObjectKind;
  external_id: string;
  label?: string | null;
  metadata: Record<string, unknown>;
  verification_state: CrmExternalReferenceVerificationState;
  created_by_account_id: string;
  updated_by_account_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmExternalReferenceListItem {
  reference: CrmExternalReference;
  organization: {
    id: string;
    customer_number: string;
    display_name: string;
  };
}

export interface CrmOpportunity {
  id: string;
  organization_id: string;
  name: string;
  kind: CrmOpportunityKind;
  stage: CrmOpportunityStage;
  owner_account_id: string;
  expected_value: string;
  currency: string;
  expected_close_date: string;
  service_starts_at?: string | null;
  service_ends_at?: string | null;
  loss_reason?: string | null;
  commercial_order_id?: string | null;
  source_zendesk_ticket_ids: number[];
  description?: string | null;
  created_by_account_id: string;
  updated_by_account_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface CrmTask {
  id: string;
  organization_id: string;
  person_id?: string | null;
  opportunity_id?: string | null;
  commercial_order_id?: string | null;
  zendesk_ticket_id?: number | null;
  type: CrmTaskType;
  state: CrmTaskState;
  assignee_account_id: string;
  due_at: string;
  priority: CrmTaskPriority;
  subject: string;
  details?: string | null;
  created_by_account_id: string;
  updated_by_account_id: string;
  completed_by_account_id?: string | null;
  cancelled_by_account_id?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  cancelled_at?: string | null;
  version: number;
}

export interface CrmActivity {
  id: string;
  organization_id: string;
  person_id?: string | null;
  opportunity_id?: string | null;
  task_id?: string | null;
  commercial_order_id?: string | null;
  site_license_id?: string | null;
  zendesk_ticket_id?: number | null;
  kind: CrmActivityKind;
  source: string;
  source_id: string;
  summary: string;
  details?: string | null;
  actor_account_id?: string | null;
  occurred_at: string;
  supersedes_activity_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CrmCustomerMetrics {
  organization_id: string;
  generated_at: string;
  scope: string;
  commercial_spend_by_year: Record<string, string>;
  outstanding_receivables: string;
  commercial_order_count: number;
  active_site_license_count: number;
  historical_site_license_count: number;
  licensed_seats: number;
  linked_account_count: number;
  estimated_domain_account_count: number;
  recent_zendesk_interaction_at?: string | null;
  provenance: Record<string, string>;
}

export interface CrmOrganizationSummary extends CrmOrganization {
  verified_domains: string[];
  primary_contacts: Array<{ id: string; display_name: string }>;
  open_opportunity_count: number;
  next_task?: CrmTask | null;
  latest_activity_at?: string | null;
  outstanding_receivables: string;
}

export interface CrmSupportCustomerEvidence {
  kind:
    | "zendesk_ticket"
    | "cocalc_account"
    | "verified_email"
    | "verified_domain";
  reference: string;
  detail: string;
}

export interface CrmSupportCustomerCandidate {
  organization: CrmOrganizationSummary;
  evidence: CrmSupportCustomerEvidence[];
  linked: boolean;
}

export interface CrmSupportCustomerContext {
  ticket_id: number;
  generated_at: string;
  candidates: CrmSupportCustomerCandidate[];
  truncated: boolean;
  inference_note: string;
}

export interface CrmCustomer360 {
  organization: CrmOrganization;
  parent_organization?: Pick<
    CrmOrganization,
    "id" | "customer_number" | "display_name"
  > | null;
  domains: CrmOrganizationDomain[];
  people: CrmPerson[];
  relationships: CrmOrganizationPerson[];
  opportunities: CrmOpportunity[];
  tasks: CrmTask[];
  external_references: CrmExternalReference[];
  activities: CrmActivity[];
  commercial_orders: Array<Record<string, unknown>>;
  site_licenses: Array<Record<string, unknown>>;
  metrics: CrmCustomerMetrics;
}

export interface CrmDiagnostics {
  checked_at: string;
  runtime_contract: CrmRuntimeContract;
  duplicate_verified_domains: Array<Record<string, unknown>>;
  conflicting_external_references: Array<Record<string, unknown>>;
  active_organizations_without_owner: CrmOrganizationSummary[];
  open_opportunities_without_task: CrmOpportunity[];
  overdue_tasks: CrmTask[];
  won_opportunities_without_order: CrmOpportunity[];
  commercial_orders_without_organization: Array<Record<string, unknown>>;
  site_licenses_without_organization: Array<Record<string, unknown>>;
  merged_records_still_referenced: Array<Record<string, unknown>>;
  conflicting_person_relationships: Array<Record<string, unknown>>;
  timeline_source_gaps: Array<Record<string, unknown>>;
  duplicate_timeline_sources: Array<Record<string, unknown>>;
  failed_external_reference_sync: Array<Record<string, unknown>>;
  stale_metric_projections: string[];
}

export interface CrmDailyDigestTask {
  task: CrmTask;
  organization: Pick<
    CrmOrganization,
    "id" | "customer_number" | "display_name"
  >;
}

export interface CrmDailyDigestOpportunity {
  opportunity: CrmOpportunity;
  organization: Pick<
    CrmOrganization,
    "id" | "customer_number" | "display_name"
  >;
}

export interface CrmDailyDigest {
  generated_at: string;
  as_of: string;
  due_before: string;
  renewal_before: string;
  overdue_tasks: CrmDailyDigestTask[];
  due_soon_tasks: CrmDailyDigestTask[];
  overdue_commercial_actions: Array<Record<string, unknown>>;
  due_soon_commercial_actions: Array<Record<string, unknown>>;
  renewal_opportunities: CrmDailyDigestOpportunity[];
  expansion_opportunities: CrmDailyDigestOpportunity[];
  unassigned_organizations: CrmOrganizationSummary[];
  counts: {
    overdue_tasks: number;
    due_soon_tasks: number;
    overdue_commercial_actions: number;
    due_soon_commercial_actions: number;
    renewal_opportunities: number;
    expansion_opportunities: number;
    unassigned_organizations: number;
  };
  truncated: boolean;
  provenance: Record<string, string>;
}

export interface CrmMutationPreview<T = Record<string, unknown>> {
  preview: true;
  action: string;
  selector?: string;
  expected_version: number;
  proposed: T;
  warnings: string[];
  idempotency_key: string;
}

export interface CrmMutationCommitted<T> {
  preview: false;
  action: string;
  replayed: boolean;
  result: T;
}

export type CrmMutationResult<T> =
  | CrmMutationPreview<Partial<T> | Record<string, unknown>>
  | CrmMutationCommitted<T>;

export interface CrmBackfillCandidate {
  candidate_key: string;
  display_name: string;
  organization_type: CrmOrganizationType;
  lifecycle_stage: CrmLifecycleStage;
  domains: string[];
  account_ids: string[];
  zendesk_ticket_ids: number[];
  commercial_order_ids: string[];
  site_license_ids: string[];
  stripe_customer_ids: string[];
  evidence: Array<{ source: string; reference: string; detail: string }>;
  confidence: "high" | "medium" | "low";
  existing_organization_id?: string | null;
}
