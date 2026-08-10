/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { LroStatus } from "@cocalc/conat/hub/api/lro";

export type LroTerminalStatus = Exclude<LroStatus, "queued" | "running">;

export const LRO_TERMINAL_STATUSES: ReadonlySet<LroStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
  "expired",
]);

export function isLroTerminalStatus(
  status?: string | null,
): status is LroTerminalStatus {
  return LRO_TERMINAL_STATUSES.has(status as LroTerminalStatus);
}
