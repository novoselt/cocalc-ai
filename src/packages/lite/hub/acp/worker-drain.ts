/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { AcpWorkerState } from "../sqlite/acp-workers";

export type DrainableAcpWorkerContext = {
  state: AcpWorkerState;
  exit_requested_at?: number | null;
  stop_reason?: string | null;
};

export function beginAcpWorkerDrain({
  context,
  reason,
  now = Date.now(),
}: {
  context: DrainableAcpWorkerContext;
  reason?: string | null;
  now?: number;
}): void {
  context.state = "draining";
  context.exit_requested_at ??= now;
  if (`${reason ?? ""}`.trim()) {
    context.stop_reason = reason ?? null;
  }
}
