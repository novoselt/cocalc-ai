/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { after, before, getPool } from "@cocalc/server/test";
import {
  claimComputeWork,
  enqueueComputeWork,
  enqueueExpiredComputeVms,
  finishComputeWork,
  insertComputeVm,
  listOwnedComputeVms,
} from "./db";
import type { ComputeVmRow } from "./types";

beforeAll(async () => await before({ noConat: true }), 15_000);
afterAll(after);

beforeEach(async () => {
  await getPool().query("DELETE FROM compute_resource_work");
  await getPool().query("DELETE FROM compute_resource_events");
  await getPool().query("DELETE FROM compute_vm_instances");
  await getPool().query("DELETE FROM compute_vms");
});

function vmInput(
  overrides: Partial<ComputeVmRow> = {},
): Parameters<typeof insertComputeVm>[0] {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    name: overrides.name ?? "test-vm",
    owner_account_id: overrides.owner_account_id ?? randomUUID(),
    owning_bay_id: "bay-0",
    project_id: overrides.project_id ?? randomUUID(),
    provider: "gcp",
    region: "us-central1",
    zone: "us-central1-a",
    architecture: "x86_64",
    machine_type: "e2-standard-2",
    desired_pricing_model: "on_demand",
    effective_pricing_model: "on_demand",
    boot_disk_gb: 20,
    boot_disk_id: `cocalc-vm-${id.slice(0, 8)}-boot`,
    state: "requested",
    desired_state: "running",
    instance_generation: 1,
    provider_instance_id: `cocalc-vm-${id.slice(0, 8)}`,
    public_ip: null,
    ssh_user: "ubuntu",
    ssh_public_key: "ssh-ed25519 AAAATEST owner",
    expires_at: overrides.expires_at ?? new Date(Date.now() + 60_000),
    allow_on_demand_fallback: false,
    authorized_fallback_hours: 0,
    spot_hourly_price: "0.020000",
    on_demand_hourly_price: "0.068000",
    authorized_cost: "1.000000",
    accrued_cost: "0.000000",
    billing_state: "staging_admin_unbilled",
    spot_recovery_policy: {},
    spot_recovery_state: {},
    idempotency_key: overrides.idempotency_key ?? randomUUID(),
    error: null,
    metadata: {},
  };
}

describe("compute VM durable state", () => {
  it("deduplicates owner-scoped create idempotency", async () => {
    const input = vmInput();
    const first = await insertComputeVm(input);
    const second = await insertComputeVm({
      ...input,
      id: randomUUID(),
      provider_instance_id: "must-not-be-inserted",
    });
    expect(second.id).toBe(first.id);
    expect(
      await listOwnedComputeVms({ owner_account_id: input.owner_account_id }),
    ).toHaveLength(1);
  });

  it("deduplicates active work and claims it with a worker lease", async () => {
    const vm = await insertComputeVm(vmInput());
    const first = await enqueueComputeWork({
      resource_id: vm.id,
      action: "provision",
      idempotency_key: "provision-1",
    });
    const duplicate = await enqueueComputeWork({
      resource_id: vm.id,
      action: "provision",
      idempotency_key: "provision-2",
    });
    expect(first).toBeTruthy();
    expect(duplicate).toBeUndefined();
    const claimed = await claimComputeWork({ worker_id: "worker-a", limit: 2 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      resource_id: vm.id,
      action: "provision",
      state: "queued",
    });
  });

  it("serializes different actions for one VM across workers", async () => {
    const firstVm = await insertComputeVm(vmInput({ name: "first-vm" }));
    const secondVm = await insertComputeVm(vmInput({ name: "second-vm" }));
    await enqueueComputeWork({
      resource_id: firstVm.id,
      action: "reconcile",
      idempotency_key: "first-reconcile",
    });
    await enqueueComputeWork({
      resource_id: firstVm.id,
      action: "stop",
      idempotency_key: "first-stop",
    });
    await enqueueComputeWork({
      resource_id: secondVm.id,
      action: "provision",
      idempotency_key: "second-provision",
    });

    const firstClaim = await claimComputeWork({
      worker_id: "worker-a",
      limit: 3,
    });
    expect(firstClaim).toHaveLength(2);
    expect(new Set(firstClaim.map(({ resource_id }) => resource_id))).toEqual(
      new Set([firstVm.id, secondVm.id]),
    );
    expect(await claimComputeWork({ worker_id: "worker-b", limit: 3 })).toEqual(
      [],
    );

    const claimedFirstVm = firstClaim.find(
      ({ resource_id }) => resource_id === firstVm.id,
    )!;
    await finishComputeWork({ id: claimedFirstVm.id, state: "done" });
    const nextClaim = await claimComputeWork({
      worker_id: "worker-b",
      limit: 3,
    });
    expect(nextClaim).toHaveLength(1);
    expect(nextClaim[0]).toMatchObject({
      resource_id: firstVm.id,
      action: "stop",
    });
  });

  it("turns an expired lease into durable delete work", async () => {
    const vm = await insertComputeVm(
      vmInput({ expires_at: new Date(Date.now() - 60_000) }),
    );
    expect(await enqueueExpiredComputeVms()).toBe(1);
    const current = await getPool().query(
      "SELECT state, desired_state FROM compute_vms WHERE id=$1",
      [vm.id],
    );
    expect(current.rows[0]).toEqual({
      state: "deleting",
      desired_state: "deleted",
    });
    const work = await getPool().query(
      "SELECT action, state FROM compute_resource_work WHERE resource_id=$1",
      [vm.id],
    );
    expect(work.rows).toEqual([{ action: "delete", state: "queued" }]);
  });
});
