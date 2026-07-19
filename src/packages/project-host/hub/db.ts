/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import callHub from "@cocalc/conat/hub/call-hub";
import { hubApi } from "@cocalc/lite/hub/api";
import { getMasterConatClient } from "../master-status";
import { getLocalHostId } from "../sqlite/hosts";

function requireMasterClient(name: string) {
  const client = getMasterConatClient();
  if (client == null) {
    throw Error(`master hub connection unavailable for '${name}'`);
  }
  return client;
}

async function forwardProjectDb(name: string, opts: { project_id?: string }) {
  if (!opts.project_id) {
    throw Error(`${name} requires project_id`);
  }
  const host_id =
    `${process.env.PROJECT_HOST_ID ?? ""}`.trim() || getLocalHostId();
  if (!host_id) {
    throw Error(`${name} requires host_id`);
  }
  return await callHub({
    client: requireMasterClient(name),
    host_id,
    name,
    args: [opts],
    timeout: 60_000,
  });
}

export function wireDbApi(): void {
  hubApi.db.getBlob = async (opts) =>
    await forwardProjectDb("db.getBlob", opts);
  hubApi.db.saveBlob = async (opts) =>
    await forwardProjectDb("db.saveBlob", opts);
}
