/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// Helpers to describe *where* an agent request points at: the file (both
// project-relative and absolute, since agents run in the project with the
// full filesystem) and an optional 1-based line range. Agents have full
// project access, so a precise pointer is usually more valuable than pasting
// large amounts of content.

import { getProjectHomeDirectory } from "@cocalc/frontend/project/home-directory";
import { normalizeAbsolutePath } from "@cocalc/util/path-model";

export interface AgentFileLocation {
  // project-relative path as used by the frontend, e.g. "latex/paper.tex"
  path: string;
  // absolute path inside the project, e.g. "/home/user/latex/paper.tex"
  absolute_path: string;
  // 1-based line numbers (inclusive); line_end defaults to line
  line?: number;
  line_end?: number;
}

export function resolveAgentAbsolutePath(
  project_id: string | undefined,
  path: string,
): string {
  const trimmed = `${path ?? ""}`.trim();
  if (!trimmed) return "";
  try {
    return normalizeAbsolutePath(trimmed, getProjectHomeDirectory(project_id));
  } catch {
    return trimmed;
  }
}

export function agentFileLocation(opts: {
  project_id?: string;
  path: string;
  line?: number;
  line_end?: number;
}): AgentFileLocation {
  const path = `${opts.path ?? ""}`.trim();
  const loc: AgentFileLocation = {
    path,
    absolute_path: resolveAgentAbsolutePath(opts.project_id, path),
  };
  const line = normalizeLine(opts.line);
  if (line != null) {
    loc.line = line;
    const line_end = normalizeLine(opts.line_end);
    loc.line_end = line_end != null && line_end >= line ? line_end : line;
  }
  return loc;
}

function normalizeLine(line: number | undefined): number | undefined {
  if (typeof line !== "number" || !Number.isFinite(line) || line < 1) {
    return undefined;
  }
  return Math.floor(line);
}

// Human readable one-liner, e.g.
//   file `latex/paper.tex` (absolute path `/home/user/latex/paper.tex`), lines 12–30
export function describeAgentFileLocation(loc: AgentFileLocation): string {
  const parts: string[] = [];
  if (loc.path) {
    parts.push(`file \`${loc.path}\``);
    if (loc.absolute_path && loc.absolute_path !== loc.path) {
      parts.push(`(absolute path \`${loc.absolute_path}\`)`);
    }
  }
  const range = describeLineRange(loc);
  if (range) parts.push(range);
  return parts.join(" ");
}

export function describeLineRange(loc: {
  line?: number;
  line_end?: number;
}): string {
  if (loc.line == null) return "";
  if (loc.line_end != null && loc.line_end > loc.line) {
    return `lines ${loc.line}–${loc.line_end}`;
  }
  return `line ${loc.line}`;
}

export interface AgentBuildCommand {
  command: string;
  args: string[];
}

// Render {command, args} as one POSIX-shell line, single-quoting anything
// that is not a plain word, so e.g. an `-e 'rmarkdown::render("x.Rmd")'`
// argument survives intact.
export function shellJoin(cmd: AgentBuildCommand | undefined): string {
  if (!cmd?.command) return "";
  return [cmd.command, ...(cmd.args ?? [])]
    .map((x) => `${x}`)
    .map((x) =>
      /^[A-Za-z0-9_./:=@%+,-]+$/.test(x) ? x : `'${x.replace(/'/g, `'\\''`)}'`,
    )
    .join(" ");
}
