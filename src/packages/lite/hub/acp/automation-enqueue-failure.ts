/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { AcpAutomationRow } from "../sqlite/acp-automations";
import { computeNextAutomationRunAt } from "./automation-schedule";

export function automationAfterScheduledEnqueueFailure({
  row,
  error,
  nowMs,
  defaultPauseAfterRuns,
}: {
  row: AcpAutomationRow;
  error: unknown;
  nowMs: number;
  defaultPauseAfterRuns: number;
}): AcpAutomationRow {
  return {
    ...row,
    status: "error",
    next_run_at:
      computeNextAutomationRunAt(row, {
        nowMs,
        defaultPauseAfterRuns,
      }) ?? row.next_run_at,
    last_error: error instanceof Error ? error.message : `${error}`,
    updated_at: nowMs,
  };
}
