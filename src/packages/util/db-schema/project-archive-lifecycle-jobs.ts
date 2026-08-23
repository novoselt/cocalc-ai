/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "project_archive_lifecycle_jobs",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "project_id",
      "owning_bay_id",
      "host_id",
      "reason",
      "status",
      "next_attempt_at",
      "created_at",
    ],
    pg_custom_indexes: [
      {
        name: "project_archive_lifecycle_dedupe_idx",
        query: "(dedupe_key)",
        unique: true,
      },
      {
        name: "project_archive_lifecycle_active_project_idx",
        query: "(project_id) WHERE status IN ('queued', 'running')",
        unique: true,
      },
      {
        name: "project_archive_lifecycle_due_idx",
        query:
          "(next_attempt_at, created_at) WHERE status IN ('queued', 'failed')",
      },
      {
        name: "project_archive_lifecycle_host_status_idx",
        query: "(host_id, status) WHERE status IN ('queued', 'running')",
      },
    ],
    user_query: {
      get: {
        admin: true,
        fields: {
          id: null,
          project_id: null,
          owning_bay_id: null,
          host_id: null,
          reason: null,
          policy_version: null,
          status: null,
          report_only: null,
          selector_at: null,
          claimed_at: null,
          completed_at: null,
          next_attempt_at: null,
          actor_account_id: null,
          attempts: null,
          thresholds: null,
          evidence: null,
          backup_repo_id: null,
          backup_generation: null,
          backup_time: null,
          failure_category: null,
          error: null,
          bytes_before: null,
          bytes_after: null,
          created_at: null,
          updated_at: null,
        },
      },
    },
  },
  fields: {
    id: { type: "uuid", desc: "Unique lifecycle attempt id." },
    project_id: {
      type: "uuid",
      desc: "Project controlled by its owning bay.",
    },
    owning_bay_id: { type: "string", desc: "Authoritative owning bay." },
    host_id: { type: "uuid", desc: "Observed project host." },
    reason: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "manual, free-inactive, or all-collaborators-banned.",
    },
    policy_version: { type: "integer", desc: "Lifecycle policy version." },
    status: {
      type: "string",
      pg_type: "VARCHAR(32)",
      desc: "Durable attempt status.",
    },
    report_only: {
      type: "boolean",
      pg_default: "FALSE",
      desc: "Whether mutation was suppressed.",
    },
    selector_at: {
      type: "timestamp",
      pg_default: "now()",
      desc: "Candidate selection time.",
    },
    claimed_at: { type: "timestamp", desc: "Execution claim time." },
    completed_at: { type: "timestamp", desc: "Terminal completion time." },
    next_attempt_at: { type: "timestamp", desc: "Retry eligibility time." },
    actor_account_id: {
      type: "uuid",
      desc: "Manual actor; null represents the system.",
      render: { type: "account" },
    },
    attempts: {
      type: "integer",
      pg_default: "0",
      desc: "Execution attempt count.",
    },
    thresholds: {
      type: "map",
      pg_default: "'{}'::jsonb",
      desc: "Effective policy settings.",
    },
    evidence: {
      type: "map",
      pg_default: "'{}'::jsonb",
      desc: "Eligibility and safety evidence.",
    },
    backup_repo_id: { type: "uuid", desc: "Rustic repository used." },
    backup_generation: {
      type: "integer",
      desc: "Persisted generation covered by the backup.",
    },
    backup_time: { type: "timestamp", desc: "Backup completion time." },
    failure_category: { type: "string", desc: "Stable failure category." },
    error: { type: "string", desc: "Bounded failure detail." },
    bytes_before: {
      type: "integer",
      desc: "Measured local bytes before cleanup.",
    },
    bytes_after: {
      type: "integer",
      desc: "Measured local bytes after cleanup.",
    },
    dedupe_key: { type: "string", desc: "Idempotent selector key." },
    created_at: {
      type: "timestamp",
      pg_default: "now()",
      desc: "Creation time.",
    },
    updated_at: {
      type: "timestamp",
      pg_default: "now()",
      desc: "Last update time.",
    },
  },
});
