/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { shellJoin } from "@cocalc/frontend/frame-editors/ai/agent-file-context";
import { path_split } from "@cocalc/util/misc";

// LaTeX logs report files relative to the main document's directory
// (e.g. "./paper.tex" or "chapters/intro.tex"); turn that into the
// project-relative path the agent can open.
export function resolveErrorFile(
  mainPath: string,
  file: string | undefined,
): string | undefined {
  const trimmed = `${file ?? ""}`.trim().replace(/^(\.\/)+/, "");
  if (!trimmed) return;
  if (trimmed.startsWith("/")) return trimmed;
  const head = path_split(mainPath).head;
  return head ? `${head}/${trimmed}` : trimmed;
}

// The configured LaTeX build command as one shell line (the store keeps it
// either as a full command string or as an immutable list of argv entries).
export function latexBuildCommandString(build_command: unknown): string {
  if (typeof build_command === "string") return build_command.trim();
  const list =
    typeof (build_command as any)?.toJS === "function"
      ? (build_command as any).toJS()
      : build_command;
  if (Array.isArray(list) && list.length > 0) {
    return shellJoin({
      command: `${list[0]}`,
      args: list.slice(1).map((x) => `${x}`),
    });
  }
  return "";
}
