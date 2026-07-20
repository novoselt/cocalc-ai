/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { conat } from "@cocalc/backend/conat";
import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import { promoteProjectHostRuntimeDeployments } from "@cocalc/database/postgres/project-host-runtime-deployments";
import type { LroSummary } from "@cocalc/conat/hub/api/lro";
import {
  getHostRuntimeDeploymentStatus,
  upgradeHostSoftware,
} from "@cocalc/server/conat/api/hosts";
import { computeHostOperationalAvailability } from "@cocalc/server/conat/api/hosts-normalization";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import {
  claimLroOps,
  getLro,
  touchLro,
  updateLro,
} from "@cocalc/server/lro/lro-db";
import { publishLroEvent, publishLroSummary } from "@cocalc/server/lro/stream";
import { waitForDurableLroCompletion } from "@cocalc/server/lro/wait";

const logger = getLogger("server:hosts:runtime-fleet-rollout-worker");
const KIND = "host-runtime-fleet-rollout";
const OWNER_TYPE = "hub" as const;
const OWNER_ID = randomUUID();
const LEASE_MS = 120_000;
const HEARTBEAT_MS = 15_000;
const TICK_MS = 5_000;
const CHILD_TIMEOUT_MS = 20 * 60_000;
const STABILITY_POLL_MS = 5_000;

type RolloutHostResult = {
  host_id: string;
  status: "succeeded" | "failed";
  child_op_id?: string;
  started_at: string;
  finished_at: string;
  stabilization_seconds: number;
  error?: string;
};

type RolloutWave = {
  ids: string[];
  stabilize_seconds: number;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function projectHostObservationIsStable({
  status,
  version,
}: {
  status: Awaited<ReturnType<typeof getHostRuntimeDeploymentStatus>>;
  version: string;
}): boolean {
  if (`${status.observation_error ?? ""}`.trim()) return false;
  const artifact = (status.observed_artifacts ?? []).find(
    (entry) => entry.artifact === "project-host",
  );
  const component = (status.observed_components ?? []).find(
    (entry) => entry.component === "project-host",
  );
  const rollout = status.observed_host_agent?.project_host?.rollout;
  return (
    artifact?.current_version === version &&
    component?.runtime_state === "running" &&
    component.version_state === "aligned" &&
    rollout?.target_version === version &&
    rollout?.running_version === version &&
    rollout?.healthy === true &&
    rollout?.phase === "promoted"
  );
}

async function waitForStableProjectHost({
  account_id,
  host_id,
  version,
  stabilize_seconds,
  shouldCancel,
}: {
  account_id: string;
  host_id: string;
  version: string;
  stabilize_seconds: number;
  shouldCancel: () => Promise<boolean>;
}): Promise<void> {
  const requiredStableMs = stabilize_seconds * 1000;
  const deadline =
    Date.now() + Math.max(3 * 60_000, requiredStableMs + 2 * 60_000);
  let stableSince: number | undefined;
  let lastError = "project-host has not reported the target version";
  while (Date.now() <= deadline) {
    if (await shouldCancel()) {
      throw new Error("fleet rollout canceled");
    }
    try {
      const status = await getHostRuntimeDeploymentStatus({
        account_id,
        id: host_id,
      });
      if (projectHostObservationIsStable({ status, version })) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= requiredStableMs) return;
      } else {
        stableSince = undefined;
        lastError =
          status.observation_error ||
          `project-host has not converged to ${version}`;
      }
    } catch (err) {
      stableSince = undefined;
      lastError = `${err}`;
    }
    await delay(STABILITY_POLL_MS);
  }
  throw new Error(
    `host ${host_id} did not remain healthy for ${stabilize_seconds}s: ${lastError}`,
  );
}

async function runHostRollout({
  account_id,
  host_id,
  version,
  base_url,
  stabilize_seconds,
  shouldCancel,
}: {
  account_id: string;
  host_id: string;
  version: string;
  base_url?: string;
  stabilize_seconds: number;
  shouldCancel: () => Promise<boolean>;
}): Promise<RolloutHostResult> {
  const startedAt = new Date();
  let childOpId: string | undefined;
  try {
    const child = await upgradeHostSoftware({
      account_id,
      id: host_id,
      targets: [{ artifact: "project-host", version }],
      base_url,
      align_runtime_stack: false,
      record_runtime_deployments: true,
    });
    childOpId = child.op_id;
    const summary = await waitForDurableLroCompletion({
      op_id: child.op_id,
      scope_type: child.scope_type,
      scope_id: child.scope_id,
      client: conat(),
      timeout_ms: CHILD_TIMEOUT_MS,
    });
    if (summary.status !== "succeeded") {
      throw new Error(
        summary.error ?? `project-host child rollout ${summary.status}`,
      );
    }
    await waitForStableProjectHost({
      account_id,
      host_id,
      version,
      stabilize_seconds,
      shouldCancel,
    });
    return {
      host_id,
      status: "succeeded",
      child_op_id: childOpId,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      stabilization_seconds: stabilize_seconds,
    };
  } catch (err) {
    return {
      host_id,
      status: "failed",
      ...(childOpId ? { child_op_id: childOpId } : {}),
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      stabilization_seconds: stabilize_seconds,
      error: `${err instanceof Error ? err.message : err}`,
    };
  }
}

