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
        },
      }),
    ).toBe(
      "cocalc --api https://staging.cocalc.ai vm create --project project-id --zone us-central1-a --machine t2d-standard-16 --ttl=8h --boot-disk-gb=40 --spot --allow-on-demand-fallback --volume build-cache --wait build-vm",
    );
  });

  it("omits TTL when the project budget is the only guardrail", () => {
    expect(
      vmCreateCli({
        api: "https://staging.cocalc.ai",
        project_id: "project-id",
        values: { name: "open-ended", ttl_minutes: null },
      }),
    ).not.toContain("--ttl");
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
});
