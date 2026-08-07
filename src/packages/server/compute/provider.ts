/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { GcpProvider, type HostRuntime, type HostSpec } from "@cocalc/cloud";
import { GoogleAuth } from "google-auth-library";
import {
  DisksClient,
  FirewallsClient,
  SubnetworksClient,
} from "@google-cloud/compute";
import { getProviderContext } from "@cocalc/server/cloud/provider-context";
import {
  gcpCpuCountForMachineType,
  gcpMemoryGiBForMachineType,
} from "@cocalc/util/project-host-pricing";
import { getComputeVmConfig, type ComputeVmConfig } from "./config";
import type { ComputeVmRow, ComputeVolumeRow } from "./types";
import { assertComputeVmSecurity } from "./security";

const provider = new GcpProvider();
let networkSecurityCheck: { key: string; checked_at: number } | undefined;
const REQUIRED_NON_PUBLIC_IPV4_RANGES = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "199.36.153.4/30",
  "199.36.153.8/30",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

function includesRanges(rule: any, expected: string[]): boolean {
  const actual = new Set((rule.destinationRanges ?? []).map(String));
  return expected.every((range) => actual.has(range));
}

function allowsProtocol(rule: any, protocol: string, port?: string): boolean {
  return (rule.allowed ?? []).some((entry: any) => {
    if (`${entry.IPProtocol ?? ""}` !== protocol) return false;
    return port == null || (entry.ports ?? []).map(String).includes(port);
  });
}

function deniesAll(rule: any): boolean {
  return (rule.denied ?? []).some(
    (entry: any) => `${entry.IPProtocol ?? ""}` === "all",
  );
}

async function assertProviderComputeNetworkSecurity(config: ComputeVmConfig) {
  if (config.environment !== "production") return;
  if (
    !config.gcp_service_account_json ||
    !config.gcp_project_id ||
    !config.gcp_subnetwork
  ) {
    throw new Error("managed compute production network is not configured");
  }
  const key = `${config.gcp_project_id}:${config.gcp_subnetwork}:${config.gcp_network_tag}`;
  if (
    networkSecurityCheck?.key === key &&
    Date.now() - networkSecurityCheck.checked_at < 5 * 60_000
  ) {
    return;
  }
  const subnetMatch = config.gcp_subnetwork.match(
    /^projects\/[^/]+\/regions\/([^/]+)\/subnetworks\/(.+)$/,
  );
  if (!subnetMatch)
    throw new Error("managed compute subnetwork URI is invalid");
  const [, subnetRegion, subnetName] = subnetMatch;
  const subnetClient = new SubnetworksClient({
    credentials: JSON.parse(config.gcp_service_account_json),
  });
  const [subnet] = await subnetClient.get({
    project: config.gcp_project_id,
    region: subnetRegion,
    subnetwork: subnetName,
  });
  if (
    !subnet.network ||
    (subnet.enableFlowLogs !== true &&
      (subnet as any).logConfig?.enable !== true)
  ) {
    throw new Error(
      "managed compute subnetwork must have VPC Flow Logs enabled",
    );
  }
  const client = new FirewallsClient({
    credentials: JSON.parse(config.gcp_service_account_json),
  });
  const rules = new Map<string, any>();
  for await (const rule of client.listAsync({
    project: config.gcp_project_id,
  })) {
    if (rule.name) rules.set(rule.name, rule);
  }
  const required = [
    "cocalc-compute-ssh",
    "cocalc-compute-metadata",
    "cocalc-compute-deny-private",
    "cocalc-compute-public-egress",
  ];
  for (const name of required) {
    const rule = rules.get(name);
    if (!rule || rule.disabled === true) {
      throw new Error(
        `managed compute firewall rule '${name}' is missing or disabled`,
      );
    }
    if (!(rule.targetTags ?? []).includes(config.gcp_network_tag)) {
      throw new Error(
        `managed compute firewall rule '${name}' has the wrong target tag`,
      );
    }
    if (`${rule.network ?? ""}` !== `${subnet.network}`) {
      throw new Error(
        `managed compute firewall rule '${name}' is on the wrong network`,
      );
    }
  }
  const deny = rules.get("cocalc-compute-deny-private");
  const metadata = rules.get("cocalc-compute-metadata");
  const publicEgress = rules.get("cocalc-compute-public-egress");
  if (
    deny.direction !== "EGRESS" ||
    !deniesAll(deny) ||
    !includesRanges(deny, REQUIRED_NON_PUBLIC_IPV4_RANGES)
  ) {
    throw new Error("managed compute private-egress deny rule is invalid");
  }
  if (
    metadata.direction !== "EGRESS" ||
    !allowsProtocol(metadata, "all") ||
    !includesRanges(metadata, ["169.254.169.254/32"])
  ) {
    throw new Error("managed compute metadata egress rule is invalid");
  }
  if (
    publicEgress.direction !== "EGRESS" ||
    !allowsProtocol(publicEgress, "all") ||
    !includesRanges(publicEgress, ["0.0.0.0/0"])
  ) {
    throw new Error("managed compute public-egress rule is invalid");
  }
  if (
    Number(metadata.priority) >= Number(deny.priority) ||
    Number(deny.priority) >= Number(publicEgress.priority)
  ) {
    throw new Error("managed compute egress firewall priorities are invalid");
  }
  const ssh = rules.get("cocalc-compute-ssh");
  if (ssh.direction !== "INGRESS" || !allowsProtocol(ssh, "tcp", "22")) {
    throw new Error("managed compute SSH ingress rule is invalid");
  }
  networkSecurityCheck = { key, checked_at: Date.now() };
}

