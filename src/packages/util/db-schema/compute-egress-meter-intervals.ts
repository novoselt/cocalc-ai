/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_egress_meter_intervals",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "owner_account_id",
      "project_id",
      "resource_id",
      "started_at",
      "ended_at",
    ],
    pg_unique_indexes: ["(resource_id,started_at,ended_at)"],
  },
  fields: {
    id: { type: "uuid", desc: "Internal metering interval identifier." },
    owner_account_id: { type: "uuid", desc: "Account charged for usage." },
    owning_bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Account-home bay authoritative for this interval.",
    },
    project_id: { type: "uuid", desc: "Project associated with the VM." },
    resource_id: { type: "uuid", desc: "Managed compute VM identifier." },
    purchase_id: {
      type: "number",
      pg_type: "BIGINT",
      desc: "Single accumulating purchase updated by this interval.",
    },
    funding_lane: {
      type: "string",
      desc: "Shared dedicated-host funding lane used for this charge.",
    },
    bytes: {
      type: "number",
      pg_type: "BIGINT",
      desc: "Public Internet egress bytes in this interval.",
    },
    amount_usd: {
      type: "string",
      pg_type: "NUMERIC(20,10)",
      desc: "Customer charge for this bounded interval.",
    },
    started_at: { type: "timestamp", desc: "Inclusive interval start." },
    ended_at: { type: "timestamp", desc: "Exclusive interval end." },
    details: {
      type: "map",
      desc: "Immutable provider metric and unit-price inputs.",
    },
    created_at: { type: "timestamp", desc: "Ledger insertion time." },
  },
});
