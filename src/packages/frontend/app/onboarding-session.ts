/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const FIRST_RUN_COMPLETED_SESSION_KEY = "cocalc:first-run-completed";

export function markFirstRunCompletedThisSession(): void {
  try {
    globalThis.sessionStorage?.setItem(FIRST_RUN_COMPLETED_SESSION_KEY, "1");
  } catch {
    // Storage may be disabled; onboarding must still complete normally.
  }
}

export function firstRunCompletedThisSession(): boolean {
  try {
    return (
      globalThis.sessionStorage?.getItem(FIRST_RUN_COMPLETED_SESSION_KEY) ===
      "1"
    );
  } catch {
    return false;
  }
}
