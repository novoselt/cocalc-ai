/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { GcpProvider, type HostRuntime, type HostSpec } from "@cocalc/cloud";
import { getProviderContext } from "@cocalc/server/cloud/provider-context";
import { getComputeMachine } from "./catalog";
import { getComputeVmConfig, type ComputeVmConfig } from "./config";
import type { ComputeVmRow } from "./types";

const provider = new GcpProvider();

function specFor(
  vm: ComputeVmRow,
  config: ComputeVmConfig,
  pricingModel = vm.effective_pricing_model,
): HostSpec {
  const machine = getComputeMachine(vm.machine_type);
  return {
    name: vm.provider_instance_id,
    region: vm.region,
    zone: vm.zone,
    pricing_model: pricingModel,
    cpu: machine.cpu,
    ram_gb: machine.ram_gb,
    disk_gb: 0,
    disk_type: "balanced",
    tags: [config.gcp_network_tag],
    metadata: {
      machine_type: machine.machine_type,
      storage_mode: "boot-only",
      boot_disk_gb: vm.boot_disk_gb,
      boot_disk_name: vm.boot_disk_id,
      persistent_boot_disk: true,
      source_image_project: "ubuntu-os-cloud",
      source_image_family: machine.image_family,
      ssh_user: vm.ssh_user,
      ssh_public_key: vm.ssh_public_key,
      block_project_ssh_keys: true,
      disable_service_account: true,
      subnetwork_uri: config.gcp_subnetwork,
      labels: {
        "managed-by": "cocalc-compute",
        "logical-vm": vm.id.replaceAll("-", "").slice(0, 40),
        owner: vm.owner_account_id.replaceAll("-", "").slice(0, 40),
        environment: config.environment,
      },
    },
  };
}

function runtimeFor(vm: ComputeVmRow): HostRuntime {
  return {
    provider: "gcp",
    instance_id: vm.provider_instance_id,
    public_ip: vm.public_ip ?? undefined,
    ssh_user: vm.ssh_user,
    zone: vm.zone,
    metadata: {
      ...(vm.metadata?.runtime ?? {}),
      boot_disk_name: vm.boot_disk_id,
      persistent_boot_disk: true,
      machine_type: vm.machine_type,
      ssh_public_key: vm.ssh_public_key,
      ssh_user: vm.ssh_user,
    },
  };
}

async function context() {
  const config = await getComputeVmConfig();
  if (config.gcp_service_account_json) {
    return {
      config,
      creds: {
        service_account_json: config.gcp_service_account_json,
        prefix: "cocalc-vm",
      },
    };
  }
  if (config.staging_legacy_provider) {
    const { creds } = await getProviderContext("gcp");
    return { config, creds };
  }
  throw new Error(
    "managed compute VM provider credentials are not configured for this environment",
  );
}

export async function createProviderComputeVm(vm: ComputeVmRow) {
  const { config, creds } = await context();
  return await provider.createHost(specFor(vm, config), creds);
}

export async function startProviderComputeVm(vm: ComputeVmRow) {
  const { creds } = await context();
  await provider.startHost(runtimeFor(vm), creds);
}

export async function stopProviderComputeVm(vm: ComputeVmRow) {
  const { creds } = await context();
  try {
    await provider.stopHost(runtimeFor(vm), creds);
  } catch (err) {
    if (!/already.*stopped|terminated|not.*running/i.test(`${err}`)) throw err;
  }
}

export async function deleteProviderComputeVm(vm: ComputeVmRow) {
  const { creds } = await context();
  const runtime = runtimeFor(vm);
  await provider.deleteHost(runtime, creds, { preserveDataDisk: true });
  await provider.deletePersistentBootDisk(runtime, creds);
}

export async function inspectProviderComputeVm(vm: ComputeVmRow) {
  const { creds } = await context();
  try {
    const runtime = runtimeFor(vm);
    const [status, instance] = await Promise.all([
      provider.getStatus(runtime, creds),
      provider.getInstance(runtime, creds),
    ]);
    return { status, instance };
  } catch (err) {
    if (/not found|was not found|code.?5/i.test(`${err}`)) {
      return { status: "missing" as const, instance: undefined };
    }
    throw err;
  }
}

export async function setProviderComputePricing(
  vm: ComputeVmRow,
  pricingModel: "spot" | "on_demand",
) {
  const { creds } = await context();
  await provider.setPricingModel(runtimeFor(vm), pricingModel, creds);
}

export async function probeProviderComputeSpot(vm: ComputeVmRow) {
  const { config, creds } = await context();
  return await provider.probeSpotAvailability(
    specFor(vm, config, "spot"),
    creds,
    {
      stableForMs: 10_000,
    },
  );
}
