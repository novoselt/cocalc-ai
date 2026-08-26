/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_revenue_analytics_state",
  rules: { primary_key: "bay_id" },
  fields: {
    bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Bay whose local projection is tracked by this watermark.",
    },
    complete_through: {
      type: "timestamp",
      pg_type: "date",
      desc: "Latest complete UTC day included in the contiguous projection.",
    },
    last_scanned_at: {
      type: "timestamp",
      desc: "Latest source-change scan completed successfully.",
    },
    updated_at: {
      type: "timestamp",
      desc: "When this maintenance state was last updated.",
      pg_default: "now()",
      not_null: true,
    },
  },
});
