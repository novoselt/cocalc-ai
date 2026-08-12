/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { HostExamCleanupMode } from "@cocalc/conat/hub/api/hosts";

interface CleanupTiming {
  cleanup_mode: HostExamCleanupMode;
  now_ms?: number;
}

export function isExamCleanupDue({
  cleanup_mode,
  scheduled_stop_at_ms,
  now_ms = Date.now(),
}: CleanupTiming & { scheduled_stop_at_ms: number }): boolean {
  return cleanup_mode === "scheduled" && scheduled_stop_at_ms <= now_ms;
}

export function isExamSessionExpired({
  cleanup_mode,
  cleanup_deadline_at_ms,
  now_ms = Date.now(),
}: CleanupTiming & { cleanup_deadline_at_ms: number }): boolean {
  return cleanup_mode === "scheduled" && cleanup_deadline_at_ms <= now_ms;
}
