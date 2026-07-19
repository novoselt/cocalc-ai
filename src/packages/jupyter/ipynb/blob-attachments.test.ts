/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { uuidsha1 } from "@cocalc/backend/misc_node";
import {
  BLOB_ATTACHMENT_METADATA_KEY,
  embedCoCalcBlobImages,
  externalizeJupyterAttachments,
} from "./blob-attachments";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const jpeg = Buffer.from([255, 216, 255, 224, 1, 2, 3]);
const pngUuid = uuidsha1(png);

function notebook(source: string | string[], attachments?: object): any {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        id: "markdown-1",
        cell_type: "markdown",
        metadata: {},
        source,
        ...(attachments == null ? {} : { attachments }),
      },
    ],
  };
}

describe("portable Jupyter blob attachments", () => {
  it("embeds a CoCalc blob URL without changing the live notebook", async () => {
    const live = notebook([
      "![diagram](/blobs/diagram.png?uuid=",
      `${pngUuid})\n`,
    ]);
    const loadBlob = jest.fn(async () => ({ bytes: png }));

    const saved = await embedCoCalcBlobImages({ ipynb: live, loadBlob });

    expect(live.cells[0].source.join("")).toContain("/blobs/diagram.png");
    expect(saved.cells[0].source.join("")).toBe(
      "![diagram](attachment:diagram.png)\n",
    );
    expect(saved.cells[0].attachments["diagram.png"]).toEqual({
      "image/png": png.toString("base64"),
    });
    expect(
      saved.cells[0].metadata.cocalc[BLOB_ATTACHMENT_METADATA_KEY],
    ).toMatchObject({
      version: 1,
      entries: {
        "diagram.png": {
          primary_mime: "image/png",
          variants: {
            "image/png": { uuid: pngUuid, content_id: pngUuid },
          },
        },
      },
    });
    expect(loadBlob).toHaveBeenCalledTimes(1);
  });

  it("embeds absolute CoCalc blob URLs and reuses repeated references", async () => {
    const live = notebook(
      `![one](https://cocalc.ai/blobs/diagram.png?uuid=${pngUuid})\n` +
        `<img src="https://cocalc.ai/blobs/diagram.png?uuid=${pngUuid}">`,
    );
    const loadBlob = jest.fn(async () => ({ bytes: png }));

    const saved = await embedCoCalcBlobImages({ ipynb: live, loadBlob });

    expect(saved.cells[0].source).toBe(
      "![one](attachment:diagram.png)\n" + '<img src="attachment:diagram.png">',
    );
    expect(Object.keys(saved.cells[0].attachments)).toEqual(["diagram.png"]);
    expect(loadBlob).toHaveBeenCalledTimes(1);
  });

  it("externalizes all safe MIME variants and reuses them on the next save", async () => {
    const original = notebook("![diagram](attachment:diagram)", {
      diagram: {
        "image/png": png.toString("base64"),
        "image/jpeg": jpeg.toString("base64"),
      },
    });
    const blobs = new Map<string, Buffer>();
    const saveBlob = jest.fn(async ({ bytes, content_id, filename }) => {
      blobs.set(content_id, bytes);
      return {
        uuid: content_id,
        url: `/blobs/${filename}?uuid=${content_id}`,
      };
    });
    const loadBlob = jest.fn(async (uuid: string) => {
      const bytes = blobs.get(uuid);
      return bytes == null ? undefined : { bytes };
    });

    const live = await externalizeJupyterAttachments({
      ipynb: original,
      loadBlob,
      saveBlob,
    });
    expect(live.cells[0].source).toContain("/blobs/diagram?uuid=");
    expect(live.cells[0].attachments).toBeUndefined();
    expect(saveBlob).toHaveBeenCalledTimes(2);

    loadBlob.mockClear();
    const savedAgain = await embedCoCalcBlobImages({
      ipynb: live,
      previousIpynb: {
        ...original,
        cells: [
          {
            ...original.cells[0],
            metadata: live.cells[0].metadata,
          },
        ],
      },
      loadBlob,
    });
    expect(savedAgain.cells[0].attachments.diagram).toEqual(
      original.cells[0].attachments.diagram,
    );
    expect(loadBlob).not.toHaveBeenCalled();
  });

  it("reuses valid metadata handles when reopening a saved notebook", async () => {
    const url = `/blobs/diagram.png?uuid=${pngUuid}`;
    const saved = notebook("![diagram](attachment:diagram.png)", {
      "diagram.png": { "image/png": png.toString("base64") },
    });
    saved.cells[0].metadata.cocalc = {
      [BLOB_ATTACHMENT_METADATA_KEY]: {
        version: 1,
        entries: {
          "diagram.png": {
            primary_mime: "image/png",
            variants: {
              "image/png": {
                uuid: pngUuid,
                url,
                content_id: pngUuid,
              },
            },
          },
        },
      },
    };
    const saveBlob = jest.fn();

    const live = await externalizeJupyterAttachments({
      ipynb: saved,
      loadBlob: async () => ({ bytes: png }),
      saveBlob,
    });

    expect(live.cells[0].source).toBe(`![diagram](${url})`);
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("does not trust a metadata URL that is not a matching CoCalc blob URL", async () => {
    const saved = notebook("![diagram](attachment:diagram.png)", {
      "diagram.png": { "image/png": png.toString("base64") },
    });
    saved.cells[0].metadata.cocalc = {
      [BLOB_ATTACHMENT_METADATA_KEY]: {
        version: 1,
        entries: {
          "diagram.png": {
            primary_mime: "image/png",
            variants: {
              "image/png": {
                uuid: pngUuid,
                url: `https://example.com/blobs/image.png?uuid=${pngUuid}`,
                content_id: pngUuid,
              },
            },
          },
        },
      },
    };
    const saveBlob = jest.fn(async () => ({
      uuid: pngUuid,
      url: `/blobs/diagram.png?uuid=${pngUuid}`,
    }));

    const live = await externalizeJupyterAttachments({
      ipynb: saved,
      loadBlob: async () => ({ bytes: png }),
      saveBlob,
    });

    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(live.cells[0].source).toBe(
      `![diagram](/blobs/diagram.png?uuid=${pngUuid})`,
    );
  });

  it("fails before producing a partial notebook when a blob is missing", async () => {
    const live = notebook(`![lost](/blobs/lost.png?uuid=${pngUuid})`);

    await expect(
      embedCoCalcBlobImages({
        ipynb: live,
        loadBlob: async () => undefined,
      }),
    ).rejects.toThrow(`CoCalc image blob ${pngUuid} is not available`);
    expect(live.cells[0].attachments).toBeUndefined();
  });

  it("blocks unsafe native attachment types instead of publishing them", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const external = notebook("![unsafe](attachment:unsafe.svg)", {
      "unsafe.svg": { "image/svg+xml": svg.toString("base64") },
    });

    await expect(
      externalizeJupyterAttachments({
        ipynb: external,
        loadBlob: async () => undefined,
        saveBlob: jest.fn(),
      }),
    ).rejects.toThrow("unsupported MIME type image/svg+xml");
  });
});
