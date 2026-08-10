/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function isReactDomMutationError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const { message, name } = error as { message?: unknown; name?: unknown };
  if (name !== "NotFoundError" || typeof message !== "string") return false;

  const normalized = message.toLowerCase();
  return (
    (normalized.includes("removechild") ||
      normalized.includes("insertbefore")) &&
    normalized.includes("not a child")
  );
}
