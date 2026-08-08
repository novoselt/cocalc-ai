/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { normalize } from "path";

import { redux } from "@cocalc/frontend/app-framework";
import { normalizeAbsolutePath } from "@cocalc/util/path-model";
import { startDirectoryNavigationTrace } from "@cocalc/frontend/project/listing/ux-latency";

export function normalizeBrowsingPath(path: string): string {
  if (path == null || path === "" || path === ".") {
    return "/";
  }
  let normalized = normalize(path);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized.startsWith(".") && !normalized.startsWith("./")) {
    return normalized;
  }
  return normalizeAbsolutePath(normalized);
}

export function navigateBrowsingPath(
  project_id: string,
  path: string,
  opts: {
    updateUrl?: boolean;
  } = {},
): void {
  const normalizedPath = normalizeBrowsingPath(path);
  const actions = redux.getProjectActions(project_id);
  if (actions == null) return;

  if (opts.updateUrl) {
    void actions.open_directory(normalizedPath, true, true);
  } else {
    startDirectoryNavigationTrace({
      project_id,
      host_id: redux
        .getProjectsStore?.()
        ?.getIn?.(["project_map", project_id, "host_id"]),
      path: normalizedPath,
    });
    actions.set_current_path(normalizedPath);
    actions.set_all_files_unchecked();
  }
}
