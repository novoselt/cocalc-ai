/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildDiagnostic, BuildStageSpec } from "../contracts";
import { basenameWithoutExtension, path_split } from "../path";

export function pythontexStage(options: {
  stageId: string;
  logicalPath: string;
  workingPath: string;
  resourceKey: string;
  runDirectory?: string;
  force: boolean;
  timeoutS: number;
  aggregateKey?: string | number;
}): BuildStageSpec {
  const { head } = path_split(options.workingPath);
  const rerun = options.force ? "--rerun=always " : "";
  const base = basenameWithoutExtension(options.workingPath);
  return {
    stage_id: options.stageId,
    name: "pythontex",
    logical_path: options.logicalPath,
    working_path: options.workingPath,
    resource_key: options.resourceKey,
    command: `$(which {pythontex3,pythontex} | head -1) --jobs 2 ${rerun}'${base}'`,
    cwd: options.runDirectory ?? head,
    env: { MPLBACKEND: "Agg" },
    bash: true,
    timeout_s: options.timeoutS,
    required: true,
    job_key: `pythontex:${options.logicalPath}`,
    aggregate_key: options.force ? undefined : options.aggregateKey,
  };
}

export function parsePythontexDiagnostics(
  file: string,
  stdout: string,
): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  let current: BuildDiagnostic | undefined;
  for (const line of stdout.split("\n")) {
    if (line.search("PythonTeX stderr") > 0) {
      const match = line.match(/line (\d+):/);
      current = {
        level: "error",
        source: "pythontex",
        file,
        line: match == null ? undefined : parseInt(match[1], 10),
        message: line,
        content: "",
      };
      diagnostics.push(current);
      continue;
    }
    if (current != null) {
      if (line.startsWith("-----")) break;
      current.content = `${current.content ?? ""}${line}\n`;
    }
  }
  return diagnostics;
}
