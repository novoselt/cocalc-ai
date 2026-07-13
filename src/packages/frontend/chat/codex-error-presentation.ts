/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const CODEX_PROJECT_RESTART_HINT =
  "Restart this project from Project Settings to load the newer Codex version, then retry.";

export const CODEX_PROJECT_RESTART_TITLE =
  "Restart this project to update Codex.";

export function isCodexUpgradeRequiredError(error: string): boolean {
  return `${error ?? ""}`
    .toLowerCase()
    .includes("requires a newer version of codex");
}

export function formatCodexErrorForDisplay(error: string): string {
  const detail = `${error ?? ""}`;
  if (!isCodexUpgradeRequiredError(detail)) {
    return detail;
  }
  return `${CODEX_PROJECT_RESTART_TITLE} ${CODEX_PROJECT_RESTART_HINT}`;
}

export function formatCodexErrorMarkdown(error: string): string {
  const detail = `${error ?? ""}`;
  if (!isCodexUpgradeRequiredError(detail)) {
    return detail;
  }
  return `**${CODEX_PROJECT_RESTART_TITLE}**\n\n${CODEX_PROJECT_RESTART_HINT}`;
}
