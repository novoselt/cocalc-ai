/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const callHubMock = jest.fn();
const getMasterConatClientMock = jest.fn(() => ({ id: "master-client" }));

jest.mock("@cocalc/conat/hub/call-hub", () => ({
  __esModule: true,
  default: (...args: any[]) => callHubMock(...args),
}));

jest.mock("../master-status", () => ({
  getMasterConatClient: () => getMasterConatClientMock(),
}));

jest.mock("../sqlite/hosts", () => ({
  getLocalHostId: () => "00000000-3000-4000-8000-000000000789",
}));

describe("wireDbApi", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("forwards project blob reads to the master hub with project identity", async () => {
    callHubMock.mockResolvedValue({ blob: "aW1hZ2U=" });
    const { hubApi } = await import("@cocalc/lite/hub/api");
    const { wireDbApi } = await import("./db");
    const project_id = "00000000-1000-4000-8000-000000000123";
    const uuid = "00000000-2000-4000-8000-000000000456";

    wireDbApi();

    await expect(hubApi.db.getBlob({ project_id, uuid })).resolves.toEqual({
      blob: "aW1hZ2U=",
    });
    expect(callHubMock).toHaveBeenCalledWith({
      client: { id: "master-client" },
      host_id: "00000000-3000-4000-8000-000000000789",
      name: "db.getBlob",
      args: [{ project_id, uuid }],
      timeout: 60_000,
    });
  });

  it("forwards project blob writes to the master hub with project identity", async () => {
    callHubMock.mockResolvedValue({
      uuid: "00000000-2000-4000-8000-000000000456",
    });
    const { hubApi } = await import("@cocalc/lite/hub/api");
    const { wireDbApi } = await import("./db");
    const opts = {
      project_id: "00000000-1000-4000-8000-000000000123",
      uuid: "00000000-2000-4000-8000-000000000456",
      blob: "aW1hZ2U=",
    };

    wireDbApi();

    await expect(hubApi.db.saveBlob(opts)).resolves.toEqual({
      uuid: opts.uuid,
    });
    expect(callHubMock).toHaveBeenCalledWith({
      client: { id: "master-client" },
      host_id: "00000000-3000-4000-8000-000000000789",
      name: "db.saveBlob",
      args: [opts],
      timeout: 60_000,
    });
  });
});
