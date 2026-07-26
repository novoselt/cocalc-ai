import { isLaunchpadProduct } from "@cocalc/server/launchpad/mode";

export const PROJECT_RUNTIME_ENV = "COCALC_PROJECT_RUNTIME";

export type ProjectRuntimeMode = "external" | "workspace" | "podman";

const VALID_PROJECT_RUNTIMES = new Set<ProjectRuntimeMode>([
  "external",
  "workspace",
  "podman",
]);

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
  return mode as ProjectRuntimeMode;
}

export function isWorkspaceProjectRuntime(): boolean {
  return getProjectRuntimeMode() === "workspace";
}
