/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const CODEX_PROJECT_RESTART_HINT =
  "Restart this project from Project Settings to load the newer Codex version, then retry.";

export function isCodexUpgradeRequiredError(error: string): boolean {
  return `${error ?? ""}`
    .toLowerCase()
    .includes("requires a newer version of codex");
}

export function addCodexProjectRestartHint(error: string): string {
  const detail = `${error ?? ""}`;
  if (
    !isCodexUpgradeRequiredError(detail) ||
    detail.includes(CODEX_PROJECT_RESTART_HINT)
  ) {
    return detail;
  }
  return `${detail} ${CODEX_PROJECT_RESTART_HINT}`;
}
