/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";

export async function assertProjectSoleOwner({
  project_id,
  account_id,
}: {
  project_id: string;
  account_id: string;
}): Promise<void> {
  const { rows } = await getPool().query<{ sole_owner: boolean }>(
    `
      SELECT (
               users #>> ARRAY[$2::TEXT, 'group'] = 'owner'
               AND NOT EXISTS (
                     SELECT 1
                       FROM jsonb_each(COALESCE(users, '{}'::JSONB)) member
                      WHERE member.value->>'group' = 'owner'
                        AND member.key <> $2::TEXT
                   )
             ) AS sole_owner
        FROM projects
       WHERE project_id=$1
    `,
    [project_id, account_id],
  );
  if (rows[0]?.sole_owner !== true) {
    throw new Error(
      `project ${project_id} is not solely owned by account ${account_id}`,
    );
  }
}