function specFor(
  vm: ComputeVmRow,
  config: ComputeVmConfig,
  pricingModel = vm.effective_pricing_model,
  volume?: ComputeVolumeRow,
): HostSpec {
  const cpu =
    Number(vm.metadata?.machine?.cpu) ||
    gcpCpuCountForMachineType(vm.machine_type);
  const ramGb =
    Number(vm.metadata?.machine?.ram_gb) ||
    gcpMemoryGiBForMachineType(vm.machine_type);
  if (!cpu || !ramGb) {
    throw new Error(`missing machine dimensions for '${vm.machine_type}'`);
  }
  return {
    name: vm.provider_instance_id,
    region: vm.region,
    zone: vm.zone,
    pricing_model: pricingModel,
    cpu,
    ram_gb: ramGb,
    disk_gb: 0,
    disk_type: "balanced",
    shared_disk_gb: volume?.size_gb,
    shared_disk_type: volume ? "balanced" : undefined,
    tags: [config.gcp_network_tag],
    metadata: {
      machine_type: vm.machine_type,
      storage_mode: "boot-only",
      boot_disk_gb: vm.boot_disk_gb,
      boot_disk_name: vm.boot_disk_id,
      persistent_boot_disk: true,
      source_image_project: "ubuntu-os-cloud",
      source_image_family:
        vm.architecture === "arm64"
          ? "ubuntu-2404-lts-arm64"
          : "ubuntu-2404-lts-amd64",
      ssh_user: vm.ssh_user,
      ssh_public_key: vm.ssh_public_key,
      ssh_public_keys: vm.metadata?.ssh_public_keys,
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
    private_ip: vm.metadata?.runtime?.private_ip,
    internal_hostname: vm.metadata?.runtime?.internal_hostname,
    ssh_user: vm.ssh_user,
    zone: vm.zone,
    metadata: {
      ...(vm.metadata?.runtime ?? {}),
      boot_disk_name: vm.boot_disk_id,
      persistent_boot_disk: true,
      machine_type: vm.machine_type,
      ssh_public_key: vm.ssh_public_key,
      ssh_public_keys: vm.metadata?.ssh_public_keys,
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

export async function getProviderComputePublicEgressBytes(opts: {
  vm: ComputeVmRow;
  start: Date;
  end: Date;
}): Promise<number> {
  const config = await getComputeVmConfig();
  const instanceId =
    `${opts.vm.metadata?.runtime?.gcp_instance_id ?? ""}`.trim();
  if (!instanceId) {
    throw new Error(
      `compute VM '${opts.vm.id}' has no GCP numeric instance id`,
    );
  }
  if (!config.gcp_service_account_json || !config.gcp_project_id) {
    throw new Error(
      "managed compute egress metering credentials are not configured",
    );
  }
  const auth = new GoogleAuth({
    credentials: JSON.parse(config.gcp_service_account_json),
    scopes: ["https://www.googleapis.com/auth/monitoring.read"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const headers = { Authorization: `Bearer ${token.token ?? token}` };
  let pageToken = "";
  let bytes = 0;
  do {
    const url = new URL(
      `https://monitoring.googleapis.com/v3/projects/${config.gcp_project_id}/timeSeries`,
    );
    url.searchParams.set(
      "filter",
      [
        'metric.type="networking.googleapis.com/vm_flow/egress_bytes_count"',
        `resource.labels.instance_id="${instanceId}"`,
        'metric.labels.remote_location_type="EXTERNAL"',
      ].join(" AND "),
    );
    url.searchParams.set("interval.startTime", opts.start.toISOString());
    url.searchParams.set("interval.endTime", opts.end.toISOString());
    url.searchParams.set("view", "FULL");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `failed to query managed compute public egress: HTTP ${response.status} ${await response.text()}`,
      );
    }
    const payload: any = await response.json();
    for (const series of payload.timeSeries ?? []) {
      for (const point of series.points ?? []) {
        const value = Number(
          point?.value?.int64Value ?? point?.value?.doubleValue ?? 0,
        );
        if (Number.isFinite(value) && value > 0) bytes += value;
      }
    }
    pageToken = `${payload.nextPageToken ?? ""}`;
  } while (pageToken);
  return Math.floor(bytes);
}

export async function listProviderComputeInventory() {
  const { config, creds } = await context();
  const instances = await provider.listInstances(creds, {
    namePrefix: "cocalc-vm-",
  });
  const disks: Array<{ name: string; zone?: string }> = [];
  let disks_observed = false;
  if (config.gcp_service_account_json && config.gcp_project_id) {
    const client = new DisksClient({
      credentials: JSON.parse(config.gcp_service_account_json),
    });
    for await (const [zonePath, scoped] of client.aggregatedListAsync({
      project: config.gcp_project_id,
    })) {
      const zone = `${zonePath ?? ""}`.split("/").pop();
      for (const disk of scoped.disks ?? []) {
        if (
          disk.name?.startsWith("cocalc-vm-") ||
          disk.name?.startsWith("cocalc-vol-")
        ) {
          disks.push({ name: disk.name, zone });
        }
      }
    }
    disks_observed = true;
  }
  return { instances, disks, disks_observed };
}

export async function createProviderComputeVm(
  vm: ComputeVmRow,
  volume?: ComputeVolumeRow,
) {
  const { config, creds } = await context();
  await assertProviderComputeNetworkSecurity(config);
  return await provider.createHost(
    specFor(vm, config, undefined, volume),
    creds,
  );
}

export async function startProviderComputeVm(vm: ComputeVmRow) {
  const { creds } = await context();
  await provider.startHost(runtimeFor(vm), creds);
}

export async function ensureProviderComputeSshAccess(vm: ComputeVmRow) {
  const { creds } = await context();
  if (!provider.ensureSshAccess) {
    throw new Error("managed compute provider cannot update SSH access");
  }
  await provider.ensureSshAccess(runtimeFor(vm), creds);
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
