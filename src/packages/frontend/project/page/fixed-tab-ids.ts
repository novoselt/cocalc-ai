/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const FIXED_PROJECT_TAB_NAMES = [
  "workspaces",
  "active",
  "agents",
  "docs",
  "files",
  "new",
  "rootfs",
  "log",
  "search",
  "servers",
  "settings",
  "vms",
  "info",
  "users",
] as const;

export type FixedTab = (typeof FIXED_PROJECT_TAB_NAMES)[number];

const FIXED_PROJECT_TAB_SET = new Set<string>(FIXED_PROJECT_TAB_NAMES);
const LITE_UNAVAILABLE_FIXED_TABS = new Set<FixedTab>([
  "rootfs",
  "settings",
  "users",
  "vms",
]);

export function isFixedTab(tab?: unknown): tab is FixedTab {
  return typeof tab === "string" && FIXED_PROJECT_TAB_SET.has(tab);
}

export function isFixedTabAvailableInLite(tab: FixedTab): boolean {
  return !LITE_UNAVAILABLE_FIXED_TABS.has(tab);
}
