/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import type { Quota } from "@cocalc/util/upgrades/quota";

import { machineHasGpu } from "../cloud/host-gpu";

type HostRuntimePolicy = {
  tier?: number | null;
  metadata?: any;
};

function positiveFiniteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function applyHostRuntimePolicy({
  run_quota,
  host,
}: {
  run_quota?: Quota | null;
  host?: HostRuntimePolicy | null;
}): Quota {
  const quota: Quota = run_quota ? { ...run_quota } : {};
  if (!host) return quota;

  const metadata = host.metadata ?? {};
  if (machineHasGpu(metadata.machine ?? {})) {
    quota.gpu = true;
  } else {
    if (Object.prototype.hasOwnProperty.call(quota, "gpu")) {
      quota.gpu = false;
    }
    delete (quota as Record<string, unknown>).gpu_count;
  }

  const hostMemory = positiveFiniteNumber(
    metadata.resources?.project_ram_limit_mb,
  );
  if (hostMemory != null) {
    if (host.tier == null) {
      // A private host is itself the paid resource. Its owner-selected project
      // limit replaces membership RAM instead of merely capping it downward.
      quota.memory_limit = hostMemory;
    } else {
      // Shared-pool hosts must never grant RAM beyond project entitlement.
      const projectMemory = positiveFiniteNumber(quota.memory_limit);
      quota.memory_limit =
        projectMemory == null
          ? hostMemory
          : Math.min(projectMemory, hostMemory);
    }
  }
  return quota;
}

export async function applyHostRuntimePolicyToRunQuota(
  run_quota: Quota | null | undefined,
  host_id?: string | null,
): Promise<Quota> {
  if (!host_id) return run_quota ? { ...run_quota } : {};
  const { rows } = await getPool().query(
    "SELECT tier, metadata FROM project_hosts WHERE id=$1 AND deleted IS NULL",
    [host_id],
  );
  return applyHostRuntimePolicy({ run_quota, host: rows[0] });
}
