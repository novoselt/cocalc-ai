/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const PROJECT_RUNTIME_RECOVERY_EVENT = "runtime-recovery";

export interface RuntimeRecoveryNotice {
  id: string;
  reason:
    | "host_session_changed"
    | "project_runtime_changed"
    | "project_runtime_lost";
  occurred_at: number;
  runtime_exit_reason?: string;
}

export function projectRuntimeExitReason(project: unknown): string | undefined {
  const state = (project as any)?.get?.("state") ?? (project as any)?.state;
  const reason =
    state?.get?.("runtime_exit_reason") ?? state?.runtime_exit_reason;
  return typeof reason === "string" && reason.length > 0 ? reason : undefined;
}

export function shouldRecoverFromProjectRuntimeExit(project: unknown): boolean {
  const reason = projectRuntimeExitReason(project);
  return reason === "container_missing" || reason === "host_pressure";
}

export function projectRuntimeExitKey(project: unknown): string | undefined {
  const reason = projectRuntimeExitReason(project);
  if (reason == null) {
    return undefined;
  }
  const state = (project as any)?.get?.("state") ?? (project as any)?.state;
  const time = state?.get?.("time") ?? state?.time ?? "";
  return `${reason}:${time}`;
}

export class ProjectRuntimeExitTracker {
  private exitKey?: string;

  observe(project: unknown): string | undefined {
    if (!shouldRecoverFromProjectRuntimeExit(project)) {
      return undefined;
    }
    const nextExitKey = projectRuntimeExitKey(project);
    if (nextExitKey == null || nextExitKey === this.exitKey) {
      return undefined;
    }
    this.exitKey = nextExitKey;
    return projectRuntimeExitReason(project);
  }
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

  reset(): void {
    this.runtimeId = undefined;
  }
}
