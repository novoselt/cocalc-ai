/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { uuidsha1 } from "@cocalc/backend/misc_node";
import { createLiteJupyterFilesystemHandlers } from "./jupyter-ipynb";

const project_id = "11111111-1111-4111-8111-111111111111";
const subject = `fs.project-${project_id}`;
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

describe("Lite Jupyter ipynb conversion", () => {
  it("externalizes native attachments and writes portable notebooks", async () => {
    const blobs = new Map<string, Buffer>();
    const store = {
      get: jest.fn(async (uuid: string) => blobs.get(uuid)),
      set: jest.fn(async (uuid: string, bytes: Buffer) => {
        blobs.set(uuid, Buffer.from(bytes));
      }),
    };
    const client = {
      sync: { akv: jest.fn(() => store) },
    } as any;
    const handlers = createLiteJupyterFilesystemHandlers({
      client,
      project_id,
    });

    const imported: any = await handlers.importIpynb({
      subject,
      ipynb: portableNotebook(),
    });
    expect(store.set).toHaveBeenCalledWith(blobUuid, png);
    expect(imported.ipynb.cells[0].source).toBe(
      `![image](/blobs/image.png?uuid=${blobUuid})`,
    );
    expect(imported.ipynb.cells[0].attachments).toBeUndefined();

    const writeFile = jest.fn(async () => {});
    const fs = {
      stat: jest.fn(async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }),
      readFile: jest.fn(),
      writeFile,
    } as any;
    const saved = await handlers.saveIpynb({
      subject,
      path: "lesson.ipynb",
      ipynb: imported.ipynb,
      fs,
    });

    const disk = JSON.parse(writeFile.mock.calls[0][1]);
    expect(disk.cells[0].source).toBe("![image](attachment:image.png)");
    expect(disk.cells[0].attachments["image.png"]["image/png"]).toBe(
      png.toString("base64"),
    );
    expect(saved.ipynb).toEqual(imported.ipynb);
  });
});
