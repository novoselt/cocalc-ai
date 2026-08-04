/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "compute_vms",
  rules: {
    primary_key: "id",
    pg_indexes: [
      "owner_account_id",
      "project_id",
      "owning_bay_id",
      "state",
      "desired_state",
      "expires_at",
      "provider_instance_id",
    ],
  },
  fields: {
    id: { type: "uuid", desc: "Stable logical compute VM identifier." },
    name: { type: "string", desc: "Owner-selected VM name." },
    owner_account_id: {
      type: "uuid",
      desc: "Account that owns the VM and its costs.",
    },
    owning_bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Account-home bay authoritative for this VM.",
    },
    project_id: {
      type: "uuid",
      desc: "Project used for discovery and scoped agent access.",
    },
    provider: { type: "string", desc: "Cloud provider; GCP in the MVP." },
    region: { type: "string", desc: "Cloud region." },
    zone: { type: "string", desc: "Cloud zone." },
    architecture: { type: "string", desc: "Guest CPU architecture." },
    machine_type: { type: "string", desc: "Provider machine type." },
    desired_pricing_model: {
      type: "string",
      desc: "Owner-authorized pricing model.",
    },
    effective_pricing_model: {
      type: "string",
      desc: "Pricing model used by the current provider generation.",
    },
    boot_disk_gb: { type: "number", desc: "Persistent boot disk size." },
    boot_disk_id: {
      type: "string",
      desc: "Provider boot disk retained across instance recovery.",
    },
    attached_volume_id: {
      type: "uuid",
      desc: "Optional account-owned volume mounted at /work.",
    },
    state: { type: "string", desc: "Observed logical VM state." },
    desired_state: { type: "string", desc: "Requested logical VM state." },
    instance_generation: {
      type: "number",
      desc: "Monotonic provider generation number.",
    },
    provider_instance_id: {
      type: "string",
      desc: "Current provider instance identifier.",
    },
    public_ip: { type: "string", desc: "Current ephemeral public IPv4." },
    ssh_user: { type: "string", desc: "SSH login user." },
    ssh_public_key: {
      type: "string",
      desc: "Public key installed for owner access; never a private key.",
    },
    created_at: { type: "timestamp", desc: "Lease creation time." },
    updated_at: { type: "timestamp", desc: "Last control-plane update." },
    ready_at: { type: "timestamp", desc: "Current generation readiness." },
    expires_at: { type: "timestamp", desc: "Hard guest-independent deadline." },
    stopped_at: { type: "timestamp", desc: "Most recent stop time." },
    deleted_at: { type: "timestamp", desc: "Logical deletion completion." },
    allow_on_demand_fallback: {
      type: "boolean",
      desc: "Whether bounded Spot fallback is authorized.",
    },
    authorized_fallback_hours: {
      type: "number",
      desc: "Maximum authorized on-demand fallback duration.",
    },
    spot_hourly_price: {
      type: "string",
      desc: "Immutable customer Spot price snapshot in USD.",
    },
    on_demand_hourly_price: {
      type: "string",
      desc: "Immutable customer on-demand price snapshot in USD.",
    },
    authorized_cost: {
      type: "string",
      desc: "Maximum fixed compute cost authorized by the actor.",
    },
    accrued_cost: {
      type: "string",
      desc: "Reconciled fixed compute cost accrued so far.",
    },
    billing_updated_at: {
      type: "timestamp",
      desc: "End of the last interval written to the usage ledger.",
    },
    billing_state: {
      type: "string",
      desc: "Billing and price-envelope enforcement state.",
    },
    spot_recovery_policy: {
      type: "map",
      desc: "Normalized project-host-compatible Spot policy.",
    },
    spot_recovery_state: {
      type: "map",
      desc: "Observed Spot interruption and fallback state.",
    },
    idempotency_key: {
      type: "string",
      desc: "Owner-scoped create idempotency key.",
    },
    error: { type: "string", desc: "Latest bounded lifecycle error." },
    metadata: {
      type: "map",
      desc: "Non-authoritative provider and staging diagnostics.",
    },
  },
});
