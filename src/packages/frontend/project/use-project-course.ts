/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  useProjectMapField,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { isCollaboratorProjectRole } from "./realtime-access";
import { ensureProjectFieldValue, useProjectField } from "./use-project-field";
import {
  courseFieldState,
  normalizeCourseInfo,
  type ProjectCourseInfoMap,
} from "./course-info-state";

async function fetchProjectCourseInfo(
  project_id: string,
): Promise<ProjectCourseInfoMap | null> {
  return normalizeCourseInfo(
    await webapp_client.conat_client.hub.projects.getProjectCourseInfo({
      project_id,
    }),
  );
}

export async function ensureProjectCourseInfo(
  project_id: string,
): Promise<ProjectCourseInfoMap | null> {
  return await ensureProjectFieldValue({
    state: courseFieldState,
    project_id,
    fetch: fetchProjectCourseInfo,
  });
}

export function useProjectCourseInfo(
  project_id: string,
  initialCourse?: unknown,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const account_id = useTypedRedux("account", "account_id");
  const is_admin = !!useTypedRedux("account", "is_admin");
  const role = useProjectMapField<string>(project_id, [
    "users",
    account_id ?? "",
    "group",
  ]);
  const collaboratorEnabled =
    enabled && (is_admin || isCollaboratorProjectRole(role));
  const {
    value: course,
    refresh,
    setValue: setCourse,
  } = useProjectField({
    state: courseFieldState,
    project_id,
    projectMapField: "course",
    initialValue: initialCourse,
    fetch: fetchProjectCourseInfo,
    enabled: collaboratorEnabled,
  });

  return {
    course,
    refresh,
    setCourse,
  };
}
