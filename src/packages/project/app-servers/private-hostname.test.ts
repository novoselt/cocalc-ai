/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const getPolicy = jest.fn();
const inspect = jest.fn();
const list = jest.fn();
const reserve = jest.fn();
const release = jest.fn();

jest.mock("@cocalc/project/conat/hub", () => ({
  hubApi: jest.fn(() => ({
    system: {
      getProjectAppPrivateHostnamePolicy: getPolicy,
      inspectProjectAppPrivateHostname: inspect,
      listProjectAppPrivateHostnames: list,
      reserveProjectAppPrivateHostname: reserve,
      releaseProjectAppPrivateHostname: release,
    },
  })),
}));

jest.mock("@cocalc/project/conat/runtime-client", () => ({
  getProjectConatClient: jest.fn(() => ({})),
}));

describe("private app hostname project API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("forwards policy and list through the project's hub connection", async () => {
    getPolicy.mockResolvedValue({ enabled: true, warnings: [] });
    list.mockResolvedValue([]);
    const { getPrivateHostnamePolicy, listPrivateHostnames } =
      await import("./control");

    await expect(getPrivateHostnamePolicy()).resolves.toEqual({
      enabled: true,
      warnings: [],
    });
    await expect(listPrivateHostnames()).resolves.toEqual([]);
    expect(getPolicy).toHaveBeenCalledWith({
      project_id: expect.any(String),
    });
    expect(list).toHaveBeenCalledWith({
      project_id: expect.any(String),
    });
  });

  it("requires an app spec before inspect or reserve", async () => {
    const { inspectPrivateHostname, reservePrivateHostname } =
      await import("./control");

    await expect(
      inspectPrivateHostname("definitely-missing-app"),
    ).rejects.toThrow();
    await expect(
      reservePrivateHostname("definitely-missing-app"),
    ).rejects.toThrow();
    expect(inspect).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("releases using the current project identity", async () => {
    release.mockResolvedValue({ released: true });
    const { releasePrivateHostname } = await import("./control");

    await expect(releasePrivateHostname("cocalc-dev-main")).resolves.toEqual({
      released: true,
    });
    expect(release).toHaveBeenCalledWith({
      project_id: expect.any(String),
      app_id: "cocalc-dev-main",
    });
  });
});
