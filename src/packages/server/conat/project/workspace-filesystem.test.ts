/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const localPathFileserver = jest.fn(async (opts) => ({
  ...opts,
  close: jest.fn(),
}));
const importJupyterIpynb = jest.fn(async (opts) => ({
  ipynb: opts.ipynb,
}));
const saveJupyterIpynb = jest.fn(async (opts) => ({
  ipynb: opts.ipynb,
  bytes: 10,
  converted: false,
}));

jest.mock("@cocalc/backend/conat/files/local-path", () => ({
  localPathFileserver: (...args: any[]) => localPathFileserver(...args),
}));

jest.mock("@cocalc/jupyter/ipynb/filesystem", () => ({
  importJupyterIpynb: (...args: any[]) => importJupyterIpynb(...args),
  saveJupyterIpynb: (...args: any[]) => saveJupyterIpynb(...args),
}));

jest.mock("../api/db", () => ({
  getBlob: jest.fn(),
  saveBlob: jest.fn(),
}));

import {
  createWorkspaceJupyterFilesystemHandlers,
  startWorkspaceFilesystem,
} from "./workspace-filesystem";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("workspace filesystem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts one sandboxed multi-project service at the workspace root", async () => {
    const client = {} as any;
    await startWorkspaceFilesystem({
      client,
      path: "/tmp/workspace-projects",
    });

    expect(localPathFileserver).toHaveBeenCalledWith(
      expect.objectContaining({
        client,
        path: "/tmp/workspace-projects",
        unsafeMode: false,
        homeAliases: ["/home/user"],
        jupyter: expect.any(Object),
      }),
    );
    expect(localPathFileserver.mock.calls[0][0].project_id).toBeUndefined();
  });

  it("derives notebook ownership from the filesystem subject", async () => {
    const handlers = createWorkspaceJupyterFilesystemHandlers();
    const ipynb = { cells: [] };
    await handlers.importIpynb({
      subject: `fs.project-${PROJECT_ID}`,
      ipynb,
    });

    expect(importJupyterIpynb).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        ipynb,
      }),
    );
  });

  it("rejects malformed filesystem subjects", async () => {
    const handlers = createWorkspaceJupyterFilesystemHandlers();
    await expect(
      handlers.importIpynb({
        subject: "fs.not-a-project",
        ipynb: { cells: [] },
      }),
    ).rejects.toThrow("invalid workspace filesystem subject");
  });
});
