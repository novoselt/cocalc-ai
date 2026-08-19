/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "growth_account_profiles",
  rules: {
    primary_key: "account_id",
    pg_indexes: ["home_bay_id", "cohort_date", "cohort_week"],
    pg_custom_indexes: [
      {
        name: "growth_account_profiles_cohort_date_account_idx",
        query: "(cohort_date, account_id)",
      },
      {
        name: "growth_account_profiles_cohort_week_account_idx",
        query: "(cohort_week, account_id)",
      },
      {
        name: "growth_account_profiles_home_bay_cohort_date_idx",
        query: "(home_bay_id, cohort_date)",
      },
      {
        name: "growth_account_profiles_banned_exclusion_idx",
        query: "(home_bay_id, account_id) WHERE exclusion_reason = 'banned'",
      },
    ],
  },
  fields: {
    account_id: { type: "uuid", desc: "Account-home analytics identity." },
    home_bay_id: { type: "string", pg_type: "VARCHAR(64)" },
    account_created_at: { type: "timestamp" },
    cohort_date: { type: "timestamp", pg_type: "date" },
    cohort_week: { type: "timestamp", pg_type: "date" },
    verified_at: { type: "timestamp" },
    auth_method: { type: "string", pg_type: "VARCHAR(48)" },
    acquisition_channel: { type: "string", pg_type: "VARCHAR(48)" },
    landing_group: { type: "string", pg_type: "VARCHAR(48)" },
    campaign: { type: "string", pg_type: "VARCHAR(96)" },
    legacy_status: { type: "string", pg_type: "VARCHAR(32)" },
    institution_class: { type: "string", pg_type: "VARCHAR(32)" },
    actor_class: { type: "string", pg_type: "VARCHAR(32)" },
    onboarding_eligibility: { type: "string", pg_type: "VARCHAR(32)" },
    codex_entitlement_at_creation: {
      type: "string",
      pg_type: "VARCHAR(48)",
    },
    excluded_from_growth: { type: "boolean" },
    exclusion_reason: { type: "string", pg_type: "VARCHAR(48)" },
    definition_version: { type: "string", pg_type: "VARCHAR(32)" },
    source_confidence: { type: "string", pg_type: "VARCHAR(32)" },
    updated_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_account_milestones",
  rules: {
    primary_key: ["account_id", "milestone", "definition_version"],
    pg_indexes: ["occurred_at", "milestone", "home_bay_id"],
    pg_custom_indexes: [
      {
        name: "growth_account_milestones_occurred_idx",
        query: "(milestone, occurred_at, account_id)",
      },
    ],
  },
  fields: {
    account_id: { type: "uuid" },
    milestone: { type: "string", pg_type: "VARCHAR(64)" },
    definition_version: { type: "string", pg_type: "VARCHAR(32)" },
    occurred_at: { type: "timestamp" },
    source_event_id: { type: "uuid" },
    home_bay_id: { type: "string", pg_type: "VARCHAR(64)" },
    metadata_class: { type: "string", pg_type: "VARCHAR(48)" },
    updated_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_account_activity_daily",
  rules: {
    primary_key: ["account_id", "activity_date", "metric_contract_version"],
    pg_indexes: ["activity_date", "account_id", "home_bay_id"],
    pg_custom_indexes: [
      {
        name: "growth_activity_date_account_idx",
        query: "(activity_date, account_id)",
      },
      {
        name: "growth_activity_account_date_idx",
        query: "(account_id, activity_date DESC)",
      },
    ],
  },
  fields: {
    account_id: { type: "uuid" },
    activity_date: { type: "timestamp", pg_type: "date" },
    metric_contract_version: { type: "string", pg_type: "VARCHAR(32)" },
    home_bay_id: { type: "string", pg_type: "VARCHAR(64)" },
    app_foreground: { type: "boolean" },
    project_engaged: { type: "boolean" },
    project_work: { type: "boolean" },
    self_directed_work: { type: "boolean" },
    compute_consumed: { type: "boolean" },
    ai_engaged: { type: "boolean" },
    first_activity_at: { type: "timestamp" },
    last_activity_at: { type: "timestamp" },
    membership_class: { type: "string", pg_type: "VARCHAR(48)" },
    source_confidence: { type: "string", pg_type: "VARCHAR(32)" },
    updated_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_event_log",
  rules: {
    primary_key: "event_id",
    pg_indexes: [
      "received_at",
      "occurred_at",
      "account_id",
      "event_name",
      "home_bay_id",
    ],
    pg_custom_indexes: [
      {
        name: "growth_event_log_watermark_idx",
        query: "(received_at, event_id)",
      },
      {
        name: "growth_event_log_home_watermark_idx",
        query: "(home_bay_id, received_at, event_id)",
      },
      {
        name: "growth_event_log_account_idx",
        query: "(account_id, received_at DESC)",
      },
      {
        name: "growth_event_log_name_idx",
        query: "(event_name, occurred_at DESC)",
      },
    ],
  },
  fields: {
    event_id: { type: "uuid" },
    event_name: { type: "string", pg_type: "VARCHAR(64)" },
    event_version: { type: "integer" },
    occurred_at: { type: "timestamp" },
    received_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
      pg_null_backfill: "now()",
    },
    account_id: { type: "uuid" },
    visitor_id: { type: "string", pg_type: "VARCHAR(96)" },
    project_id: { type: "uuid" },
    home_bay_id: { type: "string", pg_type: "VARCHAR(64)" },
    source_bay_id: { type: "string", pg_type: "VARCHAR(64)" },
    source_component: { type: "string", pg_type: "VARCHAR(48)" },
    experiment: { type: "string", pg_type: "VARCHAR(64)" },
    variant: { type: "string", pg_type: "VARCHAR(48)" },
    properties: { type: "map" },
  },
});

