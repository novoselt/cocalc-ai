/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { CoursePaymentOverview } from "@cocalc/conat/hub/api/projects";
import { webapp_client } from "@cocalc/frontend/webapp-client";

export async function getCoursePaymentOverview(opts: {
  course_project_id: string;
  student_project_ids: string[];
}): Promise<CoursePaymentOverview> {
  return await webapp_client.conat_client.hub.projects.getCoursePaymentOverview(
    opts,
  );
}
