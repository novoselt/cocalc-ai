/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_vm_project_access",
  rules: {
    primary_key: ["vm_id", "project_id"],
    pg_indexes: [
      "owner_account_id",
      "owning_bay_id",
      "project_id",
      "state",
      "revoked_at",
    ],
  },
  fields: {
    vm_id: { type: "uuid", desc: "Account-owned managed compute VM." },
    project_id: {
      type: "uuid",
      desc: "Project receiving revocable SSH/data-plane access.",
    },
    owner_account_id: {
      type: "uuid",
      desc: "Account authoritative for the VM and this access grant.",
    },
    owning_bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Account-home bay authoritative for this access grant.",
    },
    access_level: {
      type: "string",
      pg_default: "'connect'",
      not_null: true,
      desc: "Granted project capability; currently connect only.",
    },
    ssh_public_key: {
      type: "string",
      desc: "Exact project deploy public key authorized on the VM.",
    },
    state: {
      type: "string",
      pg_default: "'pending'",
      not_null: true,
      desc: "pending, ready, degraded, revoking, or revoked.",
    },
    created_by_account_id: {
      type: "uuid",
      desc: "Human account that granted access.",
    },
    created_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
    },
    updated_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
    },
    revoked_at: { type: "timestamp" },
    error: { type: "string", desc: "Latest bounded reconciliation error." },
    metadata: {
      type: "map",
      desc: "Bounded migration and reconciliation diagnostics.",
    },
  },
});
