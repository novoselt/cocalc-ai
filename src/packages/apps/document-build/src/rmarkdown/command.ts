/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildStageSpec } from "../contracts";
import { path_split } from "../path";

export function rMarkdownRenderCommand(
  path: string,
  frontmatter: string,
): { command: string; args: string[] } {
  const input = path_split(path).tail;
  const explicitOutput =
    frontmatter.includes("self_contained") || frontmatter.includes("output:");
  const expression = explicitOutput
    ? `rmarkdown::render('${input}', output_format = NULL, run_pandoc = TRUE)`
    : `rmarkdown::render('${input}', output_format = NULL, run_pandoc = TRUE, output_options = list(self_contained = FALSE))`;
  return { command: "Rscript", args: ["-e", expression] };
}

export function rMarkdownStage(options: {
  stageId: string;
  path: string;
  resourceKey: string;
  frontmatter: string;
  timeoutS: number;
  aggregateKey?: string | number;
}): BuildStageSpec {
  const command = rMarkdownRenderCommand(options.path, options.frontmatter);
  return {
    stage_id: options.stageId,
    name: "r-markdown",
    logical_path: options.path,
    working_path: options.path,
    resource_key: options.resourceKey,
    command: command.command,
    args: command.args,
    cwd: path_split(options.path).head,
    env: { MPLBACKEND: "Agg" },
    bash: false,
    timeout_s: options.timeoutS,
    required: true,
    job_key: `rmd:${options.path}`,
    aggregate_key: options.aggregateKey,
  };
}
