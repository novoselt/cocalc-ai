/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function normalizeCoursePath(path: string): string {
  const raw = `${path ?? ""}`.trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    throw new Error("invalid course path");
  }
  const parts: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw new Error("invalid course path");
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  const normalized = parts.join("/");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    !normalized.toLowerCase().endsWith(".course")
  ) {
    throw new Error("invalid course path");
  }
  return normalized;
}
