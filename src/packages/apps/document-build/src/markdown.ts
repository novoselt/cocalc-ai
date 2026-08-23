/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function extractFrontmatter(source: string): string {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return "";
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---" || line === "...") {
      return lines.slice(1, i).join("\n");
    }
  }
  return "";
}
