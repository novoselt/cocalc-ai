/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export {};

let assertLocalProjectCollaboratorMock: jest.Mock;
let getProjectRootfsStatesMock: jest.Mock;
let setProjectRootfsImageWithRollbackMock: jest.Mock;

jest.mock("@cocalc/server/bay-config", () => ({
  __esModule: true,
  getConfiguredBayId: jest.fn(() => "bay-2"),
}));

jest.mock("@cocalc/server/inter-bay/directory", () => ({
  __esModule: true,
  resolveProjectBayDirect: jest.fn(async () => ({
    bay_id: "bay-2",
    epoch: 8,
  })),
}));

jest.mock("@cocalc/server/conat/project-local-access", () => ({
  __esModule: true,
  assertLocalProjectCollaborator: (...args: any[]) =>
    assertLocalProjectCollaboratorMock(...args),
}));

jest.mock("@cocalc/server/projects/rootfs-state", () => ({
  __esModule: true,
  getProjectRootfsStates: (...args: any[]) =>
    getProjectRootfsStatesMock(...args),
  setProjectRootfsImageWithRollback: (...args: any[]) =>
    setProjectRootfsImageWithRollbackMock(...args),
}));

describe("inter-bay project RootFS control", () => {
  beforeEach(() => {
    assertLocalProjectCollaboratorMock = jest.fn(async () => undefined);
    getProjectRootfsStatesMock = jest.fn(async () => [
      { project_id: "project-1", state_role: "current", image: "rootfs/old" },
    ]);
    setProjectRootfsImageWithRollbackMock = jest.fn(async () => [
      { project_id: "project-1", state_role: "current", image: "rootfs/new" },
    ]);
  });

  it("rechecks local access before reading authoritative RootFS state", async () => {
    const { handleProjectControlGetRootfsStates } =
      await import("./project-control");

    await handleProjectControlGetRootfsStates({
      project_id: "project-1",
      account_id: "account-1",
      epoch: 8,
    });

    expect(assertLocalProjectCollaboratorMock).toHaveBeenCalledWith({
      project_id: "project-1",
      account_id: "account-1",
    });
    expect(getProjectRootfsStatesMock).toHaveBeenCalledWith({
      project_id: "project-1",
    });
  });

  it("rechecks local access before writing authoritative RootFS state", async () => {
    const { handleProjectControlSetRootfsImage } =
      await import("./project-control");

    await handleProjectControlSetRootfsImage({
      project_id: "project-1",
      account_id: "account-1",
      image: "rootfs/new",
      image_id: "image-1",
      epoch: 8,
    });

    expect(assertLocalProjectCollaboratorMock).toHaveBeenCalledWith({
      project_id: "project-1",
      account_id: "account-1",
    });
    expect(setProjectRootfsImageWithRollbackMock).toHaveBeenCalledWith({
      project_id: "project-1",
      image: "rootfs/new",
      image_id: "image-1",
      set_by_account_id: "account-1",
    });
  });

  it("does not write when destination-bay collaborator access is denied", async () => {
    assertLocalProjectCollaboratorMock.mockRejectedValue(
      new Error("project collaborator access required"),
    );
    const { handleProjectControlSetRootfsImage } =
      await import("./project-control");

    await expect(
      handleProjectControlSetRootfsImage({
        project_id: "project-1",
        account_id: "account-1",
        image: "rootfs/new",
        epoch: 8,
      }),
    ).rejects.toThrow("project collaborator access required");

    expect(setProjectRootfsImageWithRollbackMock).not.toHaveBeenCalled();
  });
});
