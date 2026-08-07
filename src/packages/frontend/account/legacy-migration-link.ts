/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const LEGACY_PROJECT_QUERY_PARAM = "legacy_project_id";

export function legacyMigrationProjectHref(legacyProjectId: string): string {
  const params = new URLSearchParams({
    [LEGACY_PROJECT_QUERY_PARAM]: legacyProjectId.trim(),
  });
  return `/settings/legacy-migration?${params}`;
}

export function legacyMigrationProjectQuery(search: string): string {
  return `${new URLSearchParams(search).get(LEGACY_PROJECT_QUERY_PARAM) ?? ""}`.trim();
}
