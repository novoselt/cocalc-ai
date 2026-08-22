/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildDiagnostic, BuildStageSpec } from "../contracts";
import { basenameWithoutExtension, path_split } from "../path";

export function sagetexFile(path: string): string {
  return `${basenameWithoutExtension(path)}.sagetex.sage`;
}

export function sagetexStage(options: {
  stageId: string;
  logicalPath: string;
  workingPath: string;
  resourceKey: string;
  runDirectory?: string;
  hash: string;
  timeoutS: number;
}): BuildStageSpec {
  const { head } = path_split(options.workingPath);
  return {
    stage_id: options.stageId,
    name: "sagetex",
    logical_path: options.logicalPath,
    working_path: options.workingPath,
    resource_key: options.resourceKey,
    command: "sage",
    args: [sagetexFile(options.workingPath)],
    cwd: options.runDirectory ?? head,
    bash: false,
    timeout_s: options.timeoutS,
    required: true,
    job_key: `sagetex:${options.logicalPath}`,
    aggregate_key: options.hash || undefined,
  };
}

export function parseSagetexDiagnostics(
  file: string,
  stderr: string,
): BuildDiagnostic[] {
  if (stderr.includes("Sage processing complete")) return [];
  const diagnostics: BuildDiagnostic[] = [];
  let current: BuildDiagnostic | undefined;
  for (const line of stderr.split("\n")) {
    if (line.trim()) {
      if (current == null) {
        current = {
          level: "error",
          source: "sagetex",
          file,
          message: line,
          content: "",
        };
        diagnostics.push(current);
      }
      current.content = `${current.content ?? ""}${line}\n`;
      current.message = line;
    } else {
      current = undefined;
    }
  }
  return diagnostics;
}