Table({
  name: "growth_materialization_state",
  rules: { primary_key: ["worker_name", "scope_id"] },
  fields: {
    worker_name: { type: "string", pg_type: "VARCHAR(64)" },
    scope_id: { type: "string", pg_type: "VARCHAR(64)" },
    source_watermark: {
      type: "map",
      pg_default: "'{}'::jsonb",
      not_null: true,
      pg_null_backfill: "'{}'::jsonb",
    },
    metric_definition_version: { type: "string", pg_type: "VARCHAR(32)" },
    coverage_started_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
      pg_null_backfill: "COALESCE(last_success_at, now())",
    },
    last_success_at: { type: "timestamp" },
    last_duration_ms: { type: "integer" },
    rows_processed: { type: "integer" },
    last_error: { type: "string" },
    lease_owner: { type: "string", pg_type: "VARCHAR(96)" },
    lease_expires_at: { type: "timestamp" },
    updated_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_dirty_periods",
  rules: {
    primary_key: ["metric_version", "scope_id", "period_grain", "period_start"],
    pg_indexes: ["created_at"],
  },
  fields: {
    metric_version: { type: "string", pg_type: "VARCHAR(32)" },
    scope_id: { type: "string", pg_type: "VARCHAR(64)" },
    period_grain: { type: "string", pg_type: "VARCHAR(16)" },
    period_start: { type: "timestamp", pg_type: "date" },
    reason: { type: "string", pg_type: "VARCHAR(64)" },
    created_at: { type: "timestamp" },
    updated_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_metric_series",
  rules: {
    primary_key: [
      "scope_id",
      "metric_name",
      "metric_version",
      "period_grain",
      "period_start",
      "segment_set",
      "segment_value",
    ],
    pg_indexes: ["period_start", "metric_name", "scope_id"],
    pg_custom_indexes: [
      {
        name: "growth_metric_series_read_idx",
        query: "(scope_id, period_grain, metric_name, period_start)",
      },
    ],
  },
  fields: {
    scope_id: { type: "string", pg_type: "VARCHAR(64)" },
    metric_name: { type: "string", pg_type: "VARCHAR(64)" },
    metric_version: { type: "string", pg_type: "VARCHAR(32)" },
    period_grain: { type: "string", pg_type: "VARCHAR(16)" },
    period_start: { type: "timestamp", pg_type: "date" },
    segment_set: { type: "string", pg_type: "VARCHAR(32)" },
    segment_value: { type: "string", pg_type: "VARCHAR(96)" },
    value: { type: "number", pg_type: "DOUBLE PRECISION" },
    numerator: { type: "integer" },
    denominator: { type: "integer" },
    partial: { type: "boolean" },
    materialized_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_retention_cells",
  rules: {
    primary_key: [
      "scope_id",
      "cohort_grain",
      "cohort_start",
      "activity_signal",
      "metric_version",
      "period_index",
      "segment_set",
      "segment_value",
    ],
    pg_indexes: ["cohort_start", "activity_signal", "scope_id"],
    pg_custom_indexes: [
      {
        name: "growth_retention_cells_read_idx",
        query:
          "(scope_id, cohort_grain, activity_signal, cohort_start, period_index)",
      },
    ],
  },
  fields: {
    scope_id: { type: "string", pg_type: "VARCHAR(64)" },
    cohort_grain: { type: "string", pg_type: "VARCHAR(16)" },
    cohort_start: { type: "timestamp", pg_type: "date" },
    activity_signal: { type: "string", pg_type: "VARCHAR(48)" },
    metric_version: { type: "string", pg_type: "VARCHAR(32)" },
    period_index: { type: "integer" },
    segment_set: { type: "string", pg_type: "VARCHAR(32)" },
    segment_value: { type: "string", pg_type: "VARCHAR(96)" },
    cohort_size: { type: "integer" },
    exact_active_accounts: { type: "integer" },
    rolling_active_accounts: { type: "integer" },
    complete: { type: "boolean" },
    materialized_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_weekly_accounting",
  rules: {
    primary_key: [
      "scope_id",
      "week_start",
      "activity_signal",
      "metric_version",
      "segment_set",
      "segment_value",
    ],
    pg_indexes: ["week_start", "scope_id"],
    pg_custom_indexes: [
      {
        name: "growth_weekly_accounting_read_idx",
        query: "(scope_id, activity_signal, week_start)",
      },
    ],
  },
  fields: {
    scope_id: { type: "string", pg_type: "VARCHAR(64)" },
    week_start: { type: "timestamp", pg_type: "date" },
    activity_signal: { type: "string", pg_type: "VARCHAR(48)" },
    metric_version: { type: "string", pg_type: "VARCHAR(32)" },
    segment_set: { type: "string", pg_type: "VARCHAR(32)" },
    segment_value: { type: "string", pg_type: "VARCHAR(96)" },
    new_accounts: { type: "integer" },
    retained_accounts: { type: "integer" },
    resurrected_accounts: { type: "integer" },
    churned_accounts: { type: "integer" },
    partial: { type: "boolean" },
    materialized_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_annotations",
  rules: { primary_key: "annotation_id", pg_indexes: ["occurred_at"] },
  fields: {
    annotation_id: { type: "uuid" },
    occurred_at: { type: "timestamp" },
    annotation_type: { type: "string", pg_type: "VARCHAR(48)" },
    title: { type: "string", pg_type: "VARCHAR(160)" },
    details: { type: "string" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamp" },
  },
});

Table({
  name: "growth_onboarding_continuations",
  rules: {
    primary_key: "account_id",
    pg_indexes: ["home_bay_id", "eligible_at", "status"],
    pg_custom_indexes: [
      {
        name: "growth_onboarding_continuations_due_idx",
        query: "(eligible_at, account_id) WHERE status = 'pending'",
      },
    ],
  },
  fields: {
    account_id: { type: "uuid" },
    home_bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      not_null: true,
    },
    project_id: { type: "uuid", not_null: true },
    onboarding_path: {
      type: "string",
      pg_type: "VARCHAR(48)",
      not_null: true,
    },
    source_event_id: { type: "uuid", not_null: true },
    notification_event_id: { type: "uuid", not_null: true },
    notification_id: { type: "uuid", not_null: true },
    eligible_at: { type: "timestamp", not_null: true },
    status: {
      type: "string",
      pg_type: "VARCHAR(24)",
      pg_default: "'pending'::character varying",
      not_null: true,
      pg_null_backfill: "'pending'::character varying",
    },
    attempt_count: {
      type: "integer",
      pg_default: "0",
      not_null: true,
      pg_null_backfill: "0",
    },
    last_error: { type: "string" },
    sent_at: { type: "timestamp" },
    suppressed_at: { type: "timestamp" },
    suppression_reason: { type: "string", pg_type: "VARCHAR(64)" },
    created_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
      pg_null_backfill: "now()",
    },
    updated_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
      pg_null_backfill: "now()",
    },
  },
});
