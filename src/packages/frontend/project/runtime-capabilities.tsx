/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert } from "antd";

import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import {
  projectRuntimeConfiguration,
  type ProjectRuntimeConfiguration,
} from "@cocalc/util/project-runtime";

function plainRuntimeConfiguration(
  value: unknown,
): ProjectRuntimeConfiguration | undefined {
  const plain = (value as any)?.toJS?.() ?? value;
  if (
    plain == null ||
    typeof plain !== "object" ||
    !["external", "podman", "workspace"].includes(`${(plain as any).mode}`)
  ) {
    return undefined;
  }
  return plain as ProjectRuntimeConfiguration;
}

export function getProjectRuntimeCapabilities(): ProjectRuntimeConfiguration {
  const configured = redux.getStore("customize")?.get("project_runtime");
  return (
    plainRuntimeConfiguration(configured) ??
    projectRuntimeConfiguration("external")
  );
}

export function useProjectRuntimeCapabilities(): ProjectRuntimeConfiguration {
  const configured = useTypedRedux("customize", "project_runtime");
  return (
    plainRuntimeConfiguration(configured) ??
    projectRuntimeConfiguration("external")
  );
}

export function WorkspaceRuntimeAdminWarning(): React.JSX.Element | null {
  const runtime = useProjectRuntimeCapabilities();
  const isAdmin = !!useTypedRedux("account", "is_admin");
  if (!runtime.trusted || !isAdmin) {
    return null;
  }
  return (
    <Alert
      type="warning"
      showIcon
      message="Trusted workspace runtime"
      description="Projects run directly as processes under the Launchpad service account. Use this only for trusted development: there is no container boundary, host placement, RootFS isolation, backup or snapshot service, SSH endpoint, GPU assignment, or enforced resource limit."
    />
  );
}
