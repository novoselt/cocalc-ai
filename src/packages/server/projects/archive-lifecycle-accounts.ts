/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { AccountLocalArchiveLifecycleStatus } from "@cocalc/conat/inter-bay/api";
import { createInterBayAccountLocalClient } from "@cocalc/conat/inter-bay/api";
import { getArchiveLifecycleAccountStatusesLocal } from "@cocalc/server/accounts/archive-lifecycle-status";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getClusterAccountsByIds } from "@cocalc/server/inter-bay/accounts";
import { getInterBayFabricClient } from "@cocalc/server/inter-bay/fabric";
import type { ArchiveLifecycleAccountStatus } from "./archive-lifecycle-types";

const MAX_REMOTE_BATCH = 500;

function unresolved(account_id: string): ArchiveLifecycleAccountStatus {
  return {
    account_id,
    resolved: false,
    banned: false,
    banned_at: null,
    membership: null,
  };
}

export async function resolveArchiveLifecycleAccountStatuses(
  accountIds: string[],
): Promise<Map<string, ArchiveLifecycleAccountStatus>> {
  const ids = [...new Set(accountIds)];
  const answer = new Map(
    ids.map((account_id) => [account_id, unresolved(account_id)]),
  );
  if (ids.length === 0) return answer;

  let directory;
  try {
    directory = await getClusterAccountsByIds(ids);
  } catch {
    return answer;
  }
  const byBay = new Map<string, string[]>();
  for (const entry of directory) {
    const homeBayId = `${entry.home_bay_id ?? ""}`.trim();
    if (!homeBayId) continue;
    const list = byBay.get(homeBayId) ?? [];
    list.push(entry.account_id);
    byBay.set(homeBayId, list);
  }

  await Promise.all(
    [...byBay.entries()].map(async ([homeBayId, homeIds]) => {
      for (let i = 0; i < homeIds.length; i += MAX_REMOTE_BATCH) {
        const account_ids = homeIds.slice(i, i + MAX_REMOTE_BATCH);
        let statuses: AccountLocalArchiveLifecycleStatus[];
        try {
          statuses =
            homeBayId === getConfiguredBayId()
              ? await getArchiveLifecycleAccountStatusesLocal({ account_ids })
              : await createInterBayAccountLocalClient({
                  client: getInterBayFabricClient(),
                  dest_bay: homeBayId,
                }).getArchiveLifecycleStatuses({ account_ids });
        } catch {
          continue;
        }
        for (const status of statuses) {
          answer.set(status.account_id, status);
        }
      }
    }),
  );
  return answer;
}
