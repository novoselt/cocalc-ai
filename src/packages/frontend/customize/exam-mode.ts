/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let configuredExamMode: boolean | undefined;
let resolveConfigured: ((examMode: boolean) => void) | undefined;
let configured = new Promise<boolean>((resolve) => {
  resolveConfigured = resolve;
});

export function setExamModeConfiguration(examMode: boolean): void {
  configuredExamMode = examMode;
  resolveConfigured?.(examMode);
  resolveConfigured = undefined;
}

export function isExamMode(): boolean {
  return configuredExamMode === true;
}

export async function waitForExamModeConfiguration(): Promise<boolean> {
  if (configuredExamMode != null) {
    return configuredExamMode;
  }
  return await configured;
}

export function resetExamModeConfigurationForTesting(): void {
  configuredExamMode = undefined;
  configured = new Promise<boolean>((resolve) => {
    resolveConfigured = resolve;
  });
}
