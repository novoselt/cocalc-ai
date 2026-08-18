/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  getAsyncJobGroupSnapshot,
  onAsyncJobGroupEvent,
} from "@cocalc/backend/execute-code";
import type {
  Client as ConatClient,
  Subscription,
} from "@cocalc/conat/core/client";
import {
  execJobEventsSubject,
  execJobSnapshotSubject,
} from "@cocalc/conat/project/exec-jobs";
import { getProjectConatClient } from "@cocalc/project/conat/runtime-client";
import { project_id as runtimeProjectId } from "@cocalc/project/data";
import { getLogger } from "@cocalc/project/logger";

const logger = getLogger("project:exec-job-watch");

function normalizeJobGroup(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("job_group must be a nonempty string");
  }
  const job_group = value.trim();
  if (job_group.length > 8192) throw new Error("job_group is too long");
  return job_group;
}

export async function init(opts?: {
  client?: ConatClient;
  project_id?: string;
}): Promise<{ close: () => void }> {
  const client = opts?.client ?? getProjectConatClient();
  const project_id = opts?.project_id ?? runtimeProjectId;
  const snapshotSubject = execJobSnapshotSubject({ project_id });
  const snapshotSub = await client.subscribe(snapshotSubject, { queue: "q" });

  const stopPublishing = onAsyncJobGroupEvent((event) => {
    try {
      client.publishSync(
        execJobEventsSubject({ project_id, job_group: event.job_group }),
        event,
      );
    } catch (err) {
      logger.debug("unable to publish exec job lifecycle event", {
        err: `${err}`,
        job_group: event.job_group,
        job_id: event.job_id,
      });
    }
  });
  void serveSnapshots(snapshotSub).catch((err) => {
    logger.warn("exec job snapshot service stopped", { err: `${err}` });
  });

  return {
    close: () => {
      stopPublishing();
      snapshotSub.close();
    },
  };
}

async function serveSnapshots(subscription: Subscription): Promise<void> {
  for await (const mesg of subscription) {
    try {
      const job_group = normalizeJobGroup(mesg.data?.job_group);
      mesg.respondSync({
        snapshots: getAsyncJobGroupSnapshot(job_group),
      });
    } catch (err) {
      mesg.respondSync({ error: `${err}` });
    }
  }
}
