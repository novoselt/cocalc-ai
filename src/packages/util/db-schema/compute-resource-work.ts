/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_resource_work",
  rules: {
    primary_key: "id",
    pg_indexes: ["resource_id", "state", "not_before", "locked_at"],
  },
  fields: {
    id: { type: "uuid", desc: "Durable work identifier." },
    resource_kind: { type: "string", desc: "vm or volume." },
    resource_id: { type: "uuid", desc: "Logical resource identifier." },
    action: { type: "string", desc: "Idempotent provider action." },
    idempotency_key: { type: "string", desc: "Mutation idempotency key." },
    payload: { type: "map", desc: "Non-secret work parameters." },
    state: { type: "string", desc: "queued, in_progress, done, or failed." },
    attempt: { type: "number", desc: "Execution attempt count." },
    not_before: { type: "timestamp", desc: "Earliest execution time." },
    locked_by: { type: "string", desc: "Worker lease owner." },
    locked_at: { type: "timestamp", desc: "Worker lease refresh time." },
    provider_operation_id: {
      type: "string",
      desc: "Provider operation identity when available.",
    },
    error: { type: "string", desc: "Latest bounded execution error." },
    created_at: { type: "timestamp", desc: "Work creation time." },
    updated_at: { type: "timestamp", desc: "Last work state update." },
  },
});
