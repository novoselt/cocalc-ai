/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { type FieldSpec, Table } from "./types";

function required(field: FieldSpec): FieldSpec {
  return { ...field, not_null: true };
}

function requiredWithDefault(field: FieldSpec, pgDefault: string): FieldSpec {
  return {
    ...field,
    not_null: true,
    pg_default: pgDefault,
    pg_null_backfill: pgDefault,
  };
}

function requiredTimestamp(desc: string): FieldSpec {
  return requiredWithDefault(
    { type: "timestamp", pg_type: "TIMESTAMPTZ", desc },
    "now()",
  );
}

function nullableTimestamp(desc: string): FieldSpec {
  return { type: "timestamp", pg_type: "TIMESTAMPTZ", desc };
}

function versionField(): FieldSpec {
  return requiredWithDefault(
    { type: "integer", desc: "Optimistic concurrency version." },
    "1",
  );
}

// These generic field specifications predate the abandoned CRM editor and are
// still imported by unrelated operational schemas.
export const NOTES: FieldSpec = {
  type: "string",
  desc: "Open ended text in markdown about this item.",
  render: { type: "markdown", editable: true },
};

export const ID: FieldSpec = {
  type: "integer",
  desc: "Automatically generated sequential id that uniquely determines this row.",
  pg_type: "SERIAL UNIQUE",
  noCoerce: true,
};

export const CREATED_BY: FieldSpec = {
  type: "uuid",
  desc: "Account that created this record.",
  render: { type: "account" },
};

// CRM records intentionally have no direct user_query surface. The audited,
// seed-routed adminCrm service is the only supported read and mutation path.

Table({
  name: "crm_organizations",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "customer_number",
      "display_name",
      "legal_name",
      "organization_type",
      "lifecycle_stage",
      "relationship_owner_account_id",
      "parent_organization_id",
      "status",
      "merged_into_organization_id",
      "updated_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Canonical CRM organization id." },
    customer_number: required({
      type: "string",
      desc: "Stable customer display key.",
      unique: true,
    }),
    display_name: required({
      type: "string",
      desc: "Customer display name.",
    }),
    legal_name: { type: "string", desc: "Optional legal entity name." },
    aliases: requiredWithDefault(
      { type: "array", pg_type: "TEXT[]", desc: "Reviewed aliases." },
      "'{}'::text[]",
    ),
    website: { type: "string", desc: "Organization website." },
    timezone: { type: "string", desc: "IANA timezone." },
    organization_type: required({
      type: "string",
      desc: "Constrained organization type.",
    }),
    lifecycle_stage: required({
      type: "string",
      desc: "Current customer lifecycle stage.",
    }),
    relationship_owner_account_id: {
      type: "uuid",
      desc: "CoCalc admin responsible for this customer.",
      render: { type: "account" },
    },
    parent_organization_id: {
      type: "uuid",
      desc: "Optional parent CRM organization.",
    },
    status: requiredWithDefault(
      { type: "string", desc: "Active, merged, or archived." },
      "'active'::text",
    ),
    merged_into_organization_id: {
      type: "uuid",
      desc: "Canonical merge destination.",
    },
    created_by_account_id: required({
      type: "uuid",
      desc: "Creating admin.",
      render: { type: "account" },
    }),
    updated_by_account_id: required({
      type: "uuid",
      desc: "Last updating admin.",
      render: { type: "account" },
    }),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_organization_domains",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "organization_id",
      "normalized_domain",
      "kind",
      "state",
      "updated_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Domain relation id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    normalized_domain: required({
      type: "string",
      desc: "Normalized lower-case ASCII domain.",
    }),
    display_domain: required({
      type: "string",
      desc: "Reviewed display form.",
    }),
    kind: required({
      type: "string",
      desc: "Primary, secondary, department, or legacy.",
    }),
    state: required({
      type: "string",
      desc: "Suggested, verified, rejected, or retired.",
    }),
    verification_method: {
      type: "string",
      desc: "How ownership was reviewed.",
    },
    evidence_reference: { type: "string", desc: "Bounded evidence reference." },
    generic_domain: requiredWithDefault(
      {
        type: "boolean",
        desc: "Whether this is a disposable or generic domain.",
      },
      "false",
    ),
    created_by_account_id: required({
      type: "uuid",
      desc: "Creating admin.",
      render: { type: "account" },
    }),
    updated_by_account_id: required({
      type: "uuid",
      desc: "Last updating admin.",
      render: { type: "account" },
    }),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    verified_at: nullableTimestamp("Verification time."),
    retired_at: nullableTimestamp("Retirement time."),
    version: versionField(),
  },
});