function completedResults(op: LroSummary): RolloutHostResult[] {
  const results = op.progress_summary?.hosts;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (result): result is RolloutHostResult =>
      !!result &&
      typeof result.host_id === "string" &&
      (result.status === "succeeded" || result.status === "failed"),
  );
}

function buildRolloutWaves({
  host_ids,
  completed_host_ids,
  canary_host_id,
  max_concurrent,
  canary_stabilize_seconds,
  stabilize_seconds,
}: {
  host_ids: string[];
  completed_host_ids: Set<string>;
  canary_host_id: string;
  max_concurrent: number;
  canary_stabilize_seconds: number;
  stabilize_seconds: number;
}): RolloutWave[] {
  const pending = host_ids.filter((hostId) => !completed_host_ids.has(hostId));
  const waves: RolloutWave[] = [];
  if (pending.includes(canary_host_id)) {
    waves.push({
      ids: [canary_host_id],
      stabilize_seconds: canary_stabilize_seconds,
    });
  }
  const remaining = pending.filter((hostId) => hostId !== canary_host_id);
  for (let i = 0; i < remaining.length; i += max_concurrent) {
    waves.push({
      ids: remaining.slice(i, i + max_concurrent),
      stabilize_seconds,
    });
  }
  return waves;
}

async function assertPromotionCohortStillComplete(
  hostIds: string[],
): Promise<void> {
  const { rows } = await getPool().query(
    `SELECT * FROM project_hosts WHERE deleted IS NULL`,
  );
  const localBayId = getConfiguredBayId();
  const cohort = new Set(hostIds);
  const omittedHealthyHosts = rows
    .filter((row) => {
      const bayId = `${row.bay_id ?? ""}`.trim();
      return (
        (!bayId || bayId === localBayId) &&
        !cohort.has(`${row.id}`) &&
        computeHostOperationalAvailability(row).operational
      );
    })
    .map((row) => `${row.name ?? row.id}`);
  if (omittedHealthyHosts.length) {
    throw new Error(
      `global promotion stopped because healthy local hosts joined outside the rollout cohort: ${omittedHealthyHosts.join(", ")}`,
    );
  }
}

