/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/conat/core/client";
import type { FilesystemJupyterHandlers } from "@cocalc/conat/files/fs";
import {
  importJupyterIpynb,
  saveJupyterIpynb,
  type JupyterFilesystemBlobStore,
} from "@cocalc/jupyter/ipynb/filesystem";
import { getBlobstore } from "./hub/blobs/download";

export function createLiteJupyterFilesystemHandlers({
  client,
  project_id,
}: {
  client: Client;
  project_id: string;
}): FilesystemJupyterHandlers {
  const store = getBlobstore(client);
  const blobStore: JupyterFilesystemBlobStore = {
    async loadBlob({ uuid }) {
      const bytes = await store.get(uuid);
      if (bytes == null) return;
      return { bytes: Buffer.from(bytes) };
    },

    async saveBlob({ bytes, content_id, filename }) {
      await store.set(content_id, bytes);
      return {
        uuid: content_id,
        url: `/blobs/${encodeURIComponent(filename)}?uuid=${content_id}`,
      };
    },
  };

  return {
    async importIpynb({ ipynb }) {
      return await importJupyterIpynb({ project_id, ipynb, blobStore });
    },

    async saveIpynb({ path, ipynb, fs }) {
      return await saveJupyterIpynb({
        project_id,
        path,
        ipynb,
        fs,
        blobStore,
      });
    },
  };
}