Table({
  name: "crm_people",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "display_name",
      "status",
      "merged_into_person_id",
      "updated_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Canonical CRM person id." },
    display_name: required({
      type: "string",
      desc: "Person display name.",
    }),
    timezone: { type: "string", desc: "IANA timezone." },
    status: requiredWithDefault(
      { type: "string", desc: "Active, merged, or archived." },
      "'active'::text",
    ),
    merged_into_person_id: {
      type: "uuid",
      desc: "Canonical merge destination.",
    },
    created_by_account_id: required({
      type: "uuid",
      desc: "Creating admin.",
      render: { type: "account" },
    }),
    updated_by_account_id: required({
      type: "uuid",
      desc: "Last updating admin.",
      render: { type: "account" },
    }),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_person_emails",
  rules: {
    primary_key: "id",
    pg_indexes: ["person_id", "normalized_email", "is_primary"],
  },
  fields: {
    id: { type: "uuid", desc: "Person email relation id." },
    person_id: required({ type: "uuid", desc: "CRM person." }),
    email_address: required({
      type: "string",
      desc: "Reviewed display email.",
    }),
    normalized_email: required({
      type: "string",
      desc: "Normalized email identity.",
    }),
    kind: requiredWithDefault(
      { type: "string", desc: "Work, billing, personal, or other." },
      "'work'::text",
    ),
    is_primary: requiredWithDefault(
      { type: "boolean", desc: "Primary email for this person." },
      "false",
    ),
    verified: requiredWithDefault(
      { type: "boolean", desc: "Whether the relation was verified." },
      "false",
    ),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_person_accounts",
  rules: {
    primary_key: "id",
    pg_indexes: ["person_id", "account_id", "state"],
  },
  fields: {
    id: { type: "uuid", desc: "Person/account relation id." },
    person_id: required({ type: "uuid", desc: "CRM person." }),
    account_id: required({
      type: "uuid",
      desc: "CoCalc account.",
      render: { type: "account" },
    }),
    state: requiredWithDefault(
      {
        type: "string",
        desc: "Suggested, verified, rejected, or retired.",
      },
      "'suggested'::text",
    ),
    evidence_reference: { type: "string", desc: "Bounded evidence reference." },
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_organization_people",
  rules: {
    primary_key: "id",
    pg_indexes: ["organization_id", "person_id", "state"],
  },
  fields: {
    id: { type: "uuid", desc: "Organization/person relation id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    person_id: required({ type: "uuid", desc: "CRM person." }),
    roles: requiredWithDefault(
      {
        type: "array",
        pg_type: "TEXT[]",
        desc: "Constrained relationship roles.",
      },
      "'{}'::text[]",
    ),
    title: { type: "string", desc: "Contact title." },
    department: { type: "string", desc: "Contact department." },
    state: requiredWithDefault(
      { type: "string", desc: "Active, former, or retired." },
      "'active'::text",
    ),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_external_references",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "organization_id",
      "person_id",
      "opportunity_id",
      "provider",
      "object_kind",
      "external_id",
      "verification_state",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "External reference id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    person_id: { type: "uuid", desc: "Optional CRM person." },
    opportunity_id: { type: "uuid", desc: "Optional CRM opportunity." },
    provider: required({
      type: "string",
      desc: "Reviewed external provider.",
    }),
    object_kind: required({
      type: "string",
      desc: "Constrained external object kind.",
    }),
    external_id: required({
      type: "string",
      desc: "Stable provider identifier.",
    }),
    label: { type: "string", desc: "Redacted display label." },
    metadata: requiredWithDefault(
      { type: "map", desc: "Bounded reviewed metadata." },
      "'{}'::jsonb",
    ),
    verification_state: requiredWithDefault(
      {
        type: "string",
        desc: "Suggested, verified, rejected, or retired.",
      },
      "'suggested'::text",
    ),
    created_by_account_id: required({
      type: "uuid",
      desc: "Creating admin.",
      render: { type: "account" },
    }),
    updated_by_account_id: required({
      type: "uuid",
      desc: "Last updating admin.",
      render: { type: "account" },
    }),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_opportunities",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "organization_id",
      "kind",
      "stage",
      "owner_account_id",
      "expected_close_date",
      "commercial_order_id",
      "updated_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Opportunity id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    name: required({ type: "string", desc: "Short opportunity name." }),
    kind: required({
      type: "string",
      desc: "Constrained opportunity kind.",
    }),
    stage: requiredWithDefault(
      { type: "string", desc: "Validated opportunity stage." },
      "'discovery'::text",
    ),
    owner_account_id: required({
      type: "uuid",
      desc: "Responsible admin.",
      render: { type: "account" },
    }),
    expected_value: requiredWithDefault(
      {
        type: "number",
        pg_type: "NUMERIC(20,10)",
        desc: "Expected commercial value.",
      },
      "0",
    ),
    currency: requiredWithDefault(
      { type: "string", desc: "ISO currency." },
      "'usd'::text",
    ),
    expected_close_date: required({
      type: "timestamp",
      pg_type: "DATE",
      desc: "Expected close date.",
    }),
    service_starts_at: nullableTimestamp("Expected service start."),
    service_ends_at: nullableTimestamp("Expected service end."),
    loss_reason: { type: "string", desc: "Required reason when lost." },
    commercial_order_id: { type: "uuid", desc: "Won commercial order." },
    source_zendesk_ticket_ids: requiredWithDefault(
      {
        type: "array",
        pg_type: "INTEGER[]",
        desc: "Source Zendesk tickets.",
      },
      "'{}'::integer[]",
    ),
    description: { type: "string", desc: "Bounded internal description." },
    created_by_account_id: required({
      type: "uuid",
      desc: "Creating admin.",
      render: { type: "account" },
    }),
    updated_by_account_id: required({
      type: "uuid",
      desc: "Last updating admin.",
      render: { type: "account" },
    }),
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    version: versionField(),
  },
});

Table({
  name: "crm_tasks",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "organization_id",
      "person_id",
      "opportunity_id",
      "commercial_order_id",
      "zendesk_ticket_id",
      "type",
      "state",
      "assignee_account_id",
      "due_at",
      "priority",
      "updated_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Internal CRM task id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    person_id: { type: "uuid", desc: "Optional CRM person." },
    opportunity_id: { type: "uuid", desc: "Optional CRM opportunity." },
    commercial_order_id: { type: "uuid", desc: "Optional commercial order." },
    zendesk_ticket_id: { type: "integer", desc: "Optional Zendesk ticket." },
    type: required({ type: "string", desc: "Constrained task type." }),
    state: requiredWithDefault(
      { type: "string", desc: "Open, waiting, completed, or cancelled." },
      "'open'::text",
    ),
    assignee_account_id: required({
      type: "uuid",
      desc: "Responsible admin.",
      render: { type: "account" },
    }),
    due_at: required({
      type: "timestamp",
      pg_type: "TIMESTAMPTZ",
      desc: "Required follow-up deadline.",
    }),
    priority: requiredWithDefault(
      { type: "string", desc: "Low, normal, high, or urgent." },
      "'normal'::text",
    ),
    subject: required({
      type: "string",
      desc: "Short action-oriented subject.",
    }),
    details: { type: "string", desc: "Bounded internal details." },
    created_by_account_id: required({
      type: "uuid",
      desc: "Creating admin.",
      render: { type: "account" },
    }),
    updated_by_account_id: required({
      type: "uuid",
      desc: "Last updating admin.",
      render: { type: "account" },
    }),
    completed_by_account_id: {
      type: "uuid",
      desc: "Completing admin.",
      render: { type: "account" },
    },
    cancelled_by_account_id: {
      type: "uuid",
      desc: "Cancelling admin.",
      render: { type: "account" },
    },
    created_at: requiredTimestamp("Creation time."),
    updated_at: requiredTimestamp("Last update time."),
    completed_at: nullableTimestamp("Completion time."),
    cancelled_at: nullableTimestamp("Cancellation time."),
    version: versionField(),
  },
});

Table({
  name: "crm_activities",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "organization_id",
      "person_id",
      "opportunity_id",
      "task_id",
      "commercial_order_id",
      "site_license_id",
      "zendesk_ticket_id",
      "kind",
      "source",
      "source_id",
      "occurred_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Append-only activity id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    person_id: { type: "uuid", desc: "Optional CRM person." },
    opportunity_id: { type: "uuid", desc: "Optional CRM opportunity." },
    task_id: { type: "uuid", desc: "Optional CRM task." },
    commercial_order_id: { type: "uuid", desc: "Optional commercial order." },
    site_license_id: { type: "uuid", desc: "Optional site license." },
    zendesk_ticket_id: { type: "integer", desc: "Optional Zendesk ticket." },
    kind: required({
      type: "string",
      desc: "Constrained activity kind.",
    }),
    source: required({ type: "string", desc: "Stable activity source." }),
    source_id: required({
      type: "string",
      desc: "Idempotent source identifier.",
    }),
    summary: required({
      type: "string",
      desc: "Concise internal summary.",
    }),
    details: { type: "string", desc: "Bounded details." },
    actor_account_id: {
      type: "uuid",
      desc: "Acting admin.",
      render: { type: "account" },
    },
    occurred_at: required({
      type: "timestamp",
      pg_type: "TIMESTAMPTZ",
      desc: "When the activity occurred.",
    }),
    supersedes_activity_id: {
      type: "uuid",
      desc: "Append-only correction target.",
    },
    metadata: requiredWithDefault(
      { type: "map", desc: "Bounded activity metadata." },
      "'{}'::jsonb",
    ),
    created_at: requiredTimestamp("Ingestion time."),
  },
});

