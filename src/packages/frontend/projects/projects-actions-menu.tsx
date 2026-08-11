/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Suspense, useState } from "react";

import { lazyWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import { CocalcErrorBoundary } from "@cocalc/frontend/app/error-boundary";
import { ensureProjectReduxRuntime } from "@cocalc/frontend/app-framework/project-runtime";
import { Icon } from "@cocalc/frontend/components";

import type { ProjectActionsMenuProps } from "./projects-actions-menu-content";

const ProjectActionsMenuContent = lazyWithRetry<ProjectActionsMenuProps>(
  async () => {
    const [, content] = await Promise.all([
      ensureProjectReduxRuntime(),
      import("./projects-actions-menu-content"),
    ]);
    return { default: content.ProjectActionsMenuContent };
  },
  "project actions menu",
);

export function ProjectActionsMenu(props: ProjectActionsMenuProps) {
  const [hydrated, setHydrated] = useState(false);

  if (!hydrated) {
    return (
      <div
        onClick={(event) => {
          event.stopPropagation();
          setHydrated(true);
        }}
        style={{ cursor: "pointer" }}
      >
        <span style={{ fontSize: "18px", padding: "4px 8px" }}>
          <Icon name="ellipsis" rotate="90" />
        </span>
      </div>
    );
  }

  return (
    <CocalcErrorBoundary
      autoRetry={false}
      resetKeys={[props.record.project_id]}
      scope="projects.actions-menu"
    >
      <Suspense fallback={<Icon name="spinner" spin />}>
        <ProjectActionsMenuContent {...props} />
      </Suspense>
    </CocalcErrorBoundary>
  );
}
