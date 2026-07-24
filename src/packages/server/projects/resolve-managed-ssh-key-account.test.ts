/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const getAssignedProjectHostInfoMock = jest.fn();
const sshKeysMock = jest.fn();

jest.mock("@cocalc/server/conat/project-host-assignment", () => ({
  getAssignedProjectHostInfo: (...args: any[]) =>
    getAssignedProjectHostInfoMock(...args),
}));

jest.mock("@cocalc/server/projects/get-ssh-keys", () => ({
  __esModule: true,
  default: (...args: any[]) => sshKeysMock(...args),
}));

import resolveManagedProjectSshKeyAccountForHost from "./resolve-managed-ssh-key-account";

describe("resolve managed project SSH key account for a host", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAssignedProjectHostInfoMock.mockResolvedValue({ host_id: "host-1" });
    sshKeysMock.mockResolvedValue({
      "aa:bb:cc": { account_id: "account-1" },
    });
  });

  it("resolves a key for the host assigned to the project", async () => {
    await expect(
      resolveManagedProjectSshKeyAccountForHost({
        host_id: "host-1",
        project_id: "project-1",
        fingerprint: "aa:bb:cc",
      }),
    ).resolves.toEqual({ account_id: "account-1" });

    expect(getAssignedProjectHostInfoMock).toHaveBeenCalledWith("project-1");
    expect(sshKeysMock).toHaveBeenCalledWith("project-1");
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(
      resolveManagedProjectSshKeyAccountForHost({
        project_id: "project-1",
        fingerprint: "aa:bb:cc",
      }),
    ).rejects.toThrow("must be a host");

    expect(getAssignedProjectHostInfoMock).not.toHaveBeenCalled();
    expect(sshKeysMock).not.toHaveBeenCalled();
  });

  it("rejects a host not assigned to the project before reading keys", async () => {
    await expect(
      resolveManagedProjectSshKeyAccountForHost({
        host_id: "host-2",
        project_id: "project-1",
        fingerprint: "aa:bb:cc",
      }),
    ).rejects.toThrow("project is not assigned to this host");

    expect(sshKeysMock).not.toHaveBeenCalled();
  });

  it("returns no account for a key that is no longer authorized", async () => {
    sshKeysMock.mockResolvedValue({});

    await expect(
      resolveManagedProjectSshKeyAccountForHost({
        host_id: "host-1",
        project_id: "project-1",
        fingerprint: "missing",
      }),
    ).resolves.toEqual({});
  });
});
