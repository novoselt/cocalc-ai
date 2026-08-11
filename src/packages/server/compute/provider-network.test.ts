/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ComputeVmConfig } from "./config";
import { regionalComputeSubnetworks } from "./provider";

const config = {
  gcp_project_id: "compute-test",
  gcp_network: "projects/compute-test/global/networks/cocalc-compute-vm",
} as ComputeVmConfig;

function subnet(region: string, overrides: Record<string, any> = {}) {
  return {
    name: `cocalc-compute-vm-${region}`,
    region: `https://www.googleapis.com/compute/v1/projects/compute-test/regions/${region}`,
    network:
      "https://www.googleapis.com/compute/v1/projects/compute-test/global/networks/cocalc-compute-vm",
    purpose: "PRIVATE",
    enableFlowLogs: true,
    ...overrides,
  };
}

describe("managed compute regional subnet inventory", () => {
  it("maps every valid regional subnet on the configured global VPC", () => {
    expect(
      Object.fromEntries(
        regionalComputeSubnetworks(config, [
          { regionPath: "regions/us-central1", subnet: subnet("us-central1") },
          { regionPath: "regions/us-south1", subnet: subnet("us-south1") },
          {
            regionPath: "regions/europe-west1",
            subnet: subnet("europe-west1", {
              network: "projects/other/global/networks/cocalc-compute-vm",
            }),
          },
        ]),
      ),
    ).toEqual({
      "us-central1":
        "projects/compute-test/regions/us-central1/subnetworks/cocalc-compute-vm-us-central1",
      "us-south1":
        "projects/compute-test/regions/us-south1/subnetworks/cocalc-compute-vm-us-south1",
    });
  });

  it("fails closed when a managed regional subnet lacks flow logs", () => {
    expect(() =>
      regionalComputeSubnetworks(config, [
        {
          regionPath: "regions/us-central1",
          subnet: subnet("us-central1", { enableFlowLogs: false }),
        },
      ]),
    ).toThrow("must have VPC Flow Logs enabled");
  });

  it("rejects an empty or incorrectly named inventory", () => {
    expect(() =>
      regionalComputeSubnetworks(config, [
        {
          regionPath: "regions/us-central1",
          subnet: subnet("us-central1", { name: "default" }),
        },
      ]),
    ).toThrow("has no flow-log-enabled regional subnetworks");
  });
});
