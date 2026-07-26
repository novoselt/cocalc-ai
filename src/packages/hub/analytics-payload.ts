/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function normalizeAnalyticsPostPayload(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return;
  }
  const normalized = { ...(payload as Record<string, unknown>) };
  // Account attribution must come from the authenticated server session.
  delete normalized.account_id;
  delete normalized.account_link;
  return normalized;
}
