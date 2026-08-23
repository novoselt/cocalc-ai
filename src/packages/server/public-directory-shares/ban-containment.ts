/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { createInterBayAccountLocalClient } from "@cocalc/conat/inter-bay/api";
import type { DisablePublicDirectorySharesForBannedActorResponse } from "@cocalc/conat/hub/api/public-directory-shares";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { listClusterBayRegistry } from "@cocalc/server/bay-registry";
import { getConfiguredClusterSeedBayId } from "@cocalc/server/cluster-config";
import { getInterBayFabricClient } from "@cocalc/server/inter-bay/fabric";

const logger = getLogger("server:public-directory-shares:ban-containment");

async function disableOnBay({
  bay_id,
  actor_account_id,
  reason,
}: {
  bay_id: string;
  actor_account_id: string;
  reason?: string | null;
}): Promise<DisablePublicDirectorySharesForBannedActorResponse> {
  const opts = { actor_account_id, reason };
  if (bay_id === getConfiguredBayId()) {
    const { disableForBannedActor } = await import("./index");
    return await disableForBannedActor(opts);
  }
  return await createInterBayAccountLocalClient({
    client: getInterBayFabricClient(),
    dest_bay: bay_id,
  }).publicDirectoryShareDisableForBannedActor(opts);
}

export async function disablePublicDirectorySharesForBannedAccountAcrossCluster({
  actor_account_id,
  reason,
}: {
  actor_account_id: string;
  reason?: string | null;
}): Promise<DisablePublicDirectorySharesForBannedActorResponse> {
  const bayIds = new Set<string>([
    getConfiguredBayId(),
    getConfiguredClusterSeedBayId(),
  ]);
  try {
    for (const bay of await listClusterBayRegistry()) {
      if (bay.bay_id) {
        bayIds.add(bay.bay_id);
      }
    }
  } catch (err) {
    // Still clean the current and seed bays. Serving-time checks remain the
    // fail-closed protection for a bay omitted by an unavailable registry.
    logger.error("failed to list bays during banned-share containment", {
      actor_account_id,
      err: `${err}`,
    });
  }

  const results = await Promise.allSettled(
    [...bayIds].map(async (bay_id) => ({
      bay_id,
      result: await disableOnBay({ bay_id, actor_account_id, reason }),
    })),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `failed to disable banned-account public shares on ${failures.length} bay(s)`,
    );
  }

  const shareIds = new Set<string>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const shareId of result.value.result.share_ids) {
      shareIds.add(shareId);
    }
  }
  if (shareIds.size > 0) {
    logger.warn("disabled public shares after account ban", {
      actor_account_id,
      disabled_count: shareIds.size,
      bay_count: bayIds.size,
    });
  }
  return {
    disabled_count: shareIds.size,
    share_ids: [...shareIds],
  };
}