async function handleRollout(op: LroSummary): Promise<void> {
  const input = op.input ?? {};
  const account_id = `${op.created_by ?? input.account_id ?? ""}`.trim();
  const hostIds: string[] = Array.from(
    new Set<string>(
      (Array.isArray(input.host_ids) ? input.host_ids : [])
        .map((id: unknown) => `${id ?? ""}`.trim())
        .filter(Boolean),
    ),
  );
  const version = `${input.version ?? ""}`.trim();
  const maxConcurrent = Math.max(
    1,
    Math.min(5, Math.floor(Number(input.max_concurrent) || 1)),
  );
  const canaryHostId = `${input.canary_host_id ?? hostIds[0] ?? ""}`.trim();
  const canaryStabilizeSeconds = Math.max(
    0,
    Math.floor(Number(input.canary_stabilize_seconds) || 0),
  );
  const stabilizeSeconds = Math.max(
    0,
    Math.floor(Number(input.stabilize_seconds) || 0),
  );
  if (!account_id || !hostIds.length || !version || !canaryHostId) {
    throw new Error("fleet rollout is missing account, hosts, or version");
  }

  const heartbeat = setInterval(() => {
    void touchLro({
      op_id: op.op_id,
      owner_type: OWNER_TYPE,
      owner_id: OWNER_ID,
    }).catch(() => undefined);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  const shouldCancel = async () =>
    (await getLro(op.op_id))?.status === "canceled";
  let results = completedResults(op).filter(
    (result) => result.status === "succeeded",
  );
  const resultByHost = new Map(
    results.map((result) => [result.host_id, result]),
  );

  const publishProgress = async ({
    phase,
    message,
    wave,
  }: {
    phase: string;
    message: string;
    wave?: string[];
  }) => {
    const progress = Math.floor((resultByHost.size / hostIds.length) * 100);
    const progress_summary = {
      phase,
      message,
      version,
      completed: resultByHost.size,
      total: hostIds.length,
      progress,
      hosts: Array.from(resultByHost.values()),
      ...(wave ? { wave } : {}),
    };
    const updated = await updateLro({
      op_id: op.op_id,
      status: "running",
      progress_summary,
      error: null,
    });
    if (updated)
      await publishLroSummary({
        scope_type: updated.scope_type,
        scope_id: updated.scope_id,
        summary: updated,
      });
    await publishLroEvent({
      scope_type: op.scope_type,
      scope_id: op.scope_id,
      op_id: op.op_id,
      event: {
        type: "progress",
        ts: Date.now(),
        phase,
        message,
        progress,
        detail: progress_summary,
      },
    }).catch(() => undefined);
  };

  try {
    await publishProgress({
      phase: "starting",
      message: `starting paced rollout of ${version}`,
    });
    const waves = buildRolloutWaves({
      host_ids: hostIds,
      completed_host_ids: new Set(resultByHost.keys()),
      canary_host_id: canaryHostId,
      max_concurrent: maxConcurrent,
      canary_stabilize_seconds: canaryStabilizeSeconds,
      stabilize_seconds: stabilizeSeconds,
    });

    for (const wave of waves) {
      if (await shouldCancel()) throw new Error("fleet rollout canceled");
      await publishProgress({
        phase:
          wave.ids.length === 1 && wave.ids[0] === canaryHostId
            ? "canary"
            : "wave",
        message: `rolling out ${wave.ids.join(", ")}`,
        wave: wave.ids,
      });
      const settled = await Promise.all(
        wave.ids.map((host_id) =>
          runHostRollout({
            account_id,
            host_id,
            version,
            base_url: `${input.base_url ?? ""}`.trim() || undefined,
            stabilize_seconds: wave.stabilize_seconds,
            shouldCancel,
          }),
        ),
      );
      for (const result of settled) resultByHost.set(result.host_id, result);
      results = Array.from(resultByHost.values());
      await publishProgress({
        phase: "wave_complete",
        message: `completed wave ${wave.ids.join(", ")}`,
        wave: wave.ids,
      });
      const failure = settled.find((result) => result.status === "failed");
      if (failure) {
        throw new Error(
          `fleet rollout paused after ${failure.host_id} failed: ${failure.error}`,
        );
      }
    }

    if (input.promote_global === true) {
      await publishProgress({
        phase: "promoting",
        message: "promoting successful rollout as the bay default",
      });
      await assertPromotionCohortStillComplete(hostIds);
      const metadata = {
        fleet_rollout_op_id: op.op_id,
        completed_at: new Date().toISOString(),
      };
      await promoteProjectHostRuntimeDeployments({
        host_ids: hostIds,
        requested_by: account_id,
        deployments: [
          {
            target_type: "artifact",
            target: "project-host",
            desired_version: version,
            rollout_reason: input.reason,
            metadata,
          },
          {
            target_type: "component",
            target: "project-host",
            desired_version: version,
            rollout_policy: "restart_now",
            rollout_reason: input.reason,
            metadata,
          },
        ],
      });
    }

    const result = {
      version,
      host_count: hostIds.length,
      promote_global: input.promote_global === true,
      hosts: results,
    };
    const updated = await updateLro({
      op_id: op.op_id,
      status: "succeeded",
      progress_summary: {
        phase: "done",
        message: "paced project-host rollout complete",
        completed: hostIds.length,
        total: hostIds.length,
        progress: 100,
        hosts: results,
      },
      result,
      error: null,
    });
    if (updated)
      await publishLroSummary({
        scope_type: updated.scope_type,
        scope_id: updated.scope_id,
        summary: updated,
      });
  } catch (err) {
    const latest = await getLro(op.op_id);
    const canceled = latest?.status === "canceled";
    const updated = await updateLro({
      op_id: op.op_id,
      status: canceled ? "canceled" : "failed",
      progress_summary: {
        phase: canceled ? "canceled" : "paused",
        message: `${err instanceof Error ? err.message : err}`,
        completed: Array.from(resultByHost.values()).filter(
          (result) => result.status === "succeeded",
        ).length,
        total: hostIds.length,
        hosts: Array.from(resultByHost.values()),
      },
      error: `${err instanceof Error ? err.message : err}`,
    });
    if (updated)
      await publishLroSummary({
        scope_type: updated.scope_type,
        scope_id: updated.scope_id,
        summary: updated,
      });
  } finally {
    clearInterval(heartbeat);
  }
}

let running = false;
let inFlight = false;

export function startHostRuntimeFleetRolloutWorker({
  intervalMs = TICK_MS,
}: {
  intervalMs?: number;
} = {}) {
  if (running) return () => undefined;
  running = true;
  const tick = async () => {
    if (inFlight) return;
    let ops: LroSummary[] = [];
    try {
      ops = await claimLroOps({
        kind: KIND,
        owner_type: OWNER_TYPE,
        owner_id: OWNER_ID,
        limit: 1,
        lease_ms: LEASE_MS,
      });
    } catch (err) {
      logger.warn("fleet rollout claim failed", { err: `${err}` });
      return;
    }
    for (const op of ops) {
      inFlight = true;
      void handleRollout(op)
        .catch(async (err) => {
          logger.error("fleet rollout worker failed", {
            op_id: op.op_id,
            err: `${err}`,
          });
          const updated = await updateLro({
            op_id: op.op_id,
            status: "failed",
            error: `${err}`,
          });
          if (updated)
            await publishLroSummary({
              scope_type: updated.scope_type,
              scope_id: updated.scope_id,
              summary: updated,
            });
        })
        .finally(() => {
          inFlight = false;
        });
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();
  return () => {
    clearInterval(timer);
    running = false;
    inFlight = false;
  };
}

export const __test__ = {
  buildRolloutWaves,
  projectHostObservationIsStable,
};
