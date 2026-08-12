/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fromJS, type Map } from "immutable";
import type { CourseInfo } from "@cocalc/util/db-schema/projects";
import {
  createProjectFieldState,
  getCachedProjectFieldValue,
} from "./use-project-field";

export type ProjectCourseInfoMap = Map<string, any>;
type ProjectCourseInfo = CourseInfo | null;

export const courseFieldState =
  createProjectFieldState<ProjectCourseInfoMap>("course");

export function normalizeCourseInfo(
  course?: ProjectCourseInfo,
): ProjectCourseInfoMap | null {
  if (course == null) {
    return null;
  }
  return fromJS(course) as ProjectCourseInfoMap;
}

export function getCachedProjectCourseInfo(
  project_id: string,
): ProjectCourseInfoMap | null | undefined {
  return getCachedProjectFieldValue({
    state: courseFieldState,
    project_id,
  });
}
