/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";

export type ProjectHardDeleteStatus = "live" | "hard-deleted" | "unknown";

export async function getAuthoritativeProjectHardDeleteStatus({
  project_id,
}: {
  project_id: string;
}): Promise<{
  project_id: string;
  bay_id: string;
  status: ProjectHardDeleteStatus;
}> {
  const bay_id = getConfiguredBayId();
  const { rows: liveRows } = await getPool().query(
    "SELECT 1 FROM projects WHERE project_id=$1 LIMIT 1",
    [project_id],
  );
  if (liveRows.length > 0) {
    return { project_id, bay_id, status: "live" };
  }

  const { rows: tableRows } = await getPool().query<{
    table_name: string | null;
  }>("SELECT to_regclass('public.deleted_projects')::text AS table_name");
  if (!tableRows[0]?.table_name) {
    return { project_id, bay_id, status: "unknown" };
  }
  const { rows: deletedRows } = await getPool().query(
    "SELECT 1 FROM deleted_projects WHERE project_id=$1 LIMIT 1",
    [project_id],
  );
  return {
    project_id,
    bay_id,
    status: deletedRows.length > 0 ? "hard-deleted" : "unknown",
  };
}
