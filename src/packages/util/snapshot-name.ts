/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function assertValidSnapshotName(name: unknown): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("snapshot name must be a nonempty string");
  }
  if (
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new Error(`invalid snapshot name: ${JSON.stringify(name)}`);
  }
  return name;
}