Table({
  name: "crm_metric_snapshots",
  rules: {
    primary_key: "id",
    pg_indexes: ["organization_id", "generated_at", "scope"],
  },
  fields: {
    id: { type: "uuid", desc: "Metric snapshot id." },
    organization_id: required({
      type: "uuid",
      desc: "CRM organization.",
    }),
    generated_at: required({
      type: "timestamp",
      pg_type: "TIMESTAMPTZ",
      desc: "Projection generation time.",
    }),
    scope: required({
      type: "string",
      desc: "Projection scope description.",
    }),
    metrics: required({
      type: "map",
      desc: "Bounded explainable metrics.",
    }),
    provenance: requiredWithDefault(
      { type: "map", desc: "Metric provenance." },
      "'{}'::jsonb",
    ),
    created_at: requiredTimestamp("Creation time."),
  },
});

Table({
  name: "crm_mutation_events",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "organization_id",
      "action",
      "actor_account_id",
      "idempotency_key",
      "created_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Immutable mutation audit id." },
    organization_id: { type: "uuid", desc: "Optional CRM organization." },
    action: required({ type: "string", desc: "Mutation action." }),
    actor_account_id: required({
      type: "uuid",
      desc: "Acting admin.",
      render: { type: "account" },
    }),
    reason: required({
      type: "string",
      desc: "Human-readable audit reason.",
    }),
    idempotency_key: required({
      type: "string",
      desc: "Stable logical mutation key.",
    }),
    payload_hash: required({
      type: "string",
      desc: "Canonical mutation payload hash.",
    }),
    result_type: required({
      type: "string",
      desc: "Returned entity type.",
    }),
    result_id: { type: "uuid", desc: "Returned entity id." },
    metadata: requiredWithDefault(
      { type: "map", desc: "Bounded mutation metadata." },
      "'{}'::jsonb",
    ),
    created_at: requiredTimestamp("Creation time."),
  },
});
