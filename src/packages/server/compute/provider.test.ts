/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { volumeMountScript } from "./provider";
import type { ComputeVolumeRow } from "./types";

describe("volumeMountScript", () => {
  it("installs an idempotent online ext4 growth timer", () => {
    const script = volumeMountScript({
      provider_disk_id: "cocalc-vol-test",
    } as ComputeVolumeRow);

    expect(script).toContain("device=/dev/disk/by-id/google-cocalc-vol-test");
    expect(script).toContain("cocalc-grow-work-filesystem.timer");
    expect(script).toContain("OnUnitActiveSec=30s");
    expect(script).toContain('readlink -f "$mounted_device"');
    expect(script).toContain("filesystem_bytes=$((block_size * block_count))");
    expect(script).toContain('resize2fs "$device"');
    expect(script).toContain(
      "systemctl enable --now cocalc-grow-work-filesystem.timer",
    );
  });
});
