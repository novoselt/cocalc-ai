/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  configureProjectToProjectSsh,
  readProjectDeployPublicKey,
  startSshSourceProject,
} from "@cocalc/frontend/project/settings/project-to-project-ssh-service";
import { webapp_client } from "@cocalc/frontend/webapp-client";

export async function configureNewCourseSshTarget({
  course_project_id,
  target_project_id,
  account_id,
}: {
  course_project_id: string;
  target_project_id: string;
  account_id?: string;
}): Promise<void> {
  if (account_id && account_id !== webapp_client.account_id) {
    throw new Error(
      "The course manager who enabled SSH access must synchronize this new project.",
    );
  }
  await startSshSourceProject(course_project_id);
  const publicKey = await readProjectDeployPublicKey(course_project_id);
  if (publicKey == null) {
    throw new Error(
      "The course SSH deploy key is missing. Open Course Configuration and synchronize SSH access.",
    );
  }
  await configureProjectToProjectSsh({
    source_project_id: course_project_id,
    target_project_id,
    public_key: publicKey,
  });
}
