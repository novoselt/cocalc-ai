/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_usage_charges",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "owner_account_id",
      "project_id",
      "resource_id",
      "started_at",
      "ended_at",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Usage charge identifier." },
    owner_account_id: { type: "uuid", desc: "Account charged for usage." },
    owning_bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Account-home bay authoritative for this charge.",
    },
    project_id: { type: "uuid", desc: "Project budget grouping." },
    resource_kind: { type: "string", desc: "vm or volume." },
    resource_id: { type: "uuid", desc: "Charged compute resource." },
    amount_usd: { type: "string", desc: "Charge for this bounded interval." },
    started_at: { type: "timestamp", desc: "Inclusive usage interval start." },
    ended_at: { type: "timestamp", desc: "Exclusive usage interval end." },
    details: { type: "map", desc: "Immutable price and quantity inputs." },
    created_at: { type: "timestamp", desc: "Ledger insertion time." },
  },
});
