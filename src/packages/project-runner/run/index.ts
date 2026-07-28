/*
Project run server.

DEV -- see packages/server/conat/project/run.ts

*/

import { type Client as ConatClient } from "@cocalc/conat/core/client";
import { conat } from "@cocalc/backend/conat";
import { server as projectRunnerServer } from "@cocalc/conat/project/runner/run";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import { init as initFilesystem, localPath, sshServers } from "./filesystem";
import getLogger from "@cocalc/backend/logger";
import { initConatClient } from "./conat-client";
import { createProjectRuntimeBackend } from "./runtime-backend";

const logger = getLogger("project-runner:run");

let client: ConatClient | null = null;
export async function init(opts: { id?: string; client?: ConatClient } = {}) {
  logger.debug("init");
  const id = opts.id ?? process.env.PROJECT_RUNNER_NAME;
  if (!id) {
    throw Error("you must set the PROJECT_RUNNER_NAME env variable or the id");
  }
  client = opts.client ?? conat();
  initConatClient(client);
  initFilesystem({ client });
  const backend = await createProjectRuntimeBackend({ client });
  const initialProjects = await backend.init();
  logger.info("starting project runner backend", {
    id,
    backend: backend.name,
    recovered_projects: initialProjects.length,
  });
  const server = await projectRunnerServer({
    id,
    client,
    start: reuseInFlight((opts) => backend.start(opts)),
    stop: reuseInFlight((opts) => backend.stop(opts)),
    status: reuseInFlight((opts) => backend.status(opts)),
    save: reuseInFlight((opts) => backend.save(opts)),
    move: async () => {
      throw new Error(
        `project move is unsupported by the ${backend.name} runtime`,
      );
    },
    localPath,
    sshServers,
    initialProjects,
  });
  return {
    close: async () => {
      server.close();
      await backend.close?.();
    },
  };
}
