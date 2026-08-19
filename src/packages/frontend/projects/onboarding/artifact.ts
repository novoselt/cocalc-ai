/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { resolveProjectHomeDirectory } from "@cocalc/frontend/project/home-directory";
import { isProjectRootfsUnavailable } from "@cocalc/frontend/project/listing/project-host-errors";

import type { OnboardingProjectKind } from "./rootfs";

export type OnboardingArtifactCreation = {
  name: string;
  ext: string;
  current_path: string;
  switch_over: false;
  path: string;
};

export function onboardingArtifactRouteTarget(path: string): string {
  return `files/${path.replace(/^\/+/, "")}`;
}

export function onboardingArtifactCreation(
  kind: OnboardingProjectKind,
  homeDirectory: string,
): OnboardingArtifactCreation | undefined {
  let name: string;
  let ext: string;
  switch (kind) {
    case "jupyter-python":
    case "jupyter-r":
    case "jupyter-julia":
    case "sage":
      name = "Welcome";
      ext = "ipynb";
      break;
    case "code":
      name = "Terminal";
      ext = "term";
      break;
    case "latex":
      name = "document";
      ext = "tex";
      break;
    case "teaching":
      name = "Course";
      ext = "course";
      break;
    case "codex":
      return;
  }
  return {
    name,
    ext,
    current_path: homeDirectory,
    switch_over: false,
    path: `${homeDirectory.replace(/\/+$/, "")}/${name}.${ext}`,
  };
}

export async function onboardingArtifactCreationForProject({
  kind,
  project_id,
}: {
  kind: OnboardingProjectKind;
  project_id: string;
}): Promise<OnboardingArtifactCreation | undefined> {
  return onboardingArtifactCreation(
    kind,
    await resolveProjectHomeDirectory(project_id),
  );
}

export function isRetryableOnboardingArtifactError(error: unknown): boolean {
  return (
    isProjectRootfsUnavailable(error) ||
    /not running|closed|initializ|file server|connect|route/i.test(`${error}`)
  );
}
