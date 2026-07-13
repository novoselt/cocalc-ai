/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { humanSize } from "@cocalc/util/misc";
import {
  PROJECT_DISK_QUOTA_EXCEEDED_CODE,
  isProjectDiskQuotaStartBlocked,
  projectDiskStartupHeadroomBytes,
  type ProjectDiskQuota,
} from "@cocalc/util/project-start-errors";

export {
  PROJECT_DISK_QUOTA_EXCEEDED_CODE,
  isProjectDiskQuotaStartBlocked,
  projectDiskStartupHeadroomBytes,
} from "@cocalc/util/project-start-errors";

type Logger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};

export class ProjectDiskQuotaExceededError extends Error {
  public readonly code = PROJECT_DISK_QUOTA_EXCEEDED_CODE;
  public readonly quota_used_bytes: number;
  public readonly quota_size_bytes: number;
  public readonly startup_headroom_bytes: number;

  constructor({
    used,
    size,
    startup_headroom_bytes = projectDiskStartupHeadroomBytes(size),
  }: ProjectDiskQuota & { startup_headroom_bytes?: number }) {
    const available = Math.max(0, size - used);
    const quotaState =
      used >= size ? "exceeded" : "almost exhausted for project startup";
    super(
      `Project disk quota ${quotaState}: this project is using ${humanSize(used)} of ${humanSize(size)}, with ${humanSize(available)} free. Project startup keeps ${humanSize(startup_headroom_bytes)} free for required filesystem metadata. You do not need to start the project to browse, edit, download, or delete files and snapshots. Delete files and snapshots, upgrade your membership for more project disk space, or contact support.`,
    );
    this.name = "ProjectDiskQuotaExceededError";
    this.quota_used_bytes = used;
    this.quota_size_bytes = size;
    this.startup_headroom_bytes = startup_headroom_bytes;
  }
}

export function isProjectDiskQuotaExceeded(quota: ProjectDiskQuota): boolean {
  const used = Number(quota.used);
  const size = Number(quota.size);
  return (
    Number.isFinite(used) && Number.isFinite(size) && size > 0 && used >= size
  );
}

export async function assertProjectDiskQuotaStartAllowed({
  project_id,
  getQuota,
  logger,
}: {
  project_id: string;
  getQuota: (project_id: string) => Promise<ProjectDiskQuota>;
  logger: Logger;
}): Promise<void> {
  let quota: ProjectDiskQuota;
  try {
    quota = await getQuota(project_id);
  } catch (err) {
    logger.warn("unable to check project disk quota before start", {
      project_id,
      err: `${err}`,
    });
    return;
  }
  if (isProjectDiskQuotaStartBlocked(quota)) {
    throw new ProjectDiskQuotaExceededError(quota);
  }
}
