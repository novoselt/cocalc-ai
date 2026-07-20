/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { uuidsha1 } from "@cocalc/backend/misc_node";

const mockGetBlob = jest.fn();
const mockSaveBlob = jest.fn();

jest.mock("@cocalc/lite/hub/api", () => ({
  hubApi: { db: { getBlob: mockGetBlob, saveBlob: mockSaveBlob } },
}));

import {
  importJupyterIpynb,
  MAX_JUPYTER_IPYNB_CELLS,
  saveJupyterIpynb,
} from "./jupyter-ipynb";

const project_id = "11111111-1111-4111-8111-111111111111";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const blobUuid = uuidsha1(png);

function portableNotebook() {
  return {
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: "![image](attachment:image.png)",
        attachments: {
          "image.png": { "image/png": png.toString("base64") },
        },
      },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}

describe("project-host Jupyter ipynb conversion", () => {
  beforeEach(() => {
    mockGetBlob.mockReset();
    mockSaveBlob.mockReset();
    mockSaveBlob.mockResolvedValue({ uuid: blobUuid });
    mockGetBlob.mockResolvedValue({ blob: png.toString("base64") });
  });

  it("imports native attachments using the authorized project identity", async () => {
    const { ipynb }: any = await importJupyterIpynb({
      project_id,
      ipynb: portableNotebook(),
    });

    expect(mockSaveBlob).toHaveBeenCalledWith({
      project_id,
      uuid: blobUuid,
      blob: png.toString("base64"),
    });
    expect(ipynb.cells[0].source).toBe(
      `![image](/blobs/image.png?uuid=${blobUuid})`,
    );
    expect(ipynb.cells[0].attachments).toBeUndefined();
  });

  it("writes a portable notebook without a project runtime", async () => {
    const writeFile = jest.fn(async () => {});
    const fs = {
      stat: jest.fn(async () => {
        const err: any = new Error("not found");
        err.code = "ENOENT";
        throw err;
      }),
      readFile: jest.fn(),
      writeFile,
    } as any;
    const live = {
      cells: [
        {
          cell_type: "markdown",
          metadata: {},
          source: `![image](/blobs/image.png?uuid=${blobUuid})`,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };

    const result: any = await saveJupyterIpynb({
      project_id,
      path: "course/lesson.ipynb",
      ipynb: live,
      fs,
    });

    expect(mockGetBlob).toHaveBeenCalledWith({ project_id, uuid: blobUuid });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, raw, saveLast] = writeFile.mock.calls[0];
    const saved = JSON.parse(raw);
    expect(path).toBe("course/lesson.ipynb");
    expect(saveLast).toBe(true);
    expect(saved.cells[0].source).toBe("![image](attachment:image.png)");
    expect(saved.cells[0].attachments["image.png"]["image/png"]).toBe(
      png.toString("base64"),
    );
    expect(result.converted).toBe(false);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("saves unresolved legacy blob URLs unchanged", async () => {
    mockGetBlob.mockResolvedValue({});
    const writeFile = jest.fn(async () => {});
    const fs = {
      stat: jest.fn(async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }),
      readFile: jest.fn(),
      writeFile,
    } as any;
    const legacyUrl = `https://cocalc.com/blobs/paste-image.png?uuid=${blobUuid}`;
    const live = {
      cells: [
        {
          cell_type: "markdown",
          metadata: {},
          source: `![legacy image](${legacyUrl})`,
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    };

    await expect(
      saveJupyterIpynb({
        project_id,
        path: "legacy.ipynb",
        ipynb: live,
        fs,
      }),
    ).resolves.toBeDefined();

    const disk = JSON.parse(writeFile.mock.calls[0][1]);
    expect(disk.cells[0].source).toBe(`![legacy image](${legacyUrl})`);
    expect(disk.cells[0].attachments).toBeUndefined();
    expect(mockGetBlob).toHaveBeenCalledWith({
      project_id,
      uuid: blobUuid,
    });
  });

  it("rejects non-notebook destinations before writing", async () => {
    const writeFile = jest.fn();
    await expect(
      saveJupyterIpynb({
        project_id,
        path: "../../not-a-notebook.txt",
        ipynb: portableNotebook(),
        fs: { writeFile } as any,
      }),
    ).rejects.toMatchObject({ code: "EINVAL" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(mockSaveBlob).not.toHaveBeenCalled();
  });

  it("rejects parent traversal before filesystem or blob access", async () => {
    const writeFile = jest.fn();
    await expect(
      saveJupyterIpynb({
        project_id,
        path: "../../escape.ipynb",
        ipynb: portableNotebook(),
        fs: { writeFile } as any,
      }),
    ).rejects.toMatchObject({ code: "EINVAL" });
    expect(writeFile).not.toHaveBeenCalled();
    expect(mockGetBlob).not.toHaveBeenCalled();
    expect(mockSaveBlob).not.toHaveBeenCalled();
  });

  it("bounds pathological cell counts", async () => {
    const cells = new Array(MAX_JUPYTER_IPYNB_CELLS + 1);
    await expect(
      importJupyterIpynb({ project_id, ipynb: { cells } }),
    ).rejects.toMatchObject({ code: "E2BIG" });
    expect(mockSaveBlob).not.toHaveBeenCalled();
  });
});
