/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type ComputeVmState =
  | "requested"
  | "provisioning"
  | "starting"
  | "ready"
  | "stopping"
  | "stopped"
  | "recovering"
  | "deleting"
  | "deleted"
  | "failed";

export type ComputeVmDesiredState = "running" | "stopped" | "deleted";
export type ComputeVmPricingModel = "spot" | "on_demand";

export interface ComputeVmRow {
  id: string;
  name: string;
  owner_account_id: string;
  owning_bay_id: string;
  project_id: string;
  provider: "gcp";
  region: string;
  zone: string;
  architecture: "x86_64" | "arm64";
  machine_type: string;
  desired_pricing_model: ComputeVmPricingModel;
  effective_pricing_model: ComputeVmPricingModel;
  boot_disk_gb: number;
  boot_disk_id: string;
  state: ComputeVmState;
  desired_state: ComputeVmDesiredState;
  instance_generation: number;
  provider_instance_id: string;
  public_ip?: string | null;
  ssh_user: string;
  ssh_public_key: string;
  created_at: Date;
  updated_at: Date;
  ready_at?: Date | null;
  expires_at: Date;
  stopped_at?: Date | null;
  deleted_at?: Date | null;
  allow_on_demand_fallback: boolean;
  authorized_fallback_hours: number;
  spot_hourly_price: string;
  on_demand_hourly_price: string;
  authorized_cost: string;
  accrued_cost: string;
  billing_state: string;
  spot_recovery_policy: Record<string, any>;
  spot_recovery_state: Record<string, any>;
  idempotency_key: string;
  error?: string | null;
  metadata: Record<string, any>;
}

export interface ComputeWorkRow {
  id: string;
  resource_kind: "vm";
  resource_id: string;
  action: string;
  idempotency_key: string;
  payload: Record<string, any>;
  state: string;
  attempt: number;
  not_before?: Date | null;
  locked_by?: string | null;
  locked_at?: Date | null;
  error?: string | null;
}
