/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

// Restricted internal regional-adoption analytics. These tables contain only
// hourly country-level aggregates, never account identifiers or precise
// locations. Data is retained indefinitely by default; maintenance supports an
// explicit finite retention window if policy changes later.
Table({
  name: "active_user_map_history_snapshots",
  rules: {
    primary_key: ["snapshot_hour", "active_minutes"],
    pg_indexes: ["captured_at"],
  },
  fields: {
    snapshot_hour: {
      type: "timestamp",
      desc: "UTC hour represented by this rolling activity snapshot.",
    },
    active_minutes: {
      type: "integer",
      desc: "Trailing activity window in minutes: 60 or 1440.",
    },
    captured_at: {
      type: "timestamp",
      desc: "When the cluster-wide snapshot was collected.",
    },
    total_active: {
      type: "integer",
      desc: "All distinct accounts active during the window.",
    },
    mapped_active: {
      type: "integer",
      desc: "Active accounts included in consent-gated country counts.",
    },
    unknown_location: {
      type: "integer",
      desc: "Consenting active accounts without a usable current country.",
    },
    usage_metrics_not_enabled: {
      type: "integer",
      desc: "Active accounts not included because usage metrics are not enabled.",
    },
    bay_count: {
      type: "integer",
      desc: "Number of configured bays included in the complete snapshot.",
    },
  },
});

Table({
  name: "active_user_map_history_countries",
  rules: {
    primary_key: ["snapshot_hour", "active_minutes", "country_code"],
    pg_indexes: ["country_code", "snapshot_hour"],
  },
  fields: {
    snapshot_hour: {
      type: "timestamp",
      desc: "UTC hour represented by this rolling activity snapshot.",
    },
    active_minutes: {
      type: "integer",
      desc: "Trailing activity window in minutes: 60 or 1440.",
    },
    country_code: {
      type: "string",
      pg_type: "VARCHAR(2)",
      desc: "Normalized two-character alphanumeric country code.",
    },
    active_count: {
      type: "integer",
      desc: "Consenting active accounts mapped to this country.",
    },
  },
});
