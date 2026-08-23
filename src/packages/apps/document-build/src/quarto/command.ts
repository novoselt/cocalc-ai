/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildStageSpec } from "../contracts";
import { path_split } from "../path";

export function quartoRenderCommand(path: string): {
  command: string;
  args: string[];
} {
  return {
    command: "quarto",
    args: ["render", path_split(path).tail, "--log-level", "info"],
  };
}

export function quartoStage(options: {
  stageId: string;
  path: string;
  resourceKey: string;
  timeoutS: number;
  aggregateKey?: string | number;
}): BuildStageSpec {
  const command = quartoRenderCommand(options.path);
  return {
    stage_id: options.stageId,
    name: "quarto",
    logical_path: options.path,
    working_path: options.path,
    resource_key: options.resourceKey,
    command: command.command,
    args: command.args,
    cwd: path_split(options.path).head,
    bash: false,
    timeout_s: options.timeoutS,
    required: true,
    job_key: `qmd:${options.path}`,
    aggregate_key: options.aggregateKey,
  };
}
