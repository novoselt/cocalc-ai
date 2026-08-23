/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildDiagnostic } from "../contracts";

const LINES_RE = /lines\s+(\d+)(?:\s*[-–]\s*(\d+))?/;
const FILE_LINES_RE = /Quitting from\s+.+?:(\d+)(?:\s*[-–]\s*(\d+))?/;

export function extractDocumentErrorLines(
  input: string,
): [number, number] | undefined {
  const match = input.match(LINES_RE) ?? input.match(FILE_LINES_RE);
  if (match == null) return undefined;
  const from = parseInt(match[1], 10);
  if (!Number.isFinite(from)) return undefined;
  const parsedTo = match[2] == null ? from : parseInt(match[2], 10);
  return [from, Number.isFinite(parsedTo) && parsedTo > from ? parsedTo : from];
}

export function markdownFailureDiagnostic(options: {
  source: "r-markdown" | "quarto";
  path: string;
  stdout: string;
  stderr: string;
  stageId: string;
}): BuildDiagnostic {
  const output = `${options.stderr}\n${options.stdout}`.trim();
  const lines = extractDocumentErrorLines(output);
  const message =
    options.stderr.trim().split("\n").find(Boolean) ??
    options.stdout.trim().split("\n").find(Boolean) ??
    `${options.source} build failed`;
  return {
    level: "error",
    source: options.source,
    file: options.path,
    line: lines?.[0],
    end_line: lines?.[1],
    message,
    content: output,
    raw: output,
    stage_id: options.stageId,
  };
}
