/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getRow } from "@cocalc/lite/hub/sqlite/database";
import { isValidUUID } from "@cocalc/util/misc";

export function getLocalExamAccountProjectId(
  account_id: string,
): string | undefined {
  const row = getRow("accounts", JSON.stringify({ account_id }));
  const project_id = row?.exam_project_id;
  return row?.exam_mode === true &&
    typeof project_id === "string" &&
    isValidUUID(project_id)
    ? project_id
    : undefined;
}

export function isLocalExamProject(project_id: string): boolean {
  const row = getRow("projects", JSON.stringify({ project_id }));
  return (
    row?.local_only === true &&
    typeof row?.exam_run_id === "string" &&
    isValidUUID(row.exam_run_id)
  );
}
