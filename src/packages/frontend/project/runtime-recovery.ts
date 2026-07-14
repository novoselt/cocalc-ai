/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const PROJECT_RUNTIME_RECOVERY_EVENT = "runtime-recovery";

export interface RuntimeRecoveryNotice {
  id: string;
  reason: "host_session_changed" | "project_runtime_changed";
  occurred_at: number;
}

export function projectRuntimeId(status: unknown): string | undefined {
  if (status == null || typeof status !== "object") {
    return undefined;
  }
  const runtimeId = (status as { runtime_id?: unknown }).runtime_id;
  return typeof runtimeId === "string" && runtimeId.length > 0
    ? runtimeId
    : undefined;
}

export class ProjectRuntimeTracker {
  private runtimeId?: string;

  observe(status: unknown): string | undefined {
    const nextRuntimeId = projectRuntimeId(status);
    if (nextRuntimeId == null) {
      return undefined;
    }
    const changed =
      this.runtimeId != null && this.runtimeId !== nextRuntimeId
        ? nextRuntimeId
        : undefined;
    this.runtimeId = nextRuntimeId;
    return changed;
  }
}
