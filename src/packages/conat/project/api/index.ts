import { type System, system } from "./system";
import { type Editor, editor } from "./editor";
import { type Jupyter, jupyter } from "./jupyter";
import { type Apps, apps } from "./apps";
import { handleErrorMessage } from "@cocalc/conat/util";
export { projectApiClient } from "./project-client";

/*
 * ARCHITECTURE CONSTRAINT:
 *
 * This API is implemented inside the optional project compute container.
 * Calling it may require that container to start. Do not add passive file,
 * document, editor, listing, preview, or serialization operations here.
 * Those must remain available while compute is stopped and therefore belong
 * on an authenticated project-host data-plane service (usually the project
 * filesystem service). Project RPCs are for operations that intrinsically
 * require code execution or an already-running project backend.
 */
export interface ProjectApi {
  system: System;
  editor: Editor;
  jupyter: Jupyter;
  apps: Apps;
  isReady: () => Promise<boolean>;
  waitUntilReady: (opts?: { timeout?: number }) => Promise<void>;
}

const ProjectApiStructure = {
  system,
  editor,
  jupyter,
  apps,
} as const;

export function initProjectApi({
  callProjectApi,
  isReady,
  waitUntilReady,
}): ProjectApi {
  const projectApi: any = {};
  for (const group in ProjectApiStructure) {
    if (projectApi[group] == null) {
      projectApi[group] = {};
    }
    for (const functionName in ProjectApiStructure[group]) {
      projectApi[group][functionName] = async (...args) =>
        handleErrorMessage(
          await callProjectApi({
            name: `${group}.${functionName}`,
            args,
          }),
        );
    }
  }
  projectApi.isReady = isReady;
  projectApi.waitUntilReady = waitUntilReady;
  return projectApi as ProjectApi;
}
