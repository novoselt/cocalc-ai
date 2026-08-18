/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ExecJobGroupWatcher } from "@cocalc/frontend/client/exec-job-watcher";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { ExecuteCodeOutputAsync } from "@cocalc/util/types/execute-code";

export function buildJobGroup(path: string): string {
  return `build:${path}`;
}

export function watchProjectBuilds({
  onBuild,
  path,
  project_id,
}: {
  onBuild: (job: ExecuteCodeOutputAsync) => void;
  path: string;
  project_id: string;
}): ExecJobGroupWatcher {
  const watcher = webapp_client.project_client.watchExecJobGroup({
    job_group: buildJobGroup(path),
    project_id,
  });
  watcher.on("job", (job: ExecuteCodeOutputAsync) => {
    if (job.status === "running") onBuild(job);
  });
  return watcher;
}

export function jobAggregateValue(
  job: ExecuteCodeOutputAsync,
): string | number | undefined {
  const aggregate = job.aggregate;
  return typeof aggregate === "object" ? aggregate.value : aggregate;
}
