/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BuildArtifact, DocumentBuildRuntime } from "./contracts";
import { joinPath, path_split, replaceExtension } from "./path";

export function deriveMarkdownOutputFilename(
  path: string,
  extension: string,
): string {
  const { head, tail } = path_split(path);
  const filename = replaceExtension(tail, extension).replace(/ /g, "-");
  return joinPath(head, filename);
}

export async function deriveMarkdownArtifacts(
  path: string,
  runtime: DocumentBuildRuntime,
): Promise<BuildArtifact[]> {
  const candidates: Array<{
    extension: string;
    type: BuildArtifact["type"];
  }> = [
    { extension: "pdf", type: "pdf" },
    { extension: "html", type: "html" },
    { extension: "nb.html", type: "notebook-html" },
  ];
  const artifacts: BuildArtifact[] = [];
  for (const candidate of candidates) {
    const output = deriveMarkdownOutputFilename(path, candidate.extension);
    if (await runtime.exists(output)) {
      artifacts.push({ path: output, type: candidate.type });
    }
  }
  return artifacts;
}
