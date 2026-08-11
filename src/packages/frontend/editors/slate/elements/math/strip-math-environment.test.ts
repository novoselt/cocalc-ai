/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { stripMathEnvironment } from "./strip-math-environment";

test.each(["math", "displaymath"])(
  "strips a surrounding %s environment",
  (environment) => {
    expect(
      stripMathEnvironment(
        `\\begin{${environment}}x^2 + y^2\\end{${environment}}`,
      ),
    ).toBe("x^2 + y^2");
  },
);

test("preserves other environments", () => {
  expect(stripMathEnvironment("\\begin{align}x&=1\\end{align}")).toBe(
    "\\begin{align}x&=1\\end{align}",
  );
});
