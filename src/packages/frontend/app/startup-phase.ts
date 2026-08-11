/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export type StartupPhaseDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

interface StartupTraceBridge {
  mark: (phase: string, details?: StartupPhaseDetails) => void;
}

const marked = new Set<string>();

function startupTrace(): StartupTraceBridge | undefined {
  return (globalThis as any).__COCALC_STARTUP_TRACE__;
}

export function markStartupPhase(
  phase: string,
  details?: StartupPhaseDetails,
): void {
  startupTrace()?.mark(phase, details);
}

export function markStartupPhaseOnce(
  phase: string,
  details?: StartupPhaseDetails,
): void {
  if (marked.has(phase)) return;
  marked.add(phase);
  markStartupPhase(phase, details);
}

export function resetStartupPhaseMarksForTests(): void {
  marked.clear();
}
