/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";

import getPool from "@cocalc/database/pool";
import type {
  ComputeBudgetPeriod,
  ComputeProjectBudgetRow,
  ComputeProjectBudgetSummary,
  ComputeVmRow,
  ComputeVolumeRow,
} from "./types";
import { enqueueComputeWork } from "./db";

const pool = () => getPool();
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_STORAGE_MONTH = (365.25 * 24) / 12;

export function computeBudgetPeriodBounds(
  period: ComputeBudgetPeriod,
  now = new Date(),
) {
  const start = new Date(now);
  if (period === "month") {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
  }
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

export async function setComputeProjectBudget(opts: {
  owner_account_id: string;
  owning_bay_id: string;
  project_id: string;
  period: ComputeBudgetPeriod;
  limit_usd: number;
  enabled?: boolean;
}): Promise<ComputeProjectBudgetRow> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`compute-budget:${opts.owner_account_id}:${opts.project_id}`],
    );
    const { rows } = await client.query<ComputeProjectBudgetRow>(
      `INSERT INTO compute_project_budgets (
         id, owner_account_id, owning_bay_id, project_id, period,
         limit_usd, enabled, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        randomUUID(),
        opts.owner_account_id,
        opts.owning_bay_id,
        opts.project_id,
        opts.period,
        opts.limit_usd.toFixed(6),
        opts.enabled !== false,
      ],
    );
    let budget = rows[0];
    if (!budget) throw new Error("failed to create compute project budget");
    const existing = await client.query<ComputeProjectBudgetRow>(
      `SELECT * FROM compute_project_budgets
       WHERE owner_account_id=$1 AND project_id=$2 AND id<>$3
       ORDER BY created_at LIMIT 1 FOR UPDATE`,
      [opts.owner_account_id, opts.project_id, budget.id],
    );
    if (existing.rows[0]) {
      await client.query("DELETE FROM compute_project_budgets WHERE id=$1", [
        budget.id,
      ]);
      const updated = await client.query<ComputeProjectBudgetRow>(
        `UPDATE compute_project_budgets
         SET period=$3, limit_usd=$4, enabled=$5, updated_at=NOW()
         WHERE owner_account_id=$1 AND project_id=$2 RETURNING *`,
        [
          opts.owner_account_id,
          opts.project_id,
          opts.period,
          opts.limit_usd.toFixed(6),
          opts.enabled !== false,
        ],
      );
      budget = updated.rows[0];
    }
    await client.query("COMMIT");
    return budget;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getComputeProjectBudget(opts: {
  owner_account_id: string;
  project_id: string;
}): Promise<ComputeProjectBudgetRow | undefined> {
  const { rows } = await pool().query<ComputeProjectBudgetRow>(
    `SELECT * FROM compute_project_budgets
     WHERE owner_account_id=$1 AND project_id=$2
     ORDER BY created_at LIMIT 1`,
    [opts.owner_account_id, opts.project_id],
  );
  return rows[0];
}

export async function summarizeComputeProjectBudget(
  budget: ComputeProjectBudgetRow,
  now = new Date(),
): Promise<ComputeProjectBudgetSummary> {
  const { start, end } = computeBudgetPeriodBounds(budget.period, now);
  const { rows } = await pool().query<{ spent_usd: string }>(
    `SELECT COALESCE(SUM(
       amount_usd::numeric *
       EXTRACT(EPOCH FROM LEAST(ended_at, $4) - GREATEST(started_at, $3)) /
       NULLIF(EXTRACT(EPOCH FROM ended_at - started_at), 0)
     ), 0)::text AS spent_usd
     FROM compute_usage_charges
     WHERE owner_account_id=$1 AND project_id=$2
       AND ended_at > $3 AND started_at < $4`,
    [budget.owner_account_id, budget.project_id, start, end],
  );
  const spent = Number(rows[0]?.spent_usd ?? 0);
  const limit = Number(budget.limit_usd);
  return {
    ...budget,
    period_started_at: start,
    period_ends_at: end,
    spent_usd: spent.toFixed(6),
    remaining_usd: Math.max(0, limit - spent).toFixed(6),
  };
}

export async function getComputeProjectBudgetSummary(opts: {
  owner_account_id: string;
  project_id: string;
  now?: Date;
}): Promise<ComputeProjectBudgetSummary | undefined> {
  const budget = await getComputeProjectBudget(opts);
  return budget
    ? await summarizeComputeProjectBudget(budget, opts.now)
    : undefined;
}

function vmIsChargeable(vm: ComputeVmRow): boolean {
  return (
    vm.desired_state === "running" &&
    ["provisioning", "starting", "ready", "recovering"].includes(vm.state)
  );
}

async function appendCharge(
  client: any,
  opts: {
    owner_account_id: string;
    owning_bay_id: string;
    project_id: string;
    resource_kind: "vm" | "volume";
    resource_id: string;
    amount_usd: number;
    started_at: Date;
    ended_at: Date;
    details: Record<string, any>;
  },
) {
  if (opts.amount_usd <= 0 || opts.ended_at <= opts.started_at) return;
  await client.query(
    `INSERT INTO compute_usage_charges (
       id, owner_account_id, owning_bay_id, project_id, resource_kind,
       resource_id, amount_usd, started_at, ended_at, details, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())`,
    [
      randomUUID(),
      opts.owner_account_id,
      opts.owning_bay_id,
      opts.project_id,
      opts.resource_kind,
      opts.resource_id,
      opts.amount_usd.toFixed(9),
      opts.started_at,
      opts.ended_at,
      opts.details,
    ],
  );
}

export async function accrueComputeUsage(now = new Date(), limit = 200) {
  const client = await pool().connect();
  let vmCharges = 0;
  let volumeCharges = 0;
  try {
    await client.query("BEGIN");
    const vms = await client.query<ComputeVmRow>(
      `SELECT * FROM compute_vms
       WHERE deleted_at IS NULL
       ORDER BY COALESCE(billing_updated_at, created_at)
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const vm of vms.rows) {
      const startedAt = vm.billing_updated_at ?? vm.created_at;
      const elapsedHours = Math.max(
        0,
        (now.valueOf() - startedAt.valueOf()) / MILLISECONDS_PER_HOUR,
      );
      const hourlyPrice = Number(
        vm.effective_pricing_model === "spot"
          ? vm.spot_hourly_price
          : vm.on_demand_hourly_price,
      );
      const amount = vmIsChargeable(vm) ? elapsedHours * hourlyPrice : 0;
      await appendCharge(client, {
        owner_account_id: vm.owner_account_id,
        owning_bay_id: vm.owning_bay_id,
        project_id: vm.project_id,
        resource_kind: "vm",
        resource_id: vm.id,
        amount_usd: amount,
        started_at: startedAt,
        ended_at: now,
        details: {
          hourly_price: hourlyPrice.toFixed(6),
          pricing_model: vm.effective_pricing_model,
        },
      });
      await client.query(
        `UPDATE compute_vms
         SET billing_updated_at=$2,
             accrued_cost=(accrued_cost::numeric + $3::numeric)::text
         WHERE id=$1`,
        [vm.id, now, amount.toFixed(9)],
      );
      if (amount > 0) vmCharges++;
    }
    const volumes = await client.query<ComputeVolumeRow>(
      `SELECT * FROM compute_volumes
       WHERE deleted_at IS NULL AND ready_at IS NOT NULL AND project_id IS NOT NULL
       ORDER BY COALESCE(billing_updated_at, ready_at)
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const volume of volumes.rows) {
      const startedAt = volume.billing_updated_at ?? volume.ready_at!;
      const elapsedHours = Math.max(
        0,
        (now.valueOf() - startedAt.valueOf()) / MILLISECONDS_PER_HOUR,
      );
      const monthly = Number(volume.monthly_price_per_gb) * volume.size_gb;
      const amount = (elapsedHours * monthly) / HOURS_PER_STORAGE_MONTH;
      await appendCharge(client, {
        owner_account_id: volume.owner_account_id,
        owning_bay_id: volume.owning_bay_id,
        project_id: volume.project_id!,
        resource_kind: "volume",
        resource_id: volume.id,
        amount_usd: amount,
        started_at: startedAt,
        ended_at: now,
        details: {
          monthly_price_per_gb: volume.monthly_price_per_gb,
          size_gb: volume.size_gb,
        },
      });
      await client.query(
        "UPDATE compute_volumes SET billing_updated_at=$2 WHERE id=$1",
        [volume.id, now],
      );
      if (amount > 0) volumeCharges++;
    }
    await client.query("COMMIT");
    return { vm_charges: vmCharges, volume_charges: volumeCharges };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function enforceComputeProjectBudgets(now = new Date()) {
  const { rows: budgets } = await pool().query<ComputeProjectBudgetRow>(
    "SELECT * FROM compute_project_budgets WHERE enabled IS TRUE",
  );
  let deleted = 0;
  for (const budget of budgets) {
    const summary = await summarizeComputeProjectBudget(budget, now);
    if (Number(summary.spent_usd) < Number(summary.limit_usd)) continue;
    const { rows } = await pool().query<{ id: string }>(
      `UPDATE compute_vms
       SET desired_state='deleted', state='deleting', updated_at=NOW(),
           error='project compute budget exhausted'
       WHERE owner_account_id=$1 AND project_id=$2 AND deleted_at IS NULL
         AND desired_state<>'deleted'
       RETURNING id`,
      [budget.owner_account_id, budget.project_id],
    );
    for (const { id } of rows) {
      await enqueueComputeWork({
        resource_id: id,
        action: "delete",
        idempotency_key: `budget-exhausted:${id}:${summary.period_started_at.toISOString()}`,
      });
    }
    deleted += rows.length;
  }
  return deleted;
}
