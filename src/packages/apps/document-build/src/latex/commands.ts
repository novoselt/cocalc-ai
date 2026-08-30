/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { change_filename_extension } from "@cocalc/util/misc";

export const NO_OUTPUT_DIR = "(no output dir)";

export const LATEX_ENGINES = [
  "PDFLaTeX",
  `PDFLaTeX ${NO_OUTPUT_DIR}`,
  "PDFLaTeX (shell-escape)",
  "XeLaTeX",
  `XeLaTeX ${NO_OUTPUT_DIR}`,
  "LuaTex",
  `LuaTex ${NO_OUTPUT_DIR}`,
  "<disabled>",
] as const;

export type LatexEngine = (typeof LATEX_ENGINES)[number];
export type LatexBuildCommand = string | string[];

export function getLatexEngine(config: string): LatexEngine | undefined {
  switch (config.toLowerCase()) {
    case "latex":
    case "pdflatex":
      return "PDFLaTeX";
    case "xelatex":
    case "xetex":
      return "XeLaTeX";
    case "lua":
    case "luatex":
    case "lualatex":
      return "LuaTex";
    default:
      return undefined;
  }
}

function latexmkEngineFlag(engine: LatexEngine): string {
  switch (engine) {
    case "PDFLaTeX":
    case "PDFLaTeX (shell-escape)":
    case `PDFLaTeX ${NO_OUTPUT_DIR}`:
      return "pdf";
    case "XeLaTeX":
    case `XeLaTeX ${NO_OUTPUT_DIR}`:
      return "xelatex";
    case "LuaTex":
    case `LuaTex ${NO_OUTPUT_DIR}`:
      return "lualatex";
    default:
      return "pdf";
  }
}

export function buildLatexCommand(
  engine: LatexEngine,
  filename: string,
  knitr: boolean,
  outputDirectory?: string,
): string[] {
  if (engine === "<disabled>") return ["false;"];
  if (knitr) filename = change_filename_extension(filename, "tex");

  const command = ["latexmk"];
  if (engine === "PDFLaTeX (shell-escape)") {
    command.push("-e", "$pdflatex=q/pdflatex %O -shell-escape %S/");
    outputDirectory = undefined;
  }
  if (engine.endsWith(NO_OUTPUT_DIR)) outputDirectory = undefined;

  command.push(
    `-${latexmkEngineFlag(engine)}`,
    "-f",
    "-g",
    "-bibtex",
    "-deps",
    "-synctex=1",
    "-interaction=nonstopmode",
  );
  if (!knitr && outputDirectory != null) {
    command.push(`-output-directory=${outputDirectory}`);
  }
  command.push(filename);
  return command;
}

export function ensureTargetPathIsCorrect(
  command: string,
  filename: string,
): string {
  command = command.trim();
  const words = shellWordSpans(command);
  if (words.length < 2) {
    return command;
  }
  const target = words[words.length - 1];
  return `${command.slice(0, target.start)}${shellQuote(filename)}`;
}

function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

function shellWordSpans(
  command: string,
): Array<{ start: number; end: number }> {
  const words: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  let quote: "'" | '"' | undefined;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote != null) {
      if (char === quote) {
        quote = undefined;
      } else if (quote === '"' && char === "\\") {
        i += 1;
      }
      continue;
    }
    if (/\s/.test(char)) {
      if (start != null) {
        words.push({ start, end: i });
        start = undefined;
      }
      continue;
    }
    start ??= i;
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "\\") {
      i += 1;
    }
  }
  if (start != null) {
    words.push({ start, end: command.length });
  }
  return words;
}

export function sanitizeLatexCommandString(
  command: string,
  filename: string,
  outputDirectory?: string,
): string {
  if (command.includes(";")) return command;

  const outputFlag = "-output-directory=";
  const outputIndex = command.indexOf(outputFlag);
  if (outputIndex !== -1) {
    let end = command.indexOf(" ", outputIndex);
    if (end === -1) end = command.length;
    if (outputDirectory != null) {
      if (
        command.slice(outputIndex + outputFlag.length, end) !== outputDirectory
      ) {
        command = `${command.slice(0, outputIndex)}${outputFlag}${outputDirectory} ${command.slice(end)}`;
      }
    } else {
      command = command.slice(0, outputIndex) + command.slice(end);
    }
  }

  command = ensureTargetPathIsCorrect(command, filename);
  if (!command.trim().startsWith("latexmk")) return command;
  for (const bad of [" -dependents- ", " -deps- "]) {
    command = command.replace(bad, " ");
  }
  if (command.includes(" -deps ")) return command;
  const parts = command.split(" ");
  parts.splice(2, 0, "-deps");
  return parts.join(" ");
}

export function sanitizeLatexCommandArray(
  value: readonly string[],
  filename: string,
  outputDirectory?: string,
): string[] {
  const command = value.slice();
  if (command[0]?.startsWith("false")) return command;

  const outputIndex = command.findIndex((part) =>
    part.startsWith("-output-directory="),
  );
  if (outputIndex !== -1) {
    if (outputDirectory == null) {
      command.splice(outputIndex, 1);
    } else {
      command[outputIndex] = `-output-directory=${outputDirectory}`;
    }
  }

  for (const bad of ["-dependents-", "-deps-"]) {
    const index = command.indexOf(bad);
    if (index !== -1) command.splice(index, 1);
  }
  if (!command.some((part) => part === "-deps" || part === "-dependents")) {
    command.splice(3, 0, "-deps");
  }
  if (command.length > 0 && command[command.length - 1] !== filename) {
    command[command.length - 1] = filename;
  }
  return command;
}

export function sanitizeLatexBuildCommand(
  command: LatexBuildCommand,
  filename: string,
  outputDirectory?: string,
): LatexBuildCommand {
  return typeof command === "string"
    ? sanitizeLatexCommandString(command, filename, outputDirectory)
    : sanitizeLatexCommandArray(command, filename, outputDirectory);
}

export function withoutLatexOutputDirectory(
  command: LatexBuildCommand,
  outputDirectory?: string,
): LatexBuildCommand {
  if (typeof command !== "string") {
    return command.filter((part) => !part.startsWith("-output-directory="));
  }
  const exact =
    outputDirectory == null
      ? undefined
      : `-output-directory=${outputDirectory}`;
  if (exact != null && command.includes(exact)) {
    return command.replace(exact, "");
  }
  return command.replace(/-output-directory=(?:'[^']*'|"[^"]*"|\S+)/, "");
}

export function commandSpec(command: LatexBuildCommand): {
  command: string;
  args?: string[];
  bash: boolean;
} {
  if (typeof command === "string") {
    return { command, bash: true };
  }
  return {
    command: command[0] ?? "false",
    args: command.slice(1),
    bash: false,
  };
}
