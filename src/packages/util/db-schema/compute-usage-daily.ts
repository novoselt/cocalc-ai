/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_usage_daily",
  rules: {
    primary_key: ["day", "bay_id", "product", "provider"],
    pg_indexes: ["day", "bay_id", "product", "provider"],
  },
  fields: {
    day: {
      type: "timestamp",
      pg_type: "date",
      desc: "Complete UTC date represented by this derived usage row.",
    },
    bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Bay whose customer-funded compute usage contributed to this row.",
    },
    product: {
      type: "string",
      pg_type: "VARCHAR(32)",
      desc: "Dedicated-host or virtual-machine usage product.",
      pg_check: "CHECK (product IN ('dedicated-host','virtual-machine'))",
    },
    provider: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Cloud provider recorded on the purchase, or unknown.",
    },
    running_unit_seconds: {
      type: "number",
      pg_type: "bigint",
      desc: "Running machine-seconds during this UTC day.",
      not_null: true,
    },
    distinct_running_units: {
      type: "integer",
      desc: "Distinct machines with any running time during this UTC day.",
      not_null: true,
    },
    updated_at: {
      type: "timestamp",
      desc: "When this derived row was last rebuilt.",
      pg_default: "now()",
      not_null: true,
    },
  },
});
