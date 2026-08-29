/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type { LroSummary } from "@cocalc/conat/hub/api/lro";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import { getAuthoritativeProjectHardDeleteStatus } from "@cocalc/server/projects/hard-delete-evidence";
import { mapParallelLimit } from "@cocalc/util/async-utils";
import {
  finishProjectBackupLroDeletionChecks,
  listQueuedProjectBackupLroDeletionCandidates,
} from "./lro-db";

const CHECK_CONCURRENCY = 20;
const logger = getLogger("server:lro:orphan-project-backup-maintenance");

async function hasAuthoritativeHardDeleteEvidence(
  op: LroSummary,
): Promise<boolean> {
  const owning_bay_id = `${op.input?.owning_bay_id ?? ""}`.trim();
  if (!owning_bay_id) return false;
  try {
    const evidence =
      owning_bay_id === getConfiguredBayId()
        ? await getAuthoritativeProjectHardDeleteStatus({
            project_id: op.scope_id,
          })
        : await getInterBayBridge()
            .projectControl(owning_bay_id)
            .hardDeleteStatus({ project_id: op.scope_id });
    return (
      evidence.bay_id === owning_bay_id &&
      evidence.project_id === op.scope_id &&
      evidence.status === "hard-deleted"
    );
  } catch (err) {
    logger.warn("unable to verify project hard-delete status", {
      op_id: op.op_id,
      project_id: op.scope_id,
      owning_bay_id,
      err: `${err}`,
    });
    return false;
  }
}

export async function expireOrphanedProjectBackupLros({
  limit = 1000,
  min_age_ms,
}: {
  limit?: number;
  min_age_ms?: number;
} = {}): Promise<LroSummary[]> {
  const candidates = await listQueuedProjectBackupLroDeletionCandidates({
    limit,
    ...(min_age_ms == null ? {} : { min_age_ms }),
  });
  if (candidates.length === 0) return [];
  const hardDeleted = await mapParallelLimit(
    candidates,
    hasAuthoritativeHardDeleteEvidence,
    CHECK_CONCURRENCY,
  );
  return await finishProjectBackupLroDeletionChecks({
    checked_op_ids: candidates.map(({ op_id }) => op_id),
    hard_deleted_op_ids: candidates
      .filter((_op, index) => hardDeleted[index])
      .map(({ op_id }) => op_id),
  });
}
