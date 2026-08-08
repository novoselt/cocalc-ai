/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details.
 */

const callHubMock = jest.fn();
const masterClient = { kind: "master-client" };

jest.mock("@cocalc/conat/hub/call-hub", () => ({
  __esModule: true,
  default: (...args: any[]) => callHubMock(...args),
}));
jest.mock("../master-status", () => ({
  getMasterConatClient: () => masterClient,
}));
jest.mock("@cocalc/lite/hub/api", () => ({
  hubApi: { compute: {} as any },
}));

import { hubApi } from "@cocalc/lite/hub/api";
import { wireComputeApi } from "./compute";

describe("project-host compute hub bridge", () => {
  beforeEach(() => {
    callHubMock.mockReset();
    callHubMock.mockResolvedValue({ id: "vm-1" });
    process.env.PROJECT_HOST_ID = "00000000-1000-4000-8000-000000000004";
    wireComputeApi();
  });

  it("forwards project SSH authorization under the trusted host identity", async () => {
    const opts = {
      project_id: "00000000-1000-4000-8000-000000000002",
      id_or_name: "compute-vm",
      ssh_public_key: "ssh-ed25519 AAAATEST project",
      idempotency_key: "authorize-1",
    };
    await expect(hubApi.compute.authorizeProjectSshKey(opts)).resolves.toEqual({
      id: "vm-1",
    });
    expect(callHubMock).toHaveBeenCalledWith({
      client: masterClient,
      host_id: process.env.PROJECT_HOST_ID,
      name: "compute.authorizeProjectSshKeyFromHost",
      args: [opts],
    });
  });

  it.each([
    "listProjectVms",
    "getProjectVm",
    "listProjectVolumes",
    "getProjectVolume",
  ])(
    "forwards project-scoped %s reads under the trusted host identity",
    async (name) => {
      const opts = {
        project_id: "00000000-1000-4000-8000-000000000002",
        id_or_name: "compute-vm",
      };
      await expect((hubApi.compute as any)[name](opts)).resolves.toEqual({
        id: "vm-1",
      });
      expect(callHubMock).toHaveBeenCalledWith({
        client: masterClient,
        host_id: process.env.PROJECT_HOST_ID,
        name: `compute.${name}`,
        args: [opts],
      });
    },
  );
});
