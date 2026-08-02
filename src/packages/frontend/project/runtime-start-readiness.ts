/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { StartLroState } from "@cocalc/frontend/project/start-ops";

export type ProjectRuntimePreparation = {
  active: boolean;
  phase?: string;
};

export function normalizeStartLro(value: unknown): StartLroState | undefined {
  if (value == null) return undefined;
  const plain = (value as any)?.toJS?.() ?? value;
  return plain != null && typeof plain === "object"
    ? (plain as StartLroState)
    : undefined;
}

function isActiveStartLro(startLro?: StartLroState): boolean {
  return (
    startLro != null &&
    (!startLro.summary ||
      startLro.summary.status === "queued" ||
      startLro.summary.status === "running")
  );
}

export function getProjectRuntimePreparation({
  projectState,
  startLro: startLroValue,
}: {
  projectState?: string;
  startLro?: unknown;
}): ProjectRuntimePreparation {
  const state = `${projectState ?? ""}`.trim().toLowerCase();
  const startLro = normalizeStartLro(startLroValue);
  const phase = `${
    startLro?.last_progress?.phase ??
    startLro?.summary?.progress_summary?.phase ??
    ""
  }`
    .trim()
    .toLowerCase();

  // The running projection is authoritative once it arrives. Until then, an
  // active start LRO closes the gap before the lifecycle projection catches up.
  const active =
    state !== "running" &&
    (state === "starting" || state === "opening" || isActiveStartLro(startLro));
  return { active, phase: phase || undefined };
}

export function isProjectRuntimePreparing(opts: {
  projectState?: string;
  startLro?: unknown;
}): boolean {
  return getProjectRuntimePreparation(opts).active;
}
