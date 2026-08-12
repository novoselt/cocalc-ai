/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { shouldCreateCourseStudentProject } from "./course-reconfigure-plan";

describe("course reconfiguration project creation planning", () => {
  it("does not recreate a project already located on a bay", () => {
    expect(
      shouldCreateCourseStudentProject({
        knownBayId: "bay-2",
        admissionCreate: true,
      }),
    ).toBe(false);
  });

  it("creates a newly allocated student project", () => {
    expect(shouldCreateCourseStudentProject({ admissionCreate: true })).toBe(
      true,
    );
  });

  it("repairs an id recovered from a failed creation attempt", () => {
    expect(shouldCreateCourseStudentProject({ admissionCreate: false })).toBe(
      true,
    );
  });
});
