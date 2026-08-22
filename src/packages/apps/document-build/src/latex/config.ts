/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { SavedBuildConfig } from "../contracts";
import { path_split } from "../path";
import {
  buildLatexCommand,
  getLatexEngine,
  type LatexBuildCommand,
  sanitizeLatexBuildCommand,
} from "./commands";

export interface LatexDirectives {
  cocalc?: string;
  program?: string;
}

export interface ResolvedLatexBuildConfig {
  build_command: LatexBuildCommand;
  output_directory?: string;
  source: "cocalc-directive" | "saved" | "program-directive" | "default";
}

export class DocumentBuildConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentBuildConfigError";
  }
}

export function parseLatexDirectives(source: string): LatexDirectives {
  let cocalc: string | undefined;
  let program: string | undefined;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < Math.min(lines.length, 1000); i++) {
    const line = lines[i];
    if (!line.startsWith("%")) continue;
    const equals = line.indexOf("=");
    if (equals === -1) continue;
    const directive = line
      .slice(0, equals)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    const value = line.slice(equals + 1).trim();
    if (directive.startsWith("% !tex cocalc") && value) {
      cocalc = value;
      break;
    }
    if (
      (directive.startsWith("% !tex program") ||
        directive.startsWith("% !tex ts-program")) &&
      value
    ) {
      program = value;
    }
  }
  return { cocalc, program };
}

function validateSavedCommand(
  config?: SavedBuildConfig,
): LatexBuildCommand | undefined {
  const value = config?.build_command;
  if (value == null) return undefined;
  if (typeof value === "string") {
    if (!value.trim()) return undefined;
    return value;
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((part) => typeof part === "string" && part.length > 0)
  ) {
    return value.slice();
  }
  throw new DocumentBuildConfigError(
    "Saved LaTeX build_command must be a nonempty string or string array.",
  );
}

export function resolveLatexBuildConfig(options: {
  source: string;
  workingPath: string;
  knitr: boolean;
  saved?: SavedBuildConfig;
  outputDirectory?: string;
}): ResolvedLatexBuildConfig {
  const { source, workingPath, knitr, saved, outputDirectory } = options;
  const filename = path_split(workingPath).tail;
  const directives = parseLatexDirectives(source);

  if (directives.cocalc != null) {
    return {
      build_command: sanitizeLatexBuildCommand(
        directives.cocalc,
        filename,
        outputDirectory,
      ),
      output_directory: outputDirectory,
      source: "cocalc-directive",
    };
  }

  const savedCommand = validateSavedCommand(saved);
  if (savedCommand != null) {
    return {
      build_command: sanitizeLatexBuildCommand(
        savedCommand,
        filename,
        outputDirectory,
      ),
      output_directory: outputDirectory,
      source: "saved",
    };
  }

  const engine =
    directives.program == null ? undefined : getLatexEngine(directives.program);
  return {
    build_command: buildLatexCommand(
      engine ?? "PDFLaTeX",
      filename,
      knitr,
      outputDirectory,
    ),
    output_directory: outputDirectory,
    source: engine == null ? "default" : "program-directive",
  };
}
