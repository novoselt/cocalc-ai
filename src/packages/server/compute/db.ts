/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import getPool from "@cocalc/database/pool";
import type { ComputeVmRow, ComputeWorkRow } from "./types";

const pool = () => getPool();

export async function insertComputeVm(
  row: Omit<
    ComputeVmRow,
    "created_at" | "updated_at" | "ready_at" | "stopped_at" | "deleted_at"
  >,
): Promise<ComputeVmRow> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<ComputeVmRow>(
      `SELECT * FROM compute_vms
       WHERE owner_account_id=$1 AND idempotency_key=$2
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [row.owner_account_id, row.idempotency_key],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return existing.rows[0];
    }
    const collision = await client.query(
      `SELECT id FROM compute_vms
       WHERE owner_account_id=$1 AND name=$2 AND deleted_at IS NULL
       LIMIT 1 FOR UPDATE`,
      [row.owner_account_id, row.name],
    );
    if (collision.rowCount) {
      throw new Error(`compute VM name '${row.name}' is already in use`);
    }
    const { rows } = await client.query<ComputeVmRow>(
      `INSERT INTO compute_vms (
         id, name, owner_account_id, owning_bay_id, project_id, provider,
         region, zone, architecture, machine_type, desired_pricing_model,
         effective_pricing_model, boot_disk_gb, boot_disk_id, state,
         desired_state, instance_generation, provider_instance_id, public_ip,
         ssh_user, ssh_public_key, created_at, updated_at, expires_at,
         allow_on_demand_fallback, authorized_fallback_hours,
         spot_hourly_price, on_demand_hourly_price, authorized_cost,
         accrued_cost, billing_state, spot_recovery_policy,
         spot_recovery_state, idempotency_key, error, metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,NOW(),NOW(),$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
       ) RETURNING *`,
      [
        row.id,
        row.name,
        row.owner_account_id,
        row.owning_bay_id,
        row.project_id,
        row.provider,
        row.region,
        row.zone,
        row.architecture,
        row.machine_type,
        row.desired_pricing_model,
        row.effective_pricing_model,
        row.boot_disk_gb,
        row.boot_disk_id,
        row.state,
        row.desired_state,
        row.instance_generation,
        row.provider_instance_id,
        row.public_ip ?? null,
        row.ssh_user,
        row.ssh_public_key,
        row.expires_at,
        row.allow_on_demand_fallback,
        row.authorized_fallback_hours,
        row.spot_hourly_price,
        row.on_demand_hourly_price,
        row.authorized_cost,
        row.accrued_cost,
        row.billing_state,
        row.spot_recovery_policy,
        row.spot_recovery_state,
        row.idempotency_key,
        row.error ?? null,
        row.metadata,
      ],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getComputeVmById(id: string) {
  const { rows } = await pool().query<ComputeVmRow>(
    "SELECT * FROM compute_vms WHERE id=$1",
    [id],
  );
  return rows[0];
}

export async function resolveOwnedComputeVm(opts: {
  owner_account_id: string;
  id_or_name: string;
  include_deleted?: boolean;
}) {
  const deletedClause = opts.include_deleted ? "" : "AND deleted_at IS NULL";
  const { rows } = await pool().query<ComputeVmRow>(
    `SELECT * FROM compute_vms
     WHERE owner_account_id=$1
       AND (id::text=$2 OR name=$2)
       ${deletedClause}
     ORDER BY created_at DESC LIMIT 1`,
    [opts.owner_account_id, opts.id_or_name],
  );
  return rows[0];
}

export async function listOwnedComputeVms(opts: {
  owner_account_id: string;
  project_id?: string;
  include_deleted?: boolean;
}) {
  const params: any[] = [opts.owner_account_id];
  let projectClause = "";
  if (opts.project_id) {
    params.push(opts.project_id);
    projectClause = `AND project_id=$${params.length}`;
  }
  const deletedClause = opts.include_deleted ? "" : "AND deleted_at IS NULL";
  const { rows } = await pool().query<ComputeVmRow>(
    `SELECT * FROM compute_vms
     WHERE owner_account_id=$1 ${projectClause} ${deletedClause}
     ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

export async function updateComputeVm(
  id: string,
  updates: Partial<ComputeVmRow>,
) {
  const allowed = new Set([
    "state",
    "desired_state",
    "effective_pricing_model",
    "public_ip",
    "ready_at",
    "stopped_at",
    "deleted_at",
    "error",
    "metadata",
    "spot_recovery_state",
  ]);
  const entries = Object.entries(updates).filter(([key]) => allowed.has(key));
  if (!entries.length) return await getComputeVmById(id);
  const values = entries.map(([, value]) => value);
  const assignments = entries.map(([key], index) => `${key}=$${index + 2}`);
  const { rows } = await pool().query<ComputeVmRow>(
    `UPDATE compute_vms SET ${assignments.join(", ")}, updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [id, ...values],
  );
  return rows[0];
}

export async function insertComputeInstance(vm: ComputeVmRow) {
  await pool().query(
    `INSERT INTO compute_vm_instances (
       id, vm_id, owner_account_id, owning_bay_id, project_id, generation,
       provider_instance_id, machine_type, pricing_model, public_ip,
       hourly_price, created_at
     )
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM compute_vm_instances WHERE vm_id=$2 AND generation=$6
     )`,
    [
      randomUUID(),
      vm.id,
      vm.owner_account_id,
      vm.owning_bay_id,
      vm.project_id,
      vm.instance_generation,
      vm.provider_instance_id,
      vm.machine_type,
      vm.effective_pricing_model,
      vm.public_ip ?? null,
      vm.effective_pricing_model === "spot"
        ? vm.spot_hourly_price
        : vm.on_demand_hourly_price,
    ],
  );
}

export async function updateComputeInstance(
  vm: ComputeVmRow,
  updates: {
    public_ip?: string | null;
    running?: boolean;
    ready?: boolean;
    stopped?: boolean;
    deleted?: boolean;
  },
) {
  const sets: string[] = [];
  const values: any[] = [vm.id, vm.instance_generation];
  const addValue = (sql: string, value: any) => {
    values.push(value);
    sets.push(`${sql}=$${values.length}`);
  };
  if (updates.public_ip !== undefined) {
    addValue("public_ip", updates.public_ip);
  }
  if (updates.running) sets.push("running_at=COALESCE(running_at,NOW())");
  if (updates.ready) sets.push("ready_at=COALESCE(ready_at,NOW())");
  if (updates.stopped) sets.push("stopped_at=COALESCE(stopped_at,NOW())");
  if (updates.deleted) sets.push("deleted_at=COALESCE(deleted_at,NOW())");
  if (!sets.length) return;
  await pool().query(
    `UPDATE compute_vm_instances SET ${sets.join(", ")}
     WHERE vm_id=$1 AND generation=$2`,
    values,
  );
}

export async function appendComputeEvent(opts: {
  vm: ComputeVmRow;
  actor_account_id?: string;
  actor_kind: string;
  action: string;
  idempotency_key: string;
  old_state?: string;
  new_state?: string;
  status: string;
  details?: Record<string, any>;
}) {
  await pool().query(
    `INSERT INTO compute_resource_events (
       id, resource_kind, resource_id, owner_account_id, project_id,
       actor_account_id, actor_kind, action, idempotency_key, old_state,
       new_state, status, details, created_at
     ) VALUES ($1,'vm',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
    [
      randomUUID(),
      opts.vm.id,
      opts.vm.owner_account_id,
      opts.vm.project_id,
      opts.actor_account_id ?? null,
      opts.actor_kind,
      opts.action,
      opts.idempotency_key,
      opts.old_state ?? null,
      opts.new_state ?? null,
      opts.status,
      opts.details ?? {},
    ],
  );
}

export async function enqueueComputeWork(opts: {
  resource_id: string;
  action: string;
  idempotency_key: string;
  payload?: Record<string, any>;
  not_before?: Date;
}) {
  const id = randomUUID();
  const { rowCount } = await pool().query(
    `INSERT INTO compute_resource_work (
       id, resource_kind, resource_id, action, idempotency_key, payload,
       state, attempt, not_before, created_at, updated_at
     )
     SELECT $1,'vm',$2,$3,$4,$5,'queued',0,$6,NOW(),NOW()
     WHERE NOT EXISTS (
       SELECT 1 FROM compute_resource_work
       WHERE resource_id=$2 AND action=$3 AND state IN ('queued','in_progress')
     )`,
    [
      id,
      opts.resource_id,
      opts.action,
      opts.idempotency_key,
      opts.payload ?? {},
      opts.not_before ?? null,
    ],
  );
  return rowCount ? id : undefined;
}

export async function claimComputeWork(opts: {
  worker_id: string;
  limit: number;
}) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE compute_resource_work
       SET state='queued', locked_by=NULL, locked_at=NULL,
           attempt=attempt+1, updated_at=NOW(), error='requeued stale work'
       WHERE state='in_progress' AND locked_at < NOW() - interval '10 minutes'`,
    );
    const { rows } = await client.query<ComputeWorkRow>(
      `SELECT * FROM compute_resource_work
       WHERE state='queued' AND (not_before IS NULL OR not_before <= NOW())
       ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [opts.limit],
    );
    if (rows.length) {
      await client.query(
        `UPDATE compute_resource_work
         SET state='in_progress', locked_by=$1, locked_at=NOW(), updated_at=NOW()
         WHERE id=ANY($2::uuid[])`,
        [opts.worker_id, rows.map(({ id }) => id)],
      );
    }
    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function finishComputeWork(opts: {
  id: string;
  state: "done" | "failed";
  error?: string;
}) {
  await pool().query(
    `UPDATE compute_resource_work
     SET state=$2, error=$3, locked_by=NULL, locked_at=NULL, updated_at=NOW()
     WHERE id=$1`,
    [opts.id, opts.state, opts.error?.slice(0, 4000) ?? null],
  );
}

export async function enqueueExpiredComputeVms(limit = 100) {
  const { rows } = await pool().query<{ id: string }>(
    `UPDATE compute_vms
     SET desired_state='deleted', state='deleting', updated_at=NOW(),
         error='lease expired'
     WHERE id IN (
       SELECT id FROM compute_vms
       WHERE deleted_at IS NULL AND expires_at <= NOW()
       ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
    [limit],
  );
  for (const { id } of rows) {
    await enqueueComputeWork({
      resource_id: id,
      action: "delete",
      idempotency_key: `expire:${id}`,
    });
  }
  return rows.length;
}

export async function enqueueComputeReconciliation(limit = 100) {
  const { rows } = await pool().query<{ id: string }>(
    `SELECT id FROM compute_vms
     WHERE deleted_at IS NULL AND expires_at > NOW()
     ORDER BY updated_at ASC LIMIT $1`,
    [limit],
  );
  for (const { id } of rows) {
    await enqueueComputeWork({
      resource_id: id,
      action: "reconcile",
      idempotency_key: `reconcile:${id}`,
    });
  }
  return rows.length;
}
