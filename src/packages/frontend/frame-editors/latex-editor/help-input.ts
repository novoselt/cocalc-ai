/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

interface SyncstringLike {
  get_state?: () => string;
  to_str: () => string;
}

export function getLatexHelpInput(
  syncstring: SyncstringLike | undefined,
  line: number,
): string {
  try {
    if (syncstring?.get_state?.() !== "ready") return "";
    const value = syncstring.to_str();
    const excerpt = value
      .split("\n")
      .slice(0, line + 1)
      .join("\n");
    return `${excerpt}% this is line number ${line + 1}`;
  } catch {
    // The error UI can briefly outlive its syncstring during editor teardown.
    return "";
  }
}
