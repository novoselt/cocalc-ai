/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function updateMountedProjectIds(
  mountedProjectIds: Set<string>,
  activeProjectId: string | undefined,
  openProjectIds: Iterable<string>,
): void {
  const open = new Set(openProjectIds);
  if (activeProjectId != null && open.has(activeProjectId)) {
    mountedProjectIds.add(activeProjectId);
  }
  for (const projectId of mountedProjectIds) {
    if (!open.has(projectId)) {
      mountedProjectIds.delete(projectId);
    }
  }
}
