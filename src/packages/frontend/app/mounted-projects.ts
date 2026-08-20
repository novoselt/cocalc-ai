/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { is_valid_uuid_string } from "@cocalc/util/misc";

export function updateMountedProjectIds(
  mountedProjectIds: Set<string>,
  activeProjectId: string | undefined,
  openProjectIds: Iterable<string>,
): void {
  const open = new Set(
    [...openProjectIds].filter((projectId) => is_valid_uuid_string(projectId)),
  );
  if (
    activeProjectId != null &&
    is_valid_uuid_string(activeProjectId) &&
    open.has(activeProjectId)
  ) {
    mountedProjectIds.add(activeProjectId);
  }
  for (const projectId of mountedProjectIds) {
    if (!is_valid_uuid_string(projectId) || !open.has(projectId)) {
      mountedProjectIds.delete(projectId);
    }
  }
}
