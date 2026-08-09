/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type {
  GrowthEventInput,
  GrowthEventName,
} from "@cocalc/conat/hub/api/growth-analytics";
import { ingestGrowthEvent } from "./ingest";
import { uuid } from "@cocalc/util/misc";

const logger = getLogger("server:growth-analytics:server-events");

export function recordServerGrowthEvent({
  account_id,
  event_name,
  occurred_at,
  project_id,
  source_component = "hub",
  properties,
}: {
  account_id: string;
  event_name: GrowthEventName;
  occurred_at?: Date;
  project_id?: string;
  source_component?: GrowthEventInput["source_component"];
  properties?: GrowthEventInput["properties"];
}): void {
  void ingestGrowthEvent({
    account_id,
    event: {
      event_id: uuid(),
      event_name,
      occurred_at: occurred_at?.toISOString(),
      project_id,
      source_component,
      properties: { source_confidence: "server", ...properties },
    },
  }).catch((err) => {
    logger.warn("unable to record server growth event", {
      account_id,
      event_name,
      err: `${err}`,
    });
  });
}
