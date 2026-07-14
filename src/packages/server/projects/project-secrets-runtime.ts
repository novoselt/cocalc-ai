/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type { ProjectSecretsRuntimeRefreshResult } from "@cocalc/util/project-secrets";
import { getAssignedProjectHostInfo } from "@cocalc/server/conat/project-host-assignment";
import { getRoutedHostControlClient } from "@cocalc/server/project-host/client";
import { getProjectSecretsRuntimeCache } from "./project-secrets";

const logger = getLogger("server:projects:project-secrets-runtime");

export async function syncProjectSecretsRuntimeOnAssignedHost({
  project_id,
}: {
  project_id: string;
}): Promise<ProjectSecretsRuntimeRefreshResult> {
  const cache = await getProjectSecretsRuntimeCache({ project_id });
  let host_id: string;
  try {
    host_id = (await getAssignedProjectHostInfo(project_id)).host_id;
  } catch (err) {
    logger.debug("project secrets runtime sync skipped; no assigned host", {
      project_id,
      generation: cache.generation,
      err: `${err}`,
    });
    return {
      status: "cached_for_next_start",
      cached_generation: cache.generation,
      materialized_generation: 0,
      secret_names: cache.entries.map(({ name }) => name).sort(),
      error_code: "host_unassigned",
    };
  }
  try {
    const client = await getRoutedHostControlClient({
      host_id,
      timeout: 30_000,
    });
    return await client.syncProjectSecretsCache({ project_id, cache });
  } catch (err) {
    logger.warn("project secrets runtime sync to host failed", {
      project_id,
      host_id,
      generation: cache.generation,
      err: `${err}`,
    });
    return {
      status: "retry_pending",
      cached_generation: cache.generation,
      materialized_generation: 0,
      secret_names: cache.entries.map(({ name }) => name).sort(),
      error_code: "host_unavailable",
    };
  }
}
