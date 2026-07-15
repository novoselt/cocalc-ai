/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { normalizeCoursePath } from "./course-path";

describe("normalizeCoursePath", () => {
  it("normalizes relative course paths", () => {
    expect(normalizeCoursePath(" ./classes//2026/../math.course ")).toBe(
      "classes/math.course",
    );
    expect(normalizeCoursePath("classes\\math.course")).toBe(
      "classes/math.course",
    );
  });

  it("normalizes course paths inside recognized project runtime homes", () => {
    expect(normalizeCoursePath("/home/user/classes/math.course")).toBe(
      "classes/math.course",
    );
    expect(normalizeCoursePath("/root/legacy.course")).toBe("legacy.course");
  });

  it.each([
    "",
    "/tmp/a.course",
    "/etc/a.course",
    "/home/user/../../tmp/a.course",
    "../a.course",
    "a.txt",
    ".course/child",
  ])("rejects %s", (path) => {
    expect(() => normalizeCoursePath(path)).toThrow("invalid course path");
  });
});
