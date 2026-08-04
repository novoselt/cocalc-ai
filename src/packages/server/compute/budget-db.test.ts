/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { after, before, getPool } from "@cocalc/server/test";
import {
  accrueComputeUsage,
  computeBudgetPeriodBounds,
  enforceComputeProjectBudgets,
  getComputeProjectBudgetSummary,
  setComputeProjectBudget,
} from "./budget-db";
import { insertComputeVm } from "./db";
import { insertComputeVolume } from "./volume-db";

beforeAll(async () => await before({ noConat: true }), 15_000);
afterAll(after);

beforeEach(async () => {
  await getPool().query("DELETE FROM compute_resource_work");
  await getPool().query("DELETE FROM compute_usage_charges");
  await getPool().query("DELETE FROM compute_project_budgets");
  await getPool().query("DELETE FROM compute_vm_instances");
  await getPool().query("DELETE FROM compute_vms");
  await getPool().query("DELETE FROM compute_volumes");
});

it("uses calendar UTC week and month boundaries", () => {
  const now = new Date("2026-08-05T12:34:56.000Z");
  expect(computeBudgetPeriodBounds("week", now)).toEqual({
    start: new Date("2026-08-03T00:00:00.000Z"),
    end: new Date("2026-08-10T00:00:00.000Z"),
  });
  expect(computeBudgetPeriodBounds("month", now)).toEqual({
    start: new Date("2026-08-01T00:00:00.000Z"),
    end: new Date("2026-09-01T00:00:00.000Z"),
  });
});

it("meters VM and volume intervals and deletes only VMs at the ceiling", async () => {
  const owner = randomUUID();
  const project = randomUUID();
  const vmId = randomUUID();
  const volumeId = randomUUID();
  await insertComputeVm({
    id: vmId,
    name: "budget-vm",
    owner_account_id: owner,
    owning_bay_id: "bay-0",
    project_id: project,
    provider: "gcp",
    region: "us-central1",
    zone: "us-central1-a",
    architecture: "x86_64",
    machine_type: "e2-standard-2",
    desired_pricing_model: "on_demand",
    effective_pricing_model: "on_demand",
    boot_disk_gb: 20,
    boot_disk_id: `budget-${vmId}-boot`,
    attached_volume_id: null,
    state: "ready",
    desired_state: "running",
    instance_generation: 1,
    provider_instance_id: `budget-${vmId}`,
    public_ip: null,
    ssh_user: "ubuntu",
    ssh_public_key: "ssh-ed25519 AAAATEST budget",
    expires_at: new Date("2026-08-06T00:00:00.000Z"),
    allow_on_demand_fallback: false,
    authorized_fallback_hours: 0,
    spot_hourly_price: "0.020000",
    on_demand_hourly_price: "0.068000",
    authorized_cost: "1.000000",
    accrued_cost: "0.000000",
    billing_state: "staging_admin_unbilled",
    spot_recovery_policy: {},
    spot_recovery_state: {},
    idempotency_key: randomUUID(),
    error: null,
    metadata: {},
  });
  await insertComputeVolume(
    {
      id: volumeId,
      name: "budget-volume",
      owner_account_id: owner,
      owning_bay_id: "bay-0",
      project_id: project,
      provider: "gcp",
      region: "us-central1",
      zone: "us-central1-a",
      disk_type: "balanced",
      filesystem: "ext4",
      size_gb: 20,
      desired_size_gb: 20,
      provider_disk_id: `budget-${volumeId}`,
      state: "ready",
      desired_state: "ready",
      attached_vm_id: null,
      attachment_generation: 0,
      attachment_state: "detached",
      monthly_price_per_gb: "0.100000",
      authorized_monthly_cost: "2.000000",
      billing_state: "staging_admin_unbilled",
      idempotency_key: randomUUID(),
      error: null,
      metadata: {},
    },
    2,
  );
  const startedAt = new Date("2026-08-05T10:00:00.000Z");
  const endedAt = new Date("2026-08-05T11:00:00.000Z");
  await getPool().query(
    "UPDATE compute_vms SET billing_updated_at=$2 WHERE id=$1",
    [vmId, startedAt],
  );
  await getPool().query(
    "UPDATE compute_volumes SET ready_at=$2, billing_updated_at=$2 WHERE id=$1",
    [volumeId, startedAt],
  );
  await setComputeProjectBudget({
    owner_account_id: owner,
    owning_bay_id: "bay-0",
    project_id: project,
    period: "month",
    limit_usd: 0.01,
  });

  expect(await accrueComputeUsage(endedAt)).toEqual({
    vm_charges: 1,
    volume_charges: 1,
  });
  const summary = await getComputeProjectBudgetSummary({
    owner_account_id: owner,
    project_id: project,
    now: endedAt,
  });
  expect(Number(summary?.spent_usd)).toBeCloseTo(0.070738, 5);
  expect(await enforceComputeProjectBudgets(endedAt)).toBe(1);

  const vm = await getPool().query(
    "SELECT desired_state FROM compute_vms WHERE id=$1",
    [vmId],
  );
  const volume = await getPool().query(
    "SELECT desired_state FROM compute_volumes WHERE id=$1",
    [volumeId],
  );
  expect(vm.rows[0].desired_state).toBe("deleted");
  expect(volume.rows[0].desired_state).toBe("ready");
});
