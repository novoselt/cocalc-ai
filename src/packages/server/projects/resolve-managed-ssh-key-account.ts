/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getAssignedProjectHostInfo } from "@cocalc/server/conat/project-host-assignment";
import sshKeys from "@cocalc/server/projects/get-ssh-keys";

export default async function resolveManagedProjectSshKeyAccountForHost({
  host_id,
  project_id,
  fingerprint,
}: {
  host_id?: string;
  project_id: string;
  fingerprint: string;
}): Promise<{ account_id?: string }> {
  if (!host_id) {
    throw Error("must be a host");
  }
  const assigned = await getAssignedProjectHostInfo(project_id);
  if (!assigned.host_id || assigned.host_id !== host_id) {
    throw Error("project is not assigned to this host");
  }
  const keys = await sshKeys(project_id);
  const account_id = keys[fingerprint]?.account_id;
  return account_id ? { account_id } : {};
}
