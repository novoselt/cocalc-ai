/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { resolveProjectHomeDirectory } from "@cocalc/frontend/project/home-directory";

import type { OnboardingProjectKind } from "./rootfs";

export type OnboardingArtifactCreation = {
  name: string;
  ext: string;
  current_path: string;
  switch_over: false;
  relative_path: string;
};

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
    relative_path: `${name}.${ext}`,
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
