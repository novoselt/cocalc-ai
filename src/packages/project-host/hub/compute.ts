/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details.
 */

import callHub from "@cocalc/conat/hub/call-hub";
import { hubApi } from "@cocalc/lite/hub/api";
import { getMasterConatClient } from "../master-status";

function requireMasterClient() {
  const client = getMasterConatClient();
  if (!client) {
    throw new Error("master hub connection unavailable for compute SSH access");
  }
  return client;
}

function requireHostId() {
  const host_id = `${process.env.PROJECT_HOST_ID ?? ""}`.trim();
  if (!host_id) throw new Error("PROJECT_HOST_ID is required");
  return host_id;
}

export function wireComputeApi(): void {
  if (!hubApi.compute) {
    (hubApi as any).compute = {};
  }
  hubApi.compute.authorizeProjectSshKey = async (opts) => {
    return await callCentralCompute(
      "compute.authorizeProjectSshKeyFromHost",
      opts,
    );
  };
  hubApi.compute.listProjectVms = async (opts) =>
    await callCentralCompute("compute.listProjectVms", opts);
  hubApi.compute.getProjectVm = async (opts) =>
    await callCentralCompute("compute.getProjectVm", opts);
  hubApi.compute.listProjectVolumes = async (opts) =>
    await callCentralCompute("compute.listProjectVolumes", opts);
  hubApi.compute.getProjectVolume = async (opts) =>
    await callCentralCompute("compute.getProjectVolume", opts);
}

async function callCentralCompute(name: string, opts: unknown) {
  return await callHub({
    client: requireMasterClient(),
    host_id: requireHostId(),
    name,
    args: [opts],
  });
}
