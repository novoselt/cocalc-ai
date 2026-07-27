import {
  projectRuntimeCapabilityError,
  projectRuntimeConfiguration,
  type ProjectRuntimeCapability,
  type ProjectRuntimeConfiguration,
} from "@cocalc/util/project-runtime";

export {
  PROJECT_RUNTIME_ENV,
  getProjectRuntimeMode,
  isWorkspaceProjectRuntime,
  type ProjectRuntimeMode,
} from "@cocalc/project-runner/runtime-mode";

import { getProjectRuntimeMode } from "@cocalc/project-runner/runtime-mode";

export function getProjectRuntimeConfiguration(): ProjectRuntimeConfiguration {
  return projectRuntimeConfiguration(getProjectRuntimeMode());
}

export function assertProjectRuntimeCapability(
  capability: ProjectRuntimeCapability,
): void {
  const runtime = getProjectRuntimeConfiguration();
  if (!runtime[capability]) {
    throw new Error(projectRuntimeCapabilityError(runtime, capability));
  }
}
