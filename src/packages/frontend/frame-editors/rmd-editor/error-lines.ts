/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// Where did a knitr / quarto build fail?  Both report the offending chunk's
// source location, but the wording changed:
//
//   older knitr:            "Quitting from lines 8-11 (report.Rmd)"
//   knitr >= 1.48, quarto:  "Quitting from report.Rmd:8-11 [broken]"
//
// A one-line chunk reports a single number instead of a range.  The result is
// a 1-based inclusive line range, used to point the agent at the failure.

const LINES_RE = /lines\s+(\d+)(?:\s*[-–]\s*(\d+))?/;
// the file name may contain spaces, so match it lazily up to the `:<line>`
const FILE_LINES_RE = /Quitting from\s+.+?:(\d+)(?:\s*[-–]\s*(\d+))?/;

export function extractLineNumbers(input: string): [number, number] | null {
  const match = input.match(LINES_RE) ?? input.match(FILE_LINES_RE);
  if (match == null) return null;
  const fromLine = parseInt(match[1], 10);
  if (!Number.isFinite(fromLine)) return null;
  const toLine = match[2] != null ? parseInt(match[2], 10) : fromLine;
  return [
    fromLine,
    Number.isFinite(toLine) && toLine > fromLine ? toLine : fromLine,
  ];
}
