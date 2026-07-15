/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("course secret sharing automatic-path audit", () => {
  it("does not call course-secret mutations while opening or reconfiguring a course", () => {
    const automaticPaths = [
      "sync.ts",
      "configuration/actions.ts",
      "student-projects/actions.ts",
    ];
    const mutationNames = [
      "setProjectSecretCourseSharing",
      "setCourseSecretPolicy",
      "setCourseSecretGrants",
      "approveCourseSecretRecipients",
      "revokeCourseSecretRecipients",
      "startCourseSecretSync",
      "startCourseSecretCleanup",
      "revokeCourseSecretPolicy",
    ];
    for (const path of automaticPaths) {
      const source = readFileSync(join(__dirname, path), "utf8");
      for (const mutation of mutationNames) {
        expect(source).not.toContain(mutation);
      }
    }
  });

  it("links the sharing panel to the project-wide secrets configuration", () => {
    const source = readFileSync(
      join(__dirname, "configuration/shared-secrets.tsx"),
      "utf8",
    );
    expect(source).toContain("revealDocsAction");
    expect(source).toContain('actionId: "settings.environment.secrets"');
    expect(source).toContain("Manage Project Secrets");
  });
});
