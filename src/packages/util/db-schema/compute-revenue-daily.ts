/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_revenue_daily",
  rules: {
    primary_key: ["day", "bay_id", "product", "provider", "cost_component"],
    pg_indexes: ["day", "bay_id", "product", "provider", "cost_component"],
  },
  fields: {
    day: {
      type: "timestamp",
      pg_type: "date",
      desc: "Complete UTC date represented by this derived revenue row.",
    },
    bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Bay whose customer-funded compute purchases contributed to this row.",
    },
    product: {
      type: "string",
      pg_type: "VARCHAR(32)",
      desc: "Dedicated-host or virtual-machine revenue product.",
      pg_check: "CHECK (product IN ('dedicated-host','virtual-machine'))",
    },
    provider: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Cloud provider recorded on the purchase, or unknown.",
    },
    cost_component: {
      type: "string",
      pg_type: "VARCHAR(32)",
      desc: "Compute, GPU, storage, network-egress, or other revenue component.",
      pg_check:
        "CHECK (cost_component IN ('compute','gpu','storage','network-egress','other'))",
    },
    revenue_cents: {
      type: "number",
      pg_type: "bigint",
      desc: "Net whole-cent customer revenue allocated to this day.",
      not_null: true,
    },
    purchase_count: {
      type: "integer",
      desc: "Number of source purchase allocations contributing to this row.",
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
