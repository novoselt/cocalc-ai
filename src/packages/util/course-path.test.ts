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

  it.each(["", "/tmp/a.course", "../a.course", "a.txt", ".course/child"])(
    "rejects %s",
    (path) => {
      expect(() => normalizeCoursePath(path)).toThrow("invalid course path");
    },
  );
});
