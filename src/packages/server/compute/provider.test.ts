/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  gcpInstanceIdForEgress,
  isProviderNotFound,
  managedVmBootstrapScript,
  mergeManagedNebiusSpec,
  providerInstanceIdIsProvisional,
} from "./provider";
import type { ComputeVmRow, ComputeVolumeRow } from "./types";

describe("managedVmBootstrapScript", () => {
  const vm = {
    provider: "gcp",
    ssh_public_key: "ssh-ed25519 AAAAOWNER owner",
    bootstrap_revision: 2,
    metadata: {
      ssh_public_keys: ["ssh-ed25519 AAAACONTROLLER controller"],
    },
  } as ComputeVmRow;

  it("creates only the v2 user and readiness contract without a volume", () => {
    const script = managedVmBootstrapScript(vm);

    expect(script).toContain("useradd --uid 1001 --gid user --create-home");
    expect(script).toContain('test "$(id -u user)" = 1001');
    expect(script).toContain('test "$(id -gn user)" = user');
    expect(script).toContain("user_gid=$(id -g user)");
    expect(script).toContain("userdel --remove ubuntu");
    expect(script).toContain("user ALL=(ALL) NOPASSWD:ALL");
    expect(script).toContain("/home/user/.ssh/authorized_keys");
    expect(script).toContain("ssh-ed25519 AAAAOWNER owner");
    expect(script).toContain("ssh-ed25519 AAAACONTROLLER controller");
    expect(script).toContain("/run/cocalc-managed-vm/bootstrap-ready");
    expect(script).toContain("'2'");
    expect(script).not.toContain("/work");
  });

  it("mounts persistent home and installs an idempotent ext4 growth timer", () => {
    const script = managedVmBootstrapScript(vm, {
      provider_disk_id: "cocalc-vol-test",
    } as ComputeVolumeRow);

    expect(script).toContain("device=/dev/disk/by-id/google-cocalc-vol-test");
    expect(script).toContain("UUID=$uuid /home/user ext4");
    expect(script).toContain("rmdir /home/user/lost+found 2>/dev/null || true");
    expect(script).toContain(
      'chown -R "$user_uid:$user_gid" /mnt/cocalc-managed-home',
    );
    expect(script).toContain("cocalc-grow-home-filesystem.timer");
    expect(script).toContain("OnUnitActiveSec=30s");
    expect(script).toContain('readlink -f "$mounted_device"');
    expect(script).toContain("filesystem_bytes=$((block_size * block_count))");
    expect(script).toContain('resize2fs "$device"');
    expect(script).toContain(
      "systemctl enable --now cocalc-grow-home-filesystem.timer",
    );
    expect(script).not.toContain("/work");
  });
});

describe("mergeManagedNebiusSpec", () => {
  it("preserves the CUDA image selected by shared host provisioning", () => {
    const result = mergeManagedNebiusSpec(
      {
        name: "base",
        region: "us-central1",
        cpu: 16,
        ram_gb: 200,
        disk_gb: 0,
        metadata: {
          source_image_family: "ubuntu24.04-cuda13.0",
          platform: "gpu-h200-sxm",
        },
      },
      {
        name: "managed",
        region: "us-central1",
        cpu: 16,
        ram_gb: 200,
        disk_gb: 0,
        metadata: { public_address_id: "address-1" },
      },
      "security-group-1",
    );

    expect(result.metadata).toEqual(
      expect.objectContaining({
        source_image_family: "ubuntu24.04-cuda13.0",
        platform: "gpu-h200-sxm",
        public_address_id: "address-1",
        security_group_ids: ["security-group-1"],
      }),
    );
  });
});

describe("isProviderNotFound", () => {
  it("recognizes the JSON-shaped Google API error returned for an absent VM", () => {
    expect(
      isProviderNotFound(
        new Error(`{
  "error": {
    "code": 404,
    "message": "The resource 'projects/test/zones/test/instances/missing' was not found"
  }
}`),
      ),
    ).toBe(true);
  });
});

describe("providerInstanceIdIsProvisional", () => {
  it("recognizes a Nebius provider name before an instance is created", () => {
    expect(
      providerInstanceIdIsProvisional({
        provider: "nebius",
        provider_instance_id: "cocalc-vm-provisional-name",
        metadata: { provider_instance_name: "cocalc-vm-provisional-name" },
      }),
    ).toBe(true);
  });

  it("rejects actual Nebius IDs and GCP instance names", () => {
    expect(
      providerInstanceIdIsProvisional({
        provider: "nebius",
        provider_instance_id: "computeinstance-e00actual",
        metadata: { provider_instance_name: "cocalc-vm-name" },
      }),
    ).toBe(false);
    expect(
      providerInstanceIdIsProvisional({
        provider: "gcp",
        provider_instance_id: "cocalc-vm-name",
        metadata: { provider_instance_name: "cocalc-vm-name" },
      }),
    ).toBe(false);
    expect(
      providerInstanceIdIsProvisional({
        provider: "nebius",
        provider_instance_id: undefined,
        metadata: {},
      }),
    ).toBe(false);
  });
});

describe("gcpInstanceIdForEgress", () => {
  it("returns the observed numeric provider identity", () => {
    expect(
      gcpInstanceIdForEgress({
        id: "vm-1",
        metadata: { runtime: { gcp_instance_id: "1234567890" } },
      } as ComputeVmRow),
    ).toBe("1234567890");
  });

  it("treats a deleted VM that never became ready as zero egress", () => {
    expect(
      gcpInstanceIdForEgress({
        id: "vm-1",
        deleted_at: new Date(),
        ready_at: null,
      } as ComputeVmRow),
    ).toBeUndefined();
  });

  it("rejects a missing identity for active or formerly ready VMs", () => {
    expect(() =>
      gcpInstanceIdForEgress({ id: "vm-active" } as ComputeVmRow),
    ).toThrow("no GCP numeric instance id");
    expect(() =>
      gcpInstanceIdForEgress({
        id: "vm-ready",
        ready_at: new Date(),
        deleted_at: new Date(),
      } as ComputeVmRow),
    ).toThrow("no GCP numeric instance id");
  });
});
