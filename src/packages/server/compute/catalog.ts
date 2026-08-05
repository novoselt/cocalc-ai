/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export interface ComputeMachineCatalogEntry {
  machine_type: string;
  architecture: "x86_64" | "arm64";
  cpu: number;
  ram_gb: number;
  image_family: string;
  // Staging admission snapshots only. Customer billing is not enabled yet.
  spot_hourly_usd: number;
  on_demand_hourly_usd: number;
}

export const COMPUTE_MACHINE_CATALOG: Record<
  string,
  ComputeMachineCatalogEntry
> = {
  "e2-standard-2": {
    machine_type: "e2-standard-2",
    architecture: "x86_64",
    cpu: 2,
    ram_gb: 8,
    image_family: "ubuntu-2404-lts-amd64",
    spot_hourly_usd: 0.021,
    on_demand_hourly_usd: 0.068,
  },
  "n2d-standard-16": {
    machine_type: "n2d-standard-16",
    architecture: "x86_64",
    cpu: 16,
    ram_gb: 64,
    image_family: "ubuntu-2404-lts-amd64",
    spot_hourly_usd: 0.202,
    on_demand_hourly_usd: 0.675,
  },
  "t2d-standard-16": {
    machine_type: "t2d-standard-16",
    architecture: "x86_64",
    cpu: 16,
    ram_gb: 64,
    image_family: "ubuntu-2404-lts-amd64",
    spot_hourly_usd: 0.202,
    on_demand_hourly_usd: 0.675,
  },
  "t2a-standard-4": {
    machine_type: "t2a-standard-4",
    architecture: "arm64",
    cpu: 4,
    ram_gb: 16,
    image_family: "ubuntu-2404-lts-arm64",
    spot_hourly_usd: 0.051,
    on_demand_hourly_usd: 0.17,
  },
};

export function getComputeMachine(machineType: string) {
  const entry = COMPUTE_MACHINE_CATALOG[machineType];
  if (!entry) {
    throw new Error(
      `unsupported compute machine '${machineType}'; allowed: ${Object.keys(
        COMPUTE_MACHINE_CATALOG,
      ).join(", ")}`,
    );
  }
  return entry;
}
