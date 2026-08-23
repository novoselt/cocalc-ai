/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type ProjectsNavMode = "tabs" | "dropdown";

const PROJECT_NAV_MODE_KEY = "cocalc:projects-nav-mode";
const DEFAULT_PROJECT_NAV_MODE: ProjectsNavMode = "dropdown";

export function getStoredProjectsNavMode(): ProjectsNavMode {
  if (typeof window === "undefined") return DEFAULT_PROJECT_NAV_MODE;
  const stored = window.localStorage.getItem(PROJECT_NAV_MODE_KEY);
  return stored === "tabs" || stored === "dropdown"
    ? stored
    : DEFAULT_PROJECT_NAV_MODE;
}

export function storeProjectsNavMode(mode: ProjectsNavMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECT_NAV_MODE_KEY, mode);
}
