/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ProjectRuntimeMode } from "@cocalc/util/project-runtime";

export const PROJECT_RUNTIME_ENV = "COCALC_PROJECT_RUNTIME";

export type { ProjectRuntimeMode } from "@cocalc/util/project-runtime";

const VALID_PROJECT_RUNTIMES = new Set<ProjectRuntimeMode>([
  "external",
  "workspace",
  "podman",
]);

function isLaunchpadProduct(): boolean {
  return (
    `${process.env.COCALC_PRODUCT ?? "plus"}`.trim().toLowerCase() ===
    "launchpad"
  );
}

export function getProjectRuntimeMode(): ProjectRuntimeMode {
  const configured = `${process.env[PROJECT_RUNTIME_ENV] ?? ""}`
    .trim()
    .toLowerCase();
  const mode =
    configured ||
    (isLaunchpadProduct()
      ? ("external" satisfies ProjectRuntimeMode)
      : ("podman" satisfies ProjectRuntimeMode));
  if (!VALID_PROJECT_RUNTIMES.has(mode as ProjectRuntimeMode)) {
    throw new Error(
      `Invalid ${PROJECT_RUNTIME_ENV} '${process.env[PROJECT_RUNTIME_ENV]}'; expected external, workspace, or podman`,
    );
  }
  if (mode === "workspace" && !isLaunchpadProduct()) {
    throw new Error(
      `${PROJECT_RUNTIME_ENV}=workspace is only supported by Launchpad`,
    );
  }
  if (mode === "podman" && isLaunchpadProduct()) {
    throw new Error(
      `${PROJECT_RUNTIME_ENV}=podman is not supported inside Launchpad; use external or workspace`,
    );
  }
  return mode as ProjectRuntimeMode;
}

export function isWorkspaceProjectRuntime(): boolean {
  return getProjectRuntimeMode() === "workspace";
}
