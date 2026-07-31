/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "project_host_exam_runs",
  rules: {
    primary_key: "run_id",
    pg_indexes: ["host_id", "status", "scheduled_stop_at", "updated_at"],
  },
  fields: {
    run_id: {
      type: "uuid",
      desc: "Unique id for one time-bounded exam scratchpad run.",
    },
    host_id: {
      type: "uuid",
      desc: "Reusable private project host running this exam.",
    },
    config_generation: {
      type: "number",
      desc: "Exam configuration generation frozen into this run.",
    },
    status: {
      type: "string",
      desc: "Persisted exam run state-machine status.",
    },
    token_hash: {
      type: "string",
      desc: "Scrypt hash of the shared admission token.",
    },
    create_idempotency_key: {
      type: "string",
      desc: "Caller-stable key used to make run creation retry safe.",
    },
    token_idempotency_key: {
      type: "string",
      desc: "Caller-stable key for the latest token rotation.",
    },
    rootfs_image: {
      type: "string",
      desc: "Runtime RootFS image frozen into this run.",
    },
    rootfs_digest: {
      type: "string",
      desc: "Immutable RootFS digest verified when the run is prepared.",
    },
    run_quota: {
      type: "map",
      desc: "Per-project resource limits frozen into this run.",
    },
    max_projects: {
      type: "number",
      desc: "Maximum projects frozen into this run.",
    },
    terminal_enabled: {
      type: "boolean",
      desc: "Whether terminals are enabled for this run.",
    },
    network_mode: {
      type: "string",
      desc: "Per-project network policy frozen into this run.",
    },
    scheduled_stop_at: {
      type: "timestamp",
      desc: "Mandatory deadline for admission closure, cleanup, and VM stop.",
    },
    owner_account_id: {
      type: "uuid",
      desc: "Project-host owner charged for exam project egress.",
    },
    opened_at: {
      type: "timestamp",
      desc: "When anonymous admission opened.",
    },
    admission_closed_at: {
      type: "timestamp",
      desc: "When new anonymous admission closed.",
    },
    cleanup_started_at: {
      type: "timestamp",
      desc: "When exam project cleanup started.",
    },
    cleaned_at: {
      type: "timestamp",
      desc: "When host-local exam data deletion was verified.",
    },
    stopped_at: {
      type: "timestamp",
      desc: "When the reusable host VM was observed stopped.",
    },
    last_error: {
      type: "string",
      desc: "Most recent lifecycle failure, if any.",
    },
    created_at: {
      type: "timestamp",
      desc: "When this run was created.",
    },
    updated_at: {
      type: "timestamp",
      desc: "When this run was last changed.",
    },
    created_by: {
      type: "uuid",
      desc: "Instructor account that created this run.",
    },
  },
});
