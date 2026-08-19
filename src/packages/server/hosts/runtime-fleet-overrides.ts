/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { ManagedComponentKind } from "@cocalc/conat/project-host/api";
import getPool from "@cocalc/database/pool";
import { ensureProjectHostRuntimeDeploymentsSchema } from "@cocalc/database/postgres/project-host-runtime-deployments";

export type RuntimeDeploymentTargetKey =
  | `artifact:${string}`
  | `component:${string}`;

export function runtimeFleetDeploymentTargetKeys(
  components: ManagedComponentKind[],
): RuntimeDeploymentTargetKey[] {
  return [
    ...(components.includes("project-host")
      ? (["artifact:project-host"] as const)
      : []),
    ...components.map(
      (component) => `component:${component}` as RuntimeDeploymentTargetKey,
    ),
  ];
}

export async function loadHostRuntimeDeploymentTargetKeys(
  hostIds: string[],
): Promise<Map<string, Set<RuntimeDeploymentTargetKey>>> {
  const uniqueHostIds = Array.from(
    new Set(hostIds.map((id) => `${id ?? ""}`.trim()).filter(Boolean)),
  );
  if (!uniqueHostIds.length) return new Map();
  await ensureProjectHostRuntimeDeploymentsSchema();
  const { rows } = await getPool().query<{
    host_id: string;
    target_type: "artifact" | "component";
    target: string;
  }>(
    `SELECT host_id::text AS host_id, target_type, target
     FROM project_host_runtime_deployments
     WHERE scope_type='host'
       AND host_id::text = ANY($1::text[])
     ORDER BY host_id, target_type, target`,
    [uniqueHostIds],
  );
  const result = new Map<string, Set<RuntimeDeploymentTargetKey>>();
  for (const row of rows) {
    const hostId = `${row.host_id ?? ""}`.trim();
    const target = `${row.target ?? ""}`.trim();
    if (!hostId || !target) continue;
    const keys = result.get(hostId) ?? new Set<RuntimeDeploymentTargetKey>();
    keys.add(`${row.target_type}:${target}`);
    result.set(hostId, keys);
  }
  return result;
}

export function hostOverridesAnyRolloutTarget({
  hostId,
  overrideKeysByHost,
  rolloutTargetKeys,
}: {
  hostId: string;
  overrideKeysByHost: Map<string, Set<RuntimeDeploymentTargetKey>>;
  rolloutTargetKeys: RuntimeDeploymentTargetKey[];
}): boolean {
  const overrides = overrideKeysByHost.get(hostId);
  return !!overrides && rolloutTargetKeys.some((key) => overrides.has(key));
}

export function hostOverridesEveryRolloutTarget({
  hostId,
  overrideKeysByHost,
  rolloutTargetKeys,
}: {
  hostId: string;
  overrideKeysByHost: Map<string, Set<RuntimeDeploymentTargetKey>>;
  rolloutTargetKeys: RuntimeDeploymentTargetKey[];
}): boolean {
  const overrides = overrideKeysByHost.get(hostId);
  return !!overrides && rolloutTargetKeys.every((key) => overrides.has(key));
}
