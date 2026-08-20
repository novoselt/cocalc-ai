/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type { ProjectCopyDestination } from "@cocalc/conat/hub/api/projects";
import { assertProjectCollaboratorAccessAllowRemoteBatch } from "@cocalc/server/conat/project-remote-access";
import { assertCanIncreaseAccountStorage } from "@cocalc/server/membership/project-limits";
import { getProjectOwnerAccountIdFromUsers } from "@cocalc/server/projects/ownership";
import { mapParallelLimit } from "@cocalc/util/async-utils";

const logger = getLogger("server:projects:copy-admission");
const COPY_ADMISSION_CONCURRENCY = 20;

type AdmissionProgress = (update: {
  step: string;
  message?: string;
  detail?: any;
}) => void;

export async function admitCopyDestinations({
  account_id,
  dests,
  progress,
}: {
  account_id: string;
  dests: ProjectCopyDestination[];
  progress?: AdmissionProgress;
}): Promise<void> {
  const startedAt = Date.now();
  const projectIds = Array.from(new Set(dests.map((dest) => dest.project_id)));
  progress?.({
    step: "validate",
    message: `authorizing ${projectIds.length} destination project(s)`,
  });
  const references = await assertProjectCollaboratorAccessAllowRemoteBatch({
    account_id,
    project_ids: projectIds,
    warmRoute: false,
  });
  const authorizationMs = Date.now() - startedAt;

  const usageAccountIds = new Set<string>();
  for (const reference of references) {
    const usageAccountId =
      reference.usage_account_id ??
      getProjectOwnerAccountIdFromUsers(reference.users);
    if (usageAccountId) {
      usageAccountIds.add(usageAccountId);
    }
  }

  const storageStartedAt = Date.now();
  progress?.({
    step: "validate",
    message: `checking storage limits for ${usageAccountIds.size} account(s)`,
  });
  await mapParallelLimit(
    Array.from(usageAccountIds),
    async (usageAccountId) =>
      await assertCanIncreaseAccountStorage({ account_id: usageAccountId }),
    COPY_ADMISSION_CONCURRENCY,
  );
  const storageMs = Date.now() - storageStartedAt;
  logger.info("copy destination admission complete", {
    account_id,
    destinations: projectIds.length,
    usage_accounts: usageAccountIds.size,
    authorization_ms: authorizationMs,
    storage_ms: storageMs,
    total_ms: Date.now() - startedAt,
  });
}
