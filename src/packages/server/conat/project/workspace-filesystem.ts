/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { localPathFileserver } from "@cocalc/backend/conat/files/local-path";
import { extractProjectSubject } from "@cocalc/conat/auth/subject-policy";
import type { Client } from "@cocalc/conat/core/client";
import type { FilesystemJupyterHandlers } from "@cocalc/conat/files/fs";
import {
  importJupyterIpynb,
  saveJupyterIpynb,
  type JupyterFilesystemBlobStore,
} from "@cocalc/jupyter/ipynb/filesystem";
import { getBlob, saveBlob } from "../api/db";

function projectIdFromSubject(subject: string): string {
  const project_id = extractProjectSubject(subject);
  if (!project_id) {
    throw new Error(`invalid workspace filesystem subject '${subject}'`);
  }
  return project_id;
}

export function createWorkspaceJupyterFilesystemHandlers(): FilesystemJupyterHandlers {
  const blobStore: JupyterFilesystemBlobStore = {
    async loadBlob({ project_id, uuid }) {
      const result = await getBlob({ project_id, uuid });
      if (result.blob == null) {
        return;
      }
      return { bytes: Buffer.from(result.blob, "base64") };
    },
    async saveBlob({ project_id, bytes, content_id, filename }) {
      const { uuid } = await saveBlob({
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
    async importIpynb({ subject, ipynb }) {
      return await importJupyterIpynb({
        project_id: projectIdFromSubject(subject),
        ipynb,
        blobStore,
      });
    },
    async saveIpynb({ subject, path, ipynb, fs }) {
      return await saveJupyterIpynb({
        project_id: projectIdFromSubject(subject),
        path,
        ipynb,
        fs,
        blobStore,
      });
    },
  };
}

export async function startWorkspaceFilesystem({
  client,
  path = process.env.COCALC_PROJECT_PATH,
}: {
  client: Client;
  path?: string;
}) {
  if (!path) {
    throw new Error(
      "COCALC_PROJECT_PATH must be set before starting the workspace filesystem",
    );
  }
  return await localPathFileserver({
    client,
    path,
    unsafeMode: false,
    homeAliases: ["/home/user"],
    jupyter: createWorkspaceJupyterFilesystemHandlers(),
  });
}
