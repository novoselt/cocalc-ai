/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildDiagnostic, BuildStageSpec } from "../contracts";
import { path_split } from "../path";

const R_ARGS = ["--no-save", "--no-restore", "--quiet", "--no-readline", "-e"];

export function knitrStage(options: {
  stageId: string;
  logicalPath: string;
  workingPath: string;
  resourceKey: string;
  timeoutS: number;
  aggregateKey?: string | number;
}): BuildStageSpec {
  const { head, tail } = path_split(options.logicalPath);
  const expression = `require(knitr); opts_knit$set(concordance = TRUE, progress = FALSE); knit("${tail}")`;
  return {
    stage_id: options.stageId,
    name: "knitr",
    logical_path: options.logicalPath,
    working_path: options.workingPath,
    resource_key: options.resourceKey,
    command: "R",
    args: [...R_ARGS, expression],
    cwd: head,
    bash: false,
    timeout_s: options.timeoutS,
    required: true,
    job_key: `knitr:${options.logicalPath}`,
    aggregate_key: options.aggregateKey,
  };
}

export function patchSynctexStage(options: {
  stageId: string;
  logicalPath: string;
  workingPath: string;
  resourceKey: string;
  timeoutS: number;
  aggregateKey?: string | number;
}): BuildStageSpec {
  const { head, tail } = path_split(options.workingPath);
  const expression = `require(patchSynctex); patchSynctex("${tail}")`;
  return {
    stage_id: options.stageId,
    name: "patch-synctex",
    logical_path: options.logicalPath,
    working_path: options.workingPath,
    resource_key: options.resourceKey,
    command: "R",
    args: [...R_ARGS, expression],
    cwd: head,
    bash: false,
    timeout_s: options.timeoutS,
    required: false,
    job_key: `patch-synctex:${options.logicalPath}`,
    aggregate_key: options.aggregateKey,
  };
}

export function parseKnitrDiagnostics(stderr: string): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  let file = "";
  let current: BuildDiagnostic | undefined;
  for (const line of stderr.split("\n")) {
    if (line.startsWith("processing file:")) {
      file = line.slice("processing file:".length).trim();
    } else if (line.startsWith("Error")) {
      current = {
        level: "error",
        source: "knitr",
        file,
        message: line,
        content: "",
      };
      diagnostics.push(current);
      continue;
    } else if (line.endsWith("Warning message:")) {
      current = {
        level: "warning",
        source: "knitr",
        file,
        message: line,
        content: "",
      };
      diagnostics.push(current);
      continue;
    } else if (current != null && line.startsWith("Quitting from lines ")) {
      const match = line.slice("Quitting from lines ".length).match(/^(\d+)/);
      if (match != null) current.line = parseInt(match[1], 10);
    } else if (current != null && line.startsWith("Quitting from ")) {
      const match = line.match(/:(\d+)(?:[-–]\d+)?/);
      if (match != null) current.line = parseInt(match[1], 10);
    }
    if (current != null) current.content = `${current.content ?? ""}${line}\n`;
  }
  return diagnostics;
}
