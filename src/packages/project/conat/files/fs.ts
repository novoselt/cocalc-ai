/*
Fileserver with all safety off for the project.    This is run inside the project by the project,
so the security is off.
*/

import { localPathFileserver } from "@cocalc/backend/conat/files/local-path";
import {
  getService,
  type FilesystemJupyterHandlers,
} from "@cocalc/conat/files/fs";
import {
  importJupyterIpynb,
  saveJupyterIpynb,
  type JupyterFilesystemBlobStore,
} from "@cocalc/jupyter/ipynb/filesystem";
import { project_id } from "@cocalc/project/data";
import { connectToConat } from "@cocalc/project/conat/connection";
import { hubApi } from "@cocalc/project/conat/hub";

function createJupyterHandlers(
  client: ReturnType<typeof connectToConat>,
): FilesystemJupyterHandlers {
  const hub = hubApi(client);
  const blobStore: JupyterFilesystemBlobStore = {
    async loadBlob({ uuid }) {
      const result = await hub.db.getBlob({ project_id, uuid });
      if (result.blob == null) {
        return;
      }
      return { bytes: Buffer.from(result.blob, "base64") };
    },
    async saveBlob({ bytes, content_id, filename }) {
      const { uuid } = await hub.db.saveBlob({
        project_id,
        uuid: content_id,
        blob: bytes.toString("base64"),
      });
      return {
        uuid,
        url: `/blobs/${encodeURIComponent(filename)}?uuid=${uuid}`,
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

let server: any = undefined;
export async function init() {
  if (server) {
    return;
  }
  const client = connectToConat();
  const service = getService({});
  server = await localPathFileserver({
    client,
    service,
    path: process.env.HOME ?? "/tmp",
    unsafeMode: true,
    project_id,
    jupyter: createJupyterHandlers(client),
  });
}

export function close() {
  server?.close();
  server = undefined;
}
