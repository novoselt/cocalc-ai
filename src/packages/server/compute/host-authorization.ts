/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details.
 */

import getPool from "@cocalc/database/pool";

export async function assertComputeProjectAssignedToHost({
  project_id,
  host_id,
  bay_id,
}: {
  project_id: string;
  host_id: string;
  bay_id: string;
}): Promise<void> {
  const { rows } = await getPool().query(
    `SELECT 1
       FROM projects
       JOIN project_hosts
         ON project_hosts.id=projects.host_id
        AND project_hosts.deleted IS NULL
      WHERE projects.project_id=$1
        AND projects.host_id=$2
        AND projects.deleted IS NOT true
        AND COALESCE(projects.owning_bay_id, $3) = COALESCE(project_hosts.bay_id, $3)
      LIMIT 1`,
    [project_id, host_id, bay_id],
  );
  if (rows.length === 0) {
    throw Object.assign(
      new Error(`project ${project_id} is not assigned to host ${host_id}`),
      { code: 403 },
    );
  }
}
