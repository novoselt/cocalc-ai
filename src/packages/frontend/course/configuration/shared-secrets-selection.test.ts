/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { CourseSecretRecipientPreview } from "@cocalc/conat/hub/api/projects";
import { selectableRecipientIds } from "./shared-secrets-selection";

function recipient(
  target_project_id: string,
  overrides: Partial<CourseSecretRecipientPreview> = {},
): CourseSecretRecipientPreview {
  return {
    target_project_id,
    approved: false,
    eligible: true,
    reason: "not_approved",
    ...overrides,
  };
}

describe("selectableRecipientIds", () => {
  it("selects only explicitly eligible unapproved recipients", () => {
    expect(
      selectableRecipientIds([
        recipient("eligible-1"),
        recipient("approved", { approved: true, reason: "eligible" }),
        recipient("wrong-course", {
          eligible: false,
          reason: "wrong_course_project",
        }),
        recipient("inconsistent", { eligible: false }),
        recipient("eligible-2"),
      ]),
    ).toEqual(["eligible-1", "eligible-2"]);
  });
});
