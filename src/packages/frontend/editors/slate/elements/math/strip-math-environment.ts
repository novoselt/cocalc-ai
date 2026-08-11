/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export function stripMathEnvironment(value: string): string {
  // These environments get detected, but must be removed once already in math
  // mode. Other environments remain meaningful to the renderer.
  for (const environment of ["math", "displaymath"]) {
    const begin = `\\begin{${environment}}`;
    const end = `\\end{${environment}}`;
    if (value.startsWith(begin)) {
      return value.slice(begin.length, value.length - end.length);
    }
  }
  return value;
}
