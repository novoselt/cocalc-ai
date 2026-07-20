/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";

export const PROJECT_HOST_UPGRADE_TRANSITION_DEADLINE_MS = 10 * 60_000;
export const PROJECT_HOST_UPGRADE_BANNER_SUPPRESSION_MS = 3 * 60_000;

export interface PlannedProjectHostRuntimeTransition {
  operation_id: string;
  component: "project-host";
  target_version?: string;
  previous_version?: string;
  reason?: string;
  started_at: string;
  deadline_at: string;
  banner_suppression_until: string;
}

function timestampMs(value: unknown): number {
  const ms = typeof value === "string" ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

export function getPlannedProjectHostRuntimeTransition(
  metadata: any,
): PlannedProjectHostRuntimeTransition | undefined {
  const transition =
    metadata?.runtime_deployments?.planned_project_host_transition;
  if (
    transition?.component !== "project-host" ||
    !`${transition?.operation_id ?? ""}`.trim() ||
    !timestampMs(transition?.started_at) ||
    !timestampMs(transition?.deadline_at)
  ) {
    return undefined;
  }
  return transition as PlannedProjectHostRuntimeTransition;
}

export function isPlannedProjectHostRuntimeTransitionActive(
  metadata: any,
  now = Date.now(),
): boolean {
  const transition = getPlannedProjectHostRuntimeTransition(metadata);
  return !!transition && timestampMs(transition.deadline_at) > now;
}

export function isProjectHostUpgradeBannerSuppressed(
  metadata: any,
  now = Date.now(),
): boolean {
  const transition = getPlannedProjectHostRuntimeTransition(metadata);
  return (
    !!transition &&
    timestampMs(transition.deadline_at) > now &&
    timestampMs(transition.banner_suppression_until) > now
  );
}

export async function beginPlannedProjectHostRuntimeTransition({
  host_id,
  operation_id,
  target_version,
  previous_version,
  reason,
  now = new Date(),
}: {
  host_id: string;
  operation_id: string;
  target_version?: string;
  previous_version?: string;
  reason?: string;
  now?: Date;
}): Promise<PlannedProjectHostRuntimeTransition> {
  const transition: PlannedProjectHostRuntimeTransition = {
    operation_id,
    component: "project-host",
    ...(target_version ? { target_version } : {}),
    ...(previous_version ? { previous_version } : {}),
    ...(reason ? { reason } : {}),
    started_at: now.toISOString(),
    deadline_at: new Date(
      now.getTime() + PROJECT_HOST_UPGRADE_TRANSITION_DEADLINE_MS,
    ).toISOString(),
    banner_suppression_until: new Date(
      now.getTime() + PROJECT_HOST_UPGRADE_BANNER_SUPPRESSION_MS,
    ).toISOString(),
  };
  await getPool().query(
    `
      UPDATE project_hosts
      SET metadata = jsonb_set(
            jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{runtime_deployments}',
              COALESCE(metadata->'runtime_deployments', '{}'::jsonb),
              true
            ),
            '{runtime_deployments,planned_project_host_transition}',
            $2::jsonb,
            true
          ),
          updated = NOW()
      WHERE id=$1 AND deleted IS NULL
    `,
    [host_id, JSON.stringify(transition)],
  );
  return transition;
}

export async function endPlannedProjectHostRuntimeTransition({
  host_id,
  operation_id,
}: {
  host_id: string;
  operation_id: string;
}): Promise<void> {
  await getPool().query(
    `
      UPDATE project_hosts
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{runtime_deployments}',
            COALESCE(metadata->'runtime_deployments', '{}'::jsonb)
              - 'planned_project_host_transition',
            true
          ),
          updated = NOW()
      WHERE id=$1
        AND deleted IS NULL
        AND metadata->'runtime_deployments'
              ->'planned_project_host_transition'->>'operation_id' = $2
    `,
    [host_id, operation_id],
  );
}
