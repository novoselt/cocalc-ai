/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { type FieldSpec, type PgTableConstraint, Table } from "./types";

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

function foreignKey(
  name: string,
  column: string,
  table: string,
  referencedColumn = "id",
): PgTableConstraint {
  return {
    name,
    type: "foreign-key",
    columns: [column],
    references: { table, columns: [referencedColumn] },
  };
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
    pg_sequences: ["crm_customer_number_seq"],
    pg_constraints: [
      {
        name: "crm_organizations_customer_number_key",
        type: "unique",
        columns: ["customer_number"],
      },
      foreignKey(
        "crm_organizations_parent_organization_id_crm_fk",
        "parent_organization_id",
        "crm_organizations",
      ),
      foreignKey(
        "crm_organizations_merged_into_organization_id_crm_fk",
        "merged_into_organization_id",
        "crm_organizations",
      ),
      {
        name: "crm_organizations_status_crm_check",
        type: "check",
        expression: "status IN ('active','merged','archived')",
      },
      {
        name: "crm_organizations_version_crm_check",
        type: "check",
        expression: "version > 0",
      },
      {
        name: "crm_organizations_parent_crm_check",
        type: "check",
        expression: "id IS DISTINCT FROM parent_organization_id",
      },
      {
        name: "crm_organizations_merge_crm_check",
        type: "check",
        expression: "id IS DISTINCT FROM merged_into_organization_id",
      },
    ],
    pg_custom_indexes: [
      { name: "crm_org_name_idx", query: "lower(display_name)" },
      {
        name: "crm_org_owner_idx",
        query: "relationship_owner_account_id",
      },
      { name: "crm_org_updated_idx", query: "(updated_at DESC,id)" },
    ],
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
    pg_constraints: [
      {
        name: "crm_organization_domains_organization_domain_key",
        type: "unique",
        columns: ["organization_id", "normalized_domain"],
      },
      foreignKey(
        "crm_organization_domains_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
      {
        name: "crm_organization_domains_kind_crm_check",
        type: "check",
        expression: "kind IN ('primary','secondary','department','legacy')",
      },
      {
        name: "crm_organization_domains_state_crm_check",
        type: "check",
        expression: "state IN ('suggested','verified','rejected','retired')",
      },
    ],
    pg_custom_indexes: [
      {
        name: "crm_one_verified_domain",
        query: "(normalized_domain) WHERE state='verified'",
        unique: true,
      },
      { name: "crm_domain_org_idx", query: "organization_id" },
    ],
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
    pg_constraints: [
      foreignKey(
        "crm_people_merged_into_person_id_crm_fk",
        "merged_into_person_id",
        "crm_people",
      ),
      {
        name: "crm_people_status_crm_check",
        type: "check",
        expression: "status IN ('active','merged','archived')",
      },
      {
        name: "crm_people_merge_crm_check",
        type: "check",
        expression: "id IS DISTINCT FROM merged_into_person_id",
      },
    ],
    pg_custom_indexes: [
      { name: "crm_people_name_idx", query: "lower(display_name)" },
      { name: "crm_people_updated_idx", query: "(updated_at DESC,id)" },
    ],
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
    pg_constraints: [
      {
        name: "crm_person_emails_person_email_key",
        type: "unique",
        columns: ["person_id", "normalized_email"],
      },
      foreignKey(
        "crm_person_emails_person_id_crm_fk",
        "person_id",
        "crm_people",
      ),
      {
        name: "crm_person_emails_kind_crm_check",
        type: "check",
        expression: "kind IN ('work','billing','personal','other')",
      },
    ],
    pg_custom_indexes: [
      {
        name: "crm_one_primary_email",
        query: "(person_id) WHERE is_primary",
        unique: true,
      },
      { name: "crm_email_normalized_idx", query: "normalized_email" },
    ],
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
    pg_constraints: [
      {
        name: "crm_person_accounts_person_account_key",
        type: "unique",
        columns: ["person_id", "account_id"],
      },
      foreignKey(
        "crm_person_accounts_person_id_crm_fk",
        "person_id",
        "crm_people",
      ),
      {
        name: "crm_person_accounts_state_crm_check",
        type: "check",
        expression: "state IN ('suggested','verified','rejected','retired')",
      },
    ],
    pg_custom_indexes: [
      {
        name: "crm_one_verified_person_per_account",
        query: "(account_id) WHERE state='verified'",
        unique: true,
      },
    ],
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
    pg_constraints: [
      {
        name: "crm_organization_people_organization_person_key",
        type: "unique",
        columns: ["organization_id", "person_id"],
      },
      foreignKey(
        "crm_organization_people_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
      foreignKey(
        "crm_organization_people_person_id_crm_fk",
        "person_id",
        "crm_people",
      ),
      {
        name: "crm_organization_people_state_crm_check",
        type: "check",
        expression: "state IN ('active','former','retired')",
      },
    ],
    pg_custom_indexes: [
      { name: "crm_org_people_org_idx", query: "organization_id" },
    ],
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
    pg_constraints: [
      {
        name: "crm_external_references_provider_object_key",
        type: "unique",
        columns: ["provider", "object_kind", "external_id"],
      },
      foreignKey(
        "crm_external_references_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
      foreignKey(
        "crm_external_references_person_id_crm_fk",
        "person_id",
        "crm_people",
      ),
      foreignKey(
        "crm_external_references_opportunity_id_crm_fk",
        "opportunity_id",
        "crm_opportunities",
      ),
      {
        name: "crm_external_references_state_crm_check",
        type: "check",
        expression:
          "verification_state IN ('suggested','verified','rejected','retired')",
      },
    ],
    pg_custom_indexes: [
      { name: "crm_external_org_idx", query: "organization_id" },
    ],
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
    pg_constraints: [
      foreignKey(
        "crm_opportunities_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
      {
        name: "crm_opportunities_value_crm_check",
        type: "check",
        expression: "expected_value >= 0",
      },
    ],
    pg_custom_indexes: [
      {
        name: "crm_opportunity_org_idx",
        query: "(organization_id,stage)",
      },
    ],
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
    pg_constraints: [
      foreignKey(
        "crm_tasks_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
      foreignKey("crm_tasks_person_id_crm_fk", "person_id", "crm_people"),
      foreignKey(
        "crm_tasks_opportunity_id_crm_fk",
        "opportunity_id",
        "crm_opportunities",
      ),
      {
        name: "crm_tasks_state_crm_check",
        type: "check",
        expression: "state IN ('open','waiting','completed','cancelled')",
      },
      {
        name: "crm_tasks_priority_crm_check",
        type: "check",
        expression: "priority IN ('low','normal','high','urgent')",
      },
    ],
    pg_custom_indexes: [
      {
        name: "crm_task_queue_idx",
        query: "(state,due_at,assignee_account_id)",
      },
    ],
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
    pg_constraints: [
      {
        name: "crm_activities_source_key",
        type: "unique",
        columns: ["organization_id", "source", "source_id"],
      },
      foreignKey(
        "crm_activities_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
      foreignKey("crm_activities_person_id_crm_fk", "person_id", "crm_people"),
      foreignKey(
        "crm_activities_opportunity_id_crm_fk",
        "opportunity_id",
        "crm_opportunities",
      ),
      foreignKey("crm_activities_task_id_crm_fk", "task_id", "crm_tasks"),
      foreignKey(
        "crm_activities_supersedes_activity_id_crm_fk",
        "supersedes_activity_id",
        "crm_activities",
      ),
    ],
    pg_custom_indexes: [
      {
        name: "crm_activity_timeline_idx",
        query: "(organization_id,occurred_at DESC,id)",
      },
    ],
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
    pg_constraints: [
      foreignKey(
        "crm_metric_snapshots_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
    ],
    pg_custom_indexes: [
      {
        name: "crm_metric_org_idx",
        query: "(organization_id,generated_at DESC)",
      },
    ],
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
    pg_constraints: [
      {
        name: "crm_mutation_events_idempotency_key",
        type: "unique",
        columns: ["actor_account_id", "action", "idempotency_key"],
      },
      foreignKey(
        "crm_mutation_events_organization_id_crm_fk",
        "organization_id",
        "crm_organizations",
      ),
    ],
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
