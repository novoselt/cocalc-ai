/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { toText as ansiToText } from "./output-messages/ansi";

interface PromptStyle {
  primary: (executionCount?: number | null) => string;
  continuation: string;
}

interface IpynbCell {
  cell_type?: "code" | "markdown" | "raw";
  source?: string | string[];
  execution_count?: number | null;
  outputs?: any[];
}

export interface IpynbNotebook {
  cells?: IpynbCell[];
  metadata?: {
    kernelspec?: { name?: string; display_name?: string; language?: string };
    language_info?: { name?: string };
  };
}

function notebookIdentity(notebook: IpynbNotebook): string {
  const kernelspec = notebook.metadata?.kernelspec;
  return [
    kernelspec?.name,
    kernelspec?.display_name,
    kernelspec?.language,
    notebook.metadata?.language_info?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sourceToString(source: string | string[] | undefined): string {
  const value = Array.isArray(source) ? source.join("") : (source ?? "");
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function cleanTerminalText(value: unknown): string {
  const text = Array.isArray(value) ? value.join("") : `${value ?? ""}`;
  return ansiToText(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getPromptStyle(notebook: IpynbNotebook): PromptStyle {
  const identity = notebookIdentity(notebook);

  if (identity.includes("sage")) {
    return { primary: () => "sage: ", continuation: "....: " };
  }
  if (identity.includes("python")) {
    return { primary: () => ">>> ", continuation: "... " };
  }
  if (/\b(julia|ijulia)\b/.test(identity)) {
    return { primary: () => "julia> ", continuation: "       " };
  }
  if (/\b(octave|matlab)\b/.test(identity)) {
    return { primary: () => ">> ", continuation: "   " };
  }
  if (/\b(bash|shell|sh)\b/.test(identity)) {
    return { primary: () => "$ ", continuation: "> " };
  }
  if (/\b(gap|gap4)\b/.test(identity)) {
    return { primary: () => "gap> ", continuation: "> " };
  }
  if (/\b(pari|gp)\b/.test(identity)) {
    return { primary: () => "? ", continuation: "  " };
  }
  if (/\b(r|irkernel)\b/.test(identity)) {
    return { primary: () => "> ", continuation: "+ " };
  }
  if (/\b(sql|sqlite)\b/.test(identity)) {
    return { primary: () => "sql> ", continuation: "   > " };
  }
  return {
    primary: (executionCount) => `In [${executionCount ?? " "}]: `,
    continuation: "   ...: ",
  };
}

export function sessionLogSyntaxExtension(notebook: IpynbNotebook): string {
  const identity = notebookIdentity(notebook);
  if (identity.includes("sage") || identity.includes("python")) return "py";
  if (/\b(julia|ijulia)\b/.test(identity)) return "jl";
  if (/\b(octave|matlab)\b/.test(identity)) return "m";
  if (/\b(bash|shell|sh)\b/.test(identity)) return "sh";
  if (/\b(r|irkernel)\b/.test(identity)) return "r";
  if (/\b(sql|sqlite)\b/.test(identity)) return "sql";
  return "txt";
}

function formatInput(cell: IpynbCell, prompt: PromptStyle): string {
  const source = sourceToString(cell.source);
  const lines = source.split("\n");
  return lines
    .map((line, index) => {
      const prefix =
        index === 0
          ? prompt.primary(cell.execution_count)
          : prompt.continuation;
      return `${prefix}${line}`;
    })
    .join("\n");
}

function jsonText(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return;
  }
}

function dataOutputToText(data: unknown): string {
  if (data == null || typeof data !== "object") return "";
  const values = data as Record<string, unknown>;
  for (const mime of ["text/plain", "text/markdown", "text/latex"]) {
    if (values[mime] != null) {
      return cleanTerminalText(values[mime]);
    }
  }
  if (values["application/json"] != null) {
    return jsonText(values["application/json"]) ?? "[JSON output]";
  }
  const types = Object.keys(values);
  if (types.length === 0) return "";
  if (types.some((type) => type.includes("jupyter.widget"))) {
    return "[interactive widget output]";
  }
  if (types.every((type) => type.startsWith("image/"))) {
    return `[${types.join(", ")} output]`;
  }
  return `[${types.join(", ")} output]`;
}

function outputToText(output: any): { text: string; stream: boolean } {
  if (output?.traceback != null) {
    return {
      text: cleanTerminalText(
        Array.isArray(output.traceback)
          ? output.traceback.join("\n")
          : output.traceback,
      ),
      stream: false,
    };
  }
  if (output?.output_type === "error" || output?.ename != null) {
    const error = [output?.ename, output?.evalue].filter(Boolean).join(": ");
    return { text: cleanTerminalText(error), stream: false };
  }
  if (output?.output_type === "stream" || output?.text != null) {
    return { text: cleanTerminalText(output?.text), stream: true };
  }
  return { text: dataOutputToText(output?.data), stream: false };
}

function formatOutputs(outputs: any[] | undefined): string {
  let text = "";
  for (const output of outputs ?? []) {
    const rendered = outputToText(output);
    if (!rendered.text) continue;
    if (!rendered.stream && text && !text.endsWith("\n")) {
      text += "\n";
    }
    text += rendered.text;
    if (!rendered.stream && !text.endsWith("\n")) {
      text += "\n";
    }
  }
  return text.trimEnd();
}

function formatCommentCell(cell: IpynbCell, label: string): string {
  const source = sourceToString(cell.source);
  const lines = source.split("\n");
  return [`# [${label}]`, ...lines.map((line) => (line ? `# ${line}` : "#"))]
    .join("\n")
    .trimEnd();
}

export function notebookToSessionLog(notebook: IpynbNotebook): string {
  const prompt = getPromptStyle(notebook);
  const blocks: string[] = [];
  for (const cell of notebook.cells ?? []) {
    const source = sourceToString(cell.source);
    if (cell.cell_type === "markdown") {
      if (source) blocks.push(formatCommentCell(cell, "Markdown"));
      continue;
    }
    if (cell.cell_type === "raw") {
      if (source) blocks.push(formatCommentCell(cell, "Raw cell"));
      continue;
    }
    const input = formatInput(cell, prompt);
    const output = formatOutputs(cell.outputs);
    if (source === "" && output === "") continue;
    blocks.push(output ? `${input}\n${output}` : input);
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}
