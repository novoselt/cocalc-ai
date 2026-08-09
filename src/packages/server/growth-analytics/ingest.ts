/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import type { GrowthEventInput } from "@cocalc/conat/hub/api/growth-analytics";
import { ensureGrowthAnalyticsSchema } from "./schema";
import { validateGrowthEvent } from "./events";

export async function ingestGrowthEvent({
  account_id,
  event,
}: {
  account_id: string;
  event: GrowthEventInput;
}): Promise<{ recorded: boolean }> {
  const validated = validateGrowthEvent(event);
  await ensureGrowthAnalyticsSchema();
  const { rows } = await getPool().query<{ home_bay_id: string | null }>(
    "SELECT home_bay_id FROM accounts WHERE account_id=$1",
    [account_id],
  );
  if (!rows.length) throw Error("account does not exist");
  const sourceBayId = getConfiguredBayId();
  const homeBayId = `${rows[0].home_bay_id ?? sourceBayId}`.trim();
  const result = await getPool().query(
    `INSERT INTO growth_event_log
       (event_id, event_name, event_version, occurred_at, account_id,
        project_id, home_bay_id, source_bay_id, source_component,
        experiment, variant, properties)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      validated.event_id,
      validated.event_name,
      validated.occurred_at,
      account_id,
      validated.project_id ?? null,
      homeBayId,
      sourceBayId,
      validated.source_component,
      validated.experiment ?? null,
      validated.variant ?? null,
      JSON.stringify(validated.properties),
    ],
  );
  return { recorded: (result.rowCount ?? 0) > 0 };
}
