/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { authFirstRequireAccount } from "./util";
import type { HostCatalog } from "./hosts";

export type ComputeVmPricingModel = "spot" | "on_demand";
export type ComputeVmDesiredState = "running" | "stopped" | "deleted";

export interface ComputeVm {
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
  attached_volume_id?: string | null;
  state: string;
  desired_state: ComputeVmDesiredState;
  instance_generation: number;
  provider_instance_id: string;
  public_ip?: string | null;
  private_ip?: string | null;
  internal_hostname?: string | null;
  ssh_user: string;
  created_at: string | Date;
  updated_at: string | Date;
  ready_at?: string | Date | null;
  expires_at?: string | Date | null;
  stopped_at?: string | Date | null;
  deleted_at?: string | Date | null;
  allow_on_demand_fallback: boolean;
  authorized_fallback_hours: number;
  spot_hourly_price: string;
  on_demand_hourly_price: string;
  authorized_cost: string;
  accrued_cost: string;
  billing_state: string;
  spot_recovery_policy: Record<string, any>;
  spot_recovery_state: Record<string, any>;
  error?: string | null;
  metadata: Record<string, any>;
}

export interface CreateComputeVmRequest {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  project_id: string;
  name: string;
  zone: string;
  machine_type: string;
  pricing_model: ComputeVmPricingModel;
  allow_on_demand_fallback?: boolean;
  ttl_minutes?: number | null;
  boot_disk_gb?: number;
  volume?: string;
  funding_mode?: "account-prepaid" | "account-postpaid";
  ssh_public_key?: string;
  idempotency_key: string;
}

export interface ComputeVolume {
  id: string;
  name: string;
  owner_account_id: string;
  owning_bay_id: string;
  project_id?: string | null;
  provider: "gcp";
  region: string;
  zone: string;
  disk_type: "balanced";
  filesystem: "ext4";
  size_gb: number;
  desired_size_gb: number;
  provider_disk_id: string;
  state: string;
  desired_state: "ready" | "deleted";
  attached_vm_id?: string | null;
  attachment_generation: number;
  attachment_state: "detached" | "reserved" | "attached" | "unknown";
  created_at: string | Date;
  updated_at: string | Date;
  ready_at?: string | Date | null;
  resized_at?: string | Date | null;
  detached_at?: string | Date | null;
  deleted_at?: string | Date | null;
  monthly_price_per_gb: string;
  authorized_monthly_cost: string;
  billing_state: string;
  error?: string | null;
  metadata: Record<string, any>;
}

export interface CreateComputeVolumeRequest {
  account_id?: string;
  browser_id?: string;
  session_hash?: string;
  project_id: string;
  name: string;
  zone: string;
  size_gb: number;
  funding_mode?: "account-prepaid" | "account-postpaid";
  idempotency_key: string;
}

export interface ComputeCatalog {
  host_catalog: HostCatalog;
  defaults: {
    zone: string;
    machine_type: string;
    ttl_minutes?: number | null;
    boot_disk_gb: number;
  };
  limits: {
    max_active_per_project: number;
    max_ttl_minutes: number;
    max_boot_disk_gb: number;
    max_volume_gb: number;
  };
}

export const compute = {
  getCatalog: authFirstRequireAccount,
  createVm: authFirstRequireAccount,
  listVms: authFirstRequireAccount,
  getVm: authFirstRequireAccount,
  authorizeSshKey: authFirstRequireAccount,
  startVm: authFirstRequireAccount,
  stopVm: authFirstRequireAccount,
  deleteVm: authFirstRequireAccount,
  setVmTtl: authFirstRequireAccount,
  createVolume: authFirstRequireAccount,
  listVolumes: authFirstRequireAccount,
  getVolume: authFirstRequireAccount,
  resizeVolume: authFirstRequireAccount,
  deleteVolume: authFirstRequireAccount,
};

export interface ComputeApi {
  getCatalog: (opts: { account_id?: string }) => Promise<ComputeCatalog>;
  createVm: (opts: CreateComputeVmRequest) => Promise<ComputeVm>;
  listVms: (opts: {
    account_id?: string;
    project_id?: string;
    include_deleted?: boolean;
  }) => Promise<ComputeVm[]>;
  getVm: (opts: {
    account_id?: string;
    id_or_name: string;
  }) => Promise<ComputeVm>;
  authorizeSshKey: (opts: {
    account_id?: string;
    browser_id?: string;
    session_hash?: string;
    id_or_name: string;
    ssh_public_key: string;
    idempotency_key: string;
  }) => Promise<ComputeVm>;
  startVm: (opts: {
    account_id?: string;
    id_or_name: string;
    idempotency_key: string;
  }) => Promise<ComputeVm>;
  stopVm: (opts: {
    account_id?: string;
    id_or_name: string;
    idempotency_key: string;
  }) => Promise<ComputeVm>;
  deleteVm: (opts: {
    account_id?: string;
    browser_id?: string;
    session_hash?: string;
    id_or_name: string;
    idempotency_key: string;
  }) => Promise<ComputeVm>;
  setVmTtl: (opts: {
    account_id?: string;
    browser_id?: string;
    session_hash?: string;
    id_or_name: string;
    ttl_minutes?: number | null;
    extend_minutes?: number;
    idempotency_key: string;
  }) => Promise<ComputeVm>;
  createVolume: (opts: CreateComputeVolumeRequest) => Promise<ComputeVolume>;
  listVolumes: (opts: {
    account_id?: string;
    project_id?: string;
    include_deleted?: boolean;
  }) => Promise<ComputeVolume[]>;
  getVolume: (opts: {
    account_id?: string;
    id_or_name: string;
  }) => Promise<ComputeVolume>;
  resizeVolume: (opts: {
    account_id?: string;
    browser_id?: string;
    session_hash?: string;
    id_or_name: string;
    size_gb: number;
    funding_mode?: "account-prepaid" | "account-postpaid";
    idempotency_key: string;
  }) => Promise<ComputeVolume>;
  deleteVolume: (opts: {
    account_id?: string;
    browser_id?: string;
    session_hash?: string;
    id_or_name: string;
    confirm_name: string;
    idempotency_key: string;
  }) => Promise<ComputeVolume>;
}
