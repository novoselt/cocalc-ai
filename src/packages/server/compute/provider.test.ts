/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { managedVmBootstrapScript } from "./provider";
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
    expect(script).toContain('test "$(id -g user)" = 1001');
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
