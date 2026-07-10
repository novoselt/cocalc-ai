/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const OTHER_SETTINGS_LEGACY_MIGRATION_PROJECTS_BUTTON =
  "legacy_migration_projects_button";

export const LEGACY_PROJECT_RESTORE_LRO_KIND = "legacy-project-restore";

export const LEGACY_SOURCE_PROJECT_LABEL = "legacy.cocalc.com/project_id";
export const LEGACY_RESTORE_STATUS_LABEL = "legacy.cocalc.com/restore_status";
export const LEGACY_RESTORE_LRO_LABEL = "legacy.cocalc.com/restore_op_id";
export const LEGACY_RESTORE_ERROR_LABEL = "legacy.cocalc.com/restore_error";

export const LEGACY_RESTORE_FILE_FAILURE_REPORT_LIMIT = 50;

export const LEGACY_PROJECT_ARCHIVE_REFRESH_PAUSE_CUTOFF =
  "2026-06-18T00:00:00.000Z";

export const LEGACY_PROJECT_ARCHIVE_REFRESH_PAUSED_MESSAGE =
  "Restore is temporarily paused for legacy projects with cocalc.com activity on or after June 18, 2026 while CoCalc refreshes their archives from the final cocalc.com backup.";

export function legacyProjectArchiveRefreshPaused(project: {
  last_active?: Date | string | null;
  last_edited?: Date | string | null;
}): boolean {
  const cutoff = Date.parse(LEGACY_PROJECT_ARCHIVE_REFRESH_PAUSE_CUTOFF);
  for (const value of [project.last_edited, project.last_active]) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp) && timestamp >= cutoff) return true;
  }
  return false;
}

function cleanTarPath(path: string): string {
  return path.replace(/^\.\//, "").trim();
}

export function legacyRestoreMissingArchiveEntriesFromTarStderr(
  stderr: unknown,
): string[] {
  const text = `${stderr ?? ""}`;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/g)) {
    const match = line.trim().match(/^tar:\s+(.+): Not found in archive$/);
    if (!match) continue;
    const path = cleanTarPath(match[1]);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function legacyRestoreTarStderrHasOnlyMissingArchiveEntries(
  stderr: unknown,
): boolean {
  const text = `${stderr ?? ""}`;
  let foundMissingEntry = false;
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^tar:\s+.+: Not found in archive$/.test(line)) {
      foundMissingEntry = true;
      continue;
    }
    if (line === "tar: Exiting with failure status due to previous errors") {
      continue;
    }
    return false;
  }
  return foundMissingEntry;
}

export function legacyRestoreMissingArchiveEntriesFromError(
  error: unknown,
): string[] {
  const text = `${error ?? ""}`;
  const paths: string[] = [];
  const seen = new Set<string>();
  const regex = /tar:\s+(.+?):\s+Not found in archive/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) != null) {
    const path = cleanTarPath(match[1]);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}
