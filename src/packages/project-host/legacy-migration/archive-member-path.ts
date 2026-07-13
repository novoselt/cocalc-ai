/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import path from "node:path";

export function unsafeArchiveMemberPathReason(raw: string): string | undefined {
  if (!raw || raw === "." || raw === "./") return;
  if (raw.includes("\0")) return "path contains a NUL byte";
  if (path.posix.isAbsolute(raw)) return "path is absolute";
  // Project hosts are Linux systems. A backslash is a literal filename byte,
  // not a path separator; only reject actual POSIX parent components.
  if (raw.split("/").includes("..")) {
    return "path contains a parent-directory component";
  }
  return;
}

export function assertSafeArchiveMemberPath(raw: string): void {
  const reason = unsafeArchiveMemberPathReason(raw);
  if (reason) {
    throw new Error(`archive contains an unsafe path (${reason}): ${raw}`);
  }
}
