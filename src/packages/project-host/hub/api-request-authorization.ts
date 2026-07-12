/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isProjectCollaboratorGroup } from "@cocalc/conat/auth/subject-policy";
import { ConatError } from "@cocalc/conat/util";
import type { HubApiRequestContext } from "@cocalc/lite/hub/api";
import { getRow } from "@cocalc/lite/hub/sqlite/database";
import { isValidUUID } from "@cocalc/util/misc";

export const ACCOUNT_PROJECT_HOST_HUB_METHODS = new Set([
  "projects.codexDeviceAuthStart",
  "projects.codexDeviceAuthStatus",
  "projects.codexDeviceAuthCancel",
  "projects.codexUploadAuthFile",
  "projects.getCodexUsageStatus",
  "projects.chatStoreStats",
  "projects.chatStoreRotate",
  "projects.chatStoreListSegments",
  "projects.chatStoreReadArchived",
  "projects.chatStoreReadArchivedHit",
  "projects.chatStoreSearch",
  "projects.chatStoreDelete",
  "projects.chatStoreVacuum",
]);

export const PROJECT_PROJECT_HOST_HUB_METHODS = new Set([
  "projects.getSshKeys",
  "system.assertProjectPublicSharingAllowed",
  "system.getProjectAppPublicPolicy",
  "system.reserveProjectAppPublicSubdomain",
  "system.releaseProjectAppPublicSubdomain",
  "system.getManagedProjectEgressPolicy",
  "system.recordManagedProjectEgress",
  "system.recordServiceAdmissionDenial",
  "system.recordServiceAdmissionNearLimit",
  "system.getServiceAdmissionConfig",
]);

function forbidden(message: string, subject: string): never {
  throw new ConatError(message, { code: 403, subject });
}

function projectIdFromArgs(args: any[]): string | undefined {
  const project_id = args?.[0]?.project_id;
  return typeof project_id === "string" && isValidUUID(project_id)
    ? project_id
    : undefined;
}

function isProjectCollaboratorLocal({
  account_id,
  project_id,
}: {
  account_id: string;
  project_id: string;
}): boolean {
  const row = getRow("projects", JSON.stringify({ project_id }));
  const userEntry = row?.users?.[account_id];
  const group = typeof userEntry === "string" ? userEntry : userEntry?.group;
  return isProjectCollaboratorGroup(group);
}

/**
 * Restrict the generic Lite hub API when it is embedded in project-host.
 * Trusted host-scoped callers retain the internal surface; account and project
 * identities get only the small set of methods needed by direct host routing.
 */
export function authorizeProjectHostHubApiRequest({
  subject,
  name,
  args,
  account_id,
  project_id,
  host_id,
}: HubApiRequestContext): void {
  if (host_id != null) {
    return;
  }

  if (account_id != null) {
    if (name === "system.ping") {
      return;
    }
    if (!ACCOUNT_PROJECT_HOST_HUB_METHODS.has(name)) {
      forbidden(
        "project-host hub API method is not available to account identities",
        subject,
      );
    }
    const targetProjectId = projectIdFromArgs(args);
    if (
      targetProjectId == null ||
      !isProjectCollaboratorLocal({
        account_id,
        project_id: targetProjectId,
      })
    ) {
      forbidden("not authorized for project", subject);
    }
    return;
  }

  if (project_id != null) {
    if (name === "system.ping") {
      return;
    }
    if (!PROJECT_PROJECT_HOST_HUB_METHODS.has(name)) {
      forbidden(
        "project-host hub API method is not available to project identities",
        subject,
      );
    }
    if (projectIdFromArgs(args) !== project_id) {
      forbidden(
        "project-host hub API request project does not match subject",
        subject,
      );
    }
    return;
  }

  forbidden("project-host hub API request has no authorized identity", subject);
}
