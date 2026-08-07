/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import getPool from "@cocalc/database/pool";
import type { ComputeVmRow, ComputeVolumeRow, ComputeWorkRow } from "./types";

const pool = () => getPool();
const MAX_COMPUTE_VM_SSH_KEYS = 32;
const MAX_COMPUTE_VM_SSH_KEY_METADATA_BYTES = 128 * 1024;

export async function insertComputeVm(
  row: Omit<
    ComputeVmRow,
    "created_at" | "updated_at" | "ready_at" | "stopped_at" | "deleted_at"
  >,
  limits?: {
    max_active_per_project: number;
    max_active_total: number;
  },
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
    if (limits) {
      // Serialize admission so concurrent creates cannot independently pass
      // the same project or site-wide capacity check.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('compute-vm-admission', 0))",
      );
      const { rows: projectRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM compute_vms
         WHERE project_id=$1 AND deleted_at IS NULL`,
        [row.project_id],
      );
      const { rows: totalRows } = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM compute_vms WHERE deleted_at IS NULL",
      );
      const projectCount = Number(projectRows[0]?.count ?? 0);
      const totalCount = Number(totalRows[0]?.count ?? 0);
      if (projectCount >= limits.max_active_per_project) {
        throw new Error(
          `managed compute VM project limit reached (${projectCount}/${limits.max_active_per_project})`,
        );
      }
      if (totalCount >= limits.max_active_total) {
        throw new Error(
          `managed compute VM site limit reached (${totalCount}/${limits.max_active_total})`,
        );
      }
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
         attached_volume_id, desired_state, instance_generation,
         provider_instance_id, public_ip, ssh_user, ssh_public_key, created_at,
         updated_at, expires_at,
         allow_on_demand_fallback, authorized_fallback_hours,
         spot_hourly_price, on_demand_hourly_price, authorized_cost,
         accrued_cost, billing_state, spot_recovery_policy,
         spot_recovery_state, idempotency_key, error, metadata
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
         $20,$21,$22,NOW(),NOW(),$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
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
        row.attached_volume_id ?? null,
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
    if (row.attached_volume_id) {
      const { rows: volumes } = await client.query<ComputeVolumeRow>(
        `SELECT * FROM compute_volumes
         WHERE id=$1 AND owner_account_id=$2 AND deleted_at IS NULL
         FOR UPDATE`,
        [row.attached_volume_id, row.owner_account_id],
      );
      const volume = volumes[0];
      if (!volume) throw new Error("compute volume not found or access denied");
      if (volume.zone !== row.zone) {
        throw new Error("compute volume and VM must be in the same zone");
      }
      if (volume.state !== "ready" || volume.desired_state !== "ready") {
        throw new Error(`compute volume is not ready (state=${volume.state})`);
      }
      if (volume.attached_vm_id && volume.attached_vm_id !== row.id) {
        throw new Error("compute volume is already reserved by another VM");
      }
      await client.query(
        `UPDATE compute_volumes
         SET attached_vm_id=$2, attachment_state='reserved',
             attachment_generation=attachment_generation+1, updated_at=NOW()
         WHERE id=$1`,
        [volume.id, row.id],
      );
    }
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

export async function listComputeVmsForBillingEnforcement() {
  const { rows } = await pool().query<ComputeVmRow>(
    `SELECT * FROM compute_vms
      WHERE deleted_at IS NULL
        AND desired_state <> 'deleted'
      ORDER BY owner_account_id, created_at`,
  );
  return rows;
}

export async function listComputeVmsForInventory() {
  const { rows } = await pool().query<ComputeVmRow>(
    `SELECT * FROM compute_vms
      WHERE deleted_at IS NULL
      ORDER BY created_at`,
  );
  return rows;
}

export async function listComputeVmsForEgressMetering() {
  const { rows } = await pool().query<ComputeVmRow>(
    `SELECT * FROM compute_vms
      WHERE deleted_at IS NULL
         OR COALESCE((metadata#>>'{billing,egress,finalized}')::boolean, FALSE) IS NOT TRUE
      ORDER BY created_at`,
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
    "expires_at",
    "billing_state",
    "billing_updated_at",
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

export async function addComputeVmSshPublicKey({
  id,
  owner_account_id,
  ssh_public_key,
}: {
  id: string;
  owner_account_id: string;
  ssh_public_key: string;
}): Promise<{ vm: ComputeVmRow; added: boolean }> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<ComputeVmRow>(
      "SELECT * FROM compute_vms " +
        "WHERE id=$1 AND owner_account_id=$2 AND deleted_at IS NULL " +
        "FOR UPDATE",
      [id, owner_account_id],
    );
    const vm = rows[0];
    if (!vm) {
      throw new Error("compute VM not found or access denied");
    }
    const sshPublicKeys = Array.from(
      new Set(
        [
          vm.ssh_public_key,
          ...(Array.isArray(vm.metadata?.ssh_public_keys)
            ? vm.metadata.ssh_public_keys
            : []),
        ]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean),
      ),
    );
    if (sshPublicKeys.includes(ssh_public_key)) {
      await client.query("COMMIT");
      return { vm, added: false };
    }
    if (sshPublicKeys.length >= MAX_COMPUTE_VM_SSH_KEYS) {
      throw new Error(
        "compute VM SSH key limit reached (" + MAX_COMPUTE_VM_SSH_KEYS + ")",
      );
    }
    const metadataBytes =
      sshPublicKeys.reduce((total, key) => total + Buffer.byteLength(key), 0) +
      Buffer.byteLength(ssh_public_key);
    if (metadataBytes > MAX_COMPUTE_VM_SSH_KEY_METADATA_BYTES) {
      throw new Error("compute VM SSH public key metadata is too large");
    }
    sshPublicKeys.push(ssh_public_key);
    const metadata = { ...vm.metadata, ssh_public_keys: sshPublicKeys };
    const updated = await client.query<ComputeVmRow>(
      "UPDATE compute_vms " +
        "SET metadata=$2::jsonb, updated_at=NOW() " +
        "WHERE id=$1 RETURNING *",
      [id, JSON.stringify(metadata)],
    );
    await client.query("COMMIT");
    return { vm: updated.rows[0]!, added: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
  resource_kind?: "vm" | "volume";
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
     SELECT $1,$7,$2,$3,$4,$5,'queued',0,$6,NOW(),NOW()
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
      opts.resource_kind ?? "vm",
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
      `SELECT work.* FROM compute_resource_work AS work
       WHERE work.state='queued'
         AND (work.not_before IS NULL OR work.not_before <= NOW())
         AND NOT EXISTS (
           SELECT 1 FROM compute_resource_work AS active
           WHERE active.resource_id=work.resource_id
             AND active.state='in_progress'
         )
         AND NOT EXISTS (
           SELECT 1 FROM compute_resource_work AS earlier
           WHERE earlier.resource_id=work.resource_id
             AND earlier.state='queued'
             AND (earlier.not_before IS NULL OR earlier.not_before <= NOW())
             AND (earlier.created_at, earlier.id) < (work.created_at, work.id)
         )
       ORDER BY work.created_at, work.id
       LIMIT $1 FOR UPDATE OF work SKIP LOCKED`,
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
       WHERE deleted_at IS NULL AND expires_at IS NOT NULL
         AND expires_at <= NOW()
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

export async function enqueueComputeEmergencyStops(limit = 100) {
  const { rows } = await pool().query<{ id: string }>(
    `UPDATE compute_vms
     SET desired_state='stopped', updated_at=NOW(),
         error='site-wide emergency stop requested'
     WHERE id IN (
       SELECT id FROM compute_vms
       WHERE deleted_at IS NULL AND desired_state='running'
       ORDER BY updated_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id`,
    [limit],
  );
  for (const { id } of rows) {
    await enqueueComputeWork({
      resource_id: id,
      action: "reconcile",
      idempotency_key: `emergency-stop:${id}:${Date.now()}`,
    });
  }
  return rows.length;
}

export async function enqueueComputeReconciliation(limit = 100) {
  const { rows } = await pool().query<{ id: string }>(
    `SELECT id FROM compute_vms
     WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
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
