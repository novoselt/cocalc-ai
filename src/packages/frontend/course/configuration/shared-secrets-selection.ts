/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { CourseSecretRecipientPreview } from "@cocalc/conat/hub/api/projects";

export function selectableRecipientIds(
  preview: CourseSecretRecipientPreview[],
): string[] {
  return preview
    .filter(
      ({ approved, eligible, reason }) =>
        !approved && eligible && reason === "not_approved",
    )
    .map(({ target_project_id }) => target_project_id);
}
