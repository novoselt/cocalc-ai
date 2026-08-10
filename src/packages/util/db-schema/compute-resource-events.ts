/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_resource_events",
  rules: {
    primary_key: "id",
    pg_indexes: ["resource_id", "owner_account_id", "created_at", "action"],
  },
  fields: {
    id: { type: "uuid", desc: "Audit event identifier." },
    resource_kind: { type: "string", desc: "vm or volume." },
    resource_id: { type: "uuid", desc: "Logical resource identifier." },
    owner_account_id: { type: "uuid", desc: "Resource owner." },
    project_id: { type: "uuid", desc: "Attached project when applicable." },
    actor_account_id: { type: "uuid", desc: "Human actor account." },
    actor_kind: { type: "string", desc: "human, agent, worker, or system." },
    action: { type: "string", desc: "Requested or completed action." },
    idempotency_key: { type: "string", desc: "Request idempotency identity." },
    old_state: { type: "string", desc: "State before the event." },
    new_state: { type: "string", desc: "State after the event." },
    status: { type: "string", desc: "requested, success, or failure." },
    details: { type: "map", desc: "Redacted authorization and diagnostics." },
    created_at: { type: "timestamp", desc: "Event time." },
  },
});
