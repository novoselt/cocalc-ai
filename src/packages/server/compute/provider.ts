/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { GcpProvider, type HostRuntime, type HostSpec } from "@cocalc/cloud";
import { getProviderContext } from "@cocalc/server/cloud/provider-context";
import { getComputeMachine } from "./catalog";
import { getComputeVmConfig, type ComputeVmConfig } from "./config";
import type { ComputeVmRow, ComputeVolumeRow } from "./types";
import { assertComputeVmSecurity } from "./security";

const provider = new GcpProvider();

function specFor(
  vm: ComputeVmRow,
  config: ComputeVmConfig,
  pricingModel = vm.effective_pricing_model,
  volume?: ComputeVolumeRow,
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
    shared_disk_gb: volume?.size_gb,
    shared_disk_type: volume ? "balanced" : undefined,
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
      shared_disk_name: volume?.provider_disk_id,
      shared_disk_id: volume?.provider_disk_id,
      startup_script: volume ? volumeMountScript(volume) : undefined,
    },
  };
}

export function volumeMountScript(volume: ComputeVolumeRow) {
  const device = `/dev/disk/by-id/google-${volume.provider_disk_id}`;
  return `#!/bin/bash
set -euo pipefail
device=${device}
for _ in $(seq 1 60); do
  test -b "$device" && break
  sleep 1
done
test -b "$device"
if ! blkid "$device" >/dev/null 2>&1; then
  mkfs.ext4 -F -m 0 "$device"
fi
mkdir -p /work
uuid=$(blkid -s UUID -o value "$device")
grep -q "UUID=$uuid " /etc/fstab || echo "UUID=$uuid /work ext4 defaults,nofail 0 2" >> /etc/fstab
mountpoint -q /work || mount /work
chown ubuntu:ubuntu /work
chmod 0755 /work

cat >/usr/local/sbin/cocalc-grow-work-filesystem <<'EOF'
#!/bin/bash
set -euo pipefail
device=${device}
test -b "$device" || exit 0
mountpoint -q /work || exit 0
mounted_device=$(findmnt -n -o SOURCE /work)
test "$(readlink -f "$mounted_device")" = "$(readlink -f "$device")" || exit 0
block_bytes=$(blockdev --getsize64 "$device")
block_size=$(dumpe2fs -h "$device" 2>/dev/null | awk -F: '/Block size:/{gsub(/ /, "", $2); print $2}')
block_count=$(dumpe2fs -h "$device" 2>/dev/null | awk -F: '/Block count:/{gsub(/ /, "", $2); print $2}')
test -n "$block_size" -a -n "$block_count" || exit 1
filesystem_bytes=$((block_size * block_count))
if test "$filesystem_bytes" -lt "$block_bytes"; then
  resize2fs "$device"
fi
EOF
chmod 0755 /usr/local/sbin/cocalc-grow-work-filesystem

cat >/etc/systemd/system/cocalc-grow-work-filesystem.service <<'EOF'
[Unit]
Description=Grow the CoCalc /work filesystem to its block device
After=local-fs.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cocalc-grow-work-filesystem
EOF

cat >/etc/systemd/system/cocalc-grow-work-filesystem.timer <<'EOF'
[Unit]
Description=Detect online growth of the CoCalc /work disk

[Timer]
OnBootSec=15s
OnUnitActiveSec=30s
AccuracySec=5s
Unit=cocalc-grow-work-filesystem.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now cocalc-grow-work-filesystem.timer
systemctl start cocalc-grow-work-filesystem.service
`;
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

export async function createProviderComputeVm(
  vm: ComputeVmRow,
  volume?: ComputeVolumeRow,
) {
  const { config, creds } = await context();
  return await provider.createHost(
    specFor(vm, config, undefined, volume),
    creds,
  );
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
  const { config, creds } = await context();
  try {
    const runtime = runtimeFor(vm);
    const [status, instance] = await Promise.all([
      provider.getStatus(runtime, creds),
      provider.getInstance(runtime, creds),
    ]);
    if (instance) assertComputeVmSecurity(instance, config);
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

export async function ensureProviderComputeVolume(volume: ComputeVolumeRow) {
  const { creds } = await context();
  return await provider.ensurePersistentDisk(
    {
      name: volume.provider_disk_id,
      zone: volume.zone,
      size_gb: volume.desired_size_gb,
      disk_type: "balanced",
      labels: {
        "managed-by": "cocalc-compute",
        "logical-volume": volume.id.replaceAll("-", "").slice(0, 40),
        owner: volume.owner_account_id.replaceAll("-", "").slice(0, 40),
      },
    },
    creds,
  );
}

export async function inspectProviderComputeVolume(volume: ComputeVolumeRow) {
  const { creds } = await context();
  return await provider.inspectPersistentDisk(
    { name: volume.provider_disk_id, zone: volume.zone },
    creds,
  );
}

export async function resizeProviderComputeVolume(volume: ComputeVolumeRow) {
  const { creds } = await context();
  await provider.resizePersistentDisk(
    {
      name: volume.provider_disk_id,
      zone: volume.zone,
      size_gb: volume.desired_size_gb,
    },
    creds,
  );
}

export async function deleteProviderComputeVolume(volume: ComputeVolumeRow) {
  const { creds } = await context();
  await provider.deletePersistentDisk(
    { name: volume.provider_disk_id, zone: volume.zone },
    creds,
  );
}
