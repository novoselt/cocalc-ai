/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  EXEC_JOB_EVENTS_SERVICE,
  EXEC_JOB_SNAPSHOT_SERVICE,
  projectSubject,
} from "@cocalc/conat/names";

export function execJobEventsSubject({
  project_id,
  job_group,
}: {
  project_id: string;
  job_group: string;
}): string {
  return projectSubject({
    project_id,
    service: EXEC_JOB_EVENTS_SERVICE,
    path: job_group,
  });
}

export function execJobSnapshotSubject({
  project_id,
}: {
  project_id: string;
}): string {
  return projectSubject({
    project_id,
    service: EXEC_JOB_SNAPSHOT_SERVICE,
  });
}
