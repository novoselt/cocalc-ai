/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_project_budgets",
  rules: {
    primary_key: "id",
    pg_indexes: ["owner_account_id", "project_id", "updated_at"],
  },
  fields: {
    id: { type: "uuid", desc: "Stable budget identifier." },
    owner_account_id: {
      type: "uuid",
      desc: "Account that owns this budget and the charged resources.",
    },
    owning_bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Account-home bay authoritative for this budget.",
    },
    project_id: {
      type: "uuid",
      desc: "Project used to group compute resources and budget UX.",
    },
    period: { type: "string", desc: "Recurring UTC week or month." },
    limit_usd: { type: "string", desc: "Maximum spend in each period." },
    enabled: {
      type: "boolean",
      desc: "Whether admission and enforcement apply.",
    },
    created_at: { type: "timestamp", desc: "Budget creation time." },
    updated_at: { type: "timestamp", desc: "Last budget policy update." },
  },
});
