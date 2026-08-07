/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { vmCreateCli, volumeCreateCli } from "./compute-vms-cli";

describe("managed compute CLI equivalents", () => {
  it("includes every visible VM resource setting", () => {
    expect(
      vmCreateCli({
        api: "https://staging.cocalc.ai",
        project_id: "project-id",
        values: {
          name: "build-vm",
          zone: "us-central1-a",
          machine_type: "t2d-standard-16",
          pricing_model: "spot",
          allow_on_demand_fallback: true,
          ttl_minutes: 480,
          boot_disk_gb: 40,
          volume: "build-cache",
          ssh_public_key: "ssh-ed25519 AAAATEST user@example.com",
        },
      }),
    ).toBe(
      "cocalc --api https://staging.cocalc.ai vm create --project project-id --zone us-central1-a --machine t2d-standard-16 --ttl=8h --boot-disk-gb=40 --spot --allow-standard-fallback --volume build-cache --ssh-public-key-value 'ssh-ed25519 AAAATEST user@example.com' --wait build-vm",
    );
  });

  it("omits an optional TTL", () => {
    expect(
      vmCreateCli({
        api: "https://staging.cocalc.ai",
        project_id: "project-id",
        values: { name: "open-ended", ttl_minutes: null },
      }),
    ).not.toContain("--ttl");
  });

  it("makes a deliberately keyless browser configuration explicit", () => {
    expect(
      vmCreateCli({
        api: "https://staging.cocalc.ai",
        project_id: "project-id",
        values: { name: "keyless", ssh_public_key: "" },
      }),
    ).toContain("--no-ssh-key");
  });

  it("shows the project-scoped persistent volume command", () => {
    expect(
      volumeCreateCli({
        api: "https://staging.cocalc.ai",
        project_id: "project-id",
        values: { name: "my data", zone: "us-central1-b", size_gb: 80 },
      }),
    ).toBe(
      "cocalc --api https://staging.cocalc.ai vm volume create --project project-id --zone us-central1-b --size-gb=80 --wait 'my data'",
    );
  });

  it("creates and waits for a new /work volume before creating the VM", () => {
    const command = vmCreateCli({
      api: "https://staging.cocalc.ai",
      project_id: "project-id",
      values: {
        name: "compute-vm",
        zone: "us-west1-a",
        machine_type: "e2-standard-2",
        pricing_model: "on_demand",
        allow_on_demand_fallback: false,
        boot_disk_gb: 20,
        create_volume: true,
        new_volume_name: "compute-vm-work",
        new_volume_size_gb: 100,
      },
    });
    expect(command).toContain(
      "vm volume create --project project-id --zone us-west1-a --size-gb=100 --wait compute-vm-work",
    );
    expect(command).toContain(
      "&& cocalc --api https://staging.cocalc.ai vm create",
    );
    expect(command).toContain("--volume compute-vm-work");
  });
});
