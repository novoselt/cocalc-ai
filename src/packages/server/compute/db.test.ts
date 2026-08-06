/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { after, before, getPool } from "@cocalc/server/test";
import {
  claimComputeWork,
  enqueueComputeWork,
  enqueueComputeEmergencyStops,
  enqueueExpiredComputeVms,
  enqueueComputeReconciliation,
  finishComputeWork,
  insertComputeVm,
  listOwnedComputeVms,
} from "./db";
import type { ComputeVmRow } from "./types";
import type { ComputeVolumeRow } from "./types";
import {
  getComputeVolumeById,
  insertComputeVolume,
  listOwnedComputeVolumes,
} from "./volume-db";

const postgresIt = process.env.COCALC_TEST_USE_PGLITE ? it.skip : it;

beforeAll(async () => await before({ noConat: true }), 15_000);
afterAll(after);

beforeEach(async () => {
  await getPool().query("DELETE FROM compute_resource_work");
  await getPool().query("DELETE FROM compute_resource_events");
  await getPool().query("DELETE FROM compute_vm_instances");
  await getPool().query("DELETE FROM compute_vms");
  await getPool().query("DELETE FROM compute_volumes");
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
    attached_volume_id: overrides.attached_volume_id ?? null,
    state: "requested",
    desired_state: "running",
    instance_generation: 1,
    provider_instance_id: `cocalc-vm-${id.slice(0, 8)}`,
    public_ip: null,
    ssh_user: "ubuntu",
    ssh_public_key: "ssh-ed25519 AAAATEST owner",
    expires_at: Object.prototype.hasOwnProperty.call(overrides, "expires_at")
      ? overrides.expires_at
      : new Date(Date.now() + 60_000),
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

function volumeInput(
  overrides: Partial<ComputeVolumeRow> = {},
): Parameters<typeof insertComputeVolume>[0] {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    name: overrides.name ?? "test-volume",
    owner_account_id: overrides.owner_account_id ?? randomUUID(),
    owning_bay_id: "bay-0",
    provider: "gcp",
    region: "us-central1",
    zone: overrides.zone ?? "us-central1-a",
    disk_type: "balanced",
    filesystem: "ext4",
    size_gb: overrides.size_gb ?? 20,
    desired_size_gb: overrides.desired_size_gb ?? 20,
    provider_disk_id: `cocalc-vol-${id.slice(0, 8)}`,
    state: overrides.state ?? "ready",
    desired_state: "ready",
    attached_vm_id: overrides.attached_vm_id ?? null,
    attachment_generation: 0,
    attachment_state: overrides.attachment_state ?? "detached",
    monthly_price_per_gb: "0.100000",
    authorized_monthly_cost: "2.000000",
    billing_state: "staging_admin_unbilled",
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

  it("enforces project admission limits without limiting the owner", async () => {
    const owner = randomUUID();
    const project = randomUUID();
    await insertComputeVm(
      vmInput({ owner_account_id: owner, project_id: project }),
      {
        max_active_per_project: 1,
        max_active_total: 10,
      },
    );
    await expect(
      insertComputeVm(
        vmInput({
          owner_account_id: owner,
          project_id: project,
          name: "second-vm",
        }),
        {
          max_active_per_project: 1,
          max_active_total: 10,
        },
      ),
    ).rejects.toThrow("project limit reached");
    await expect(
      insertComputeVm(
        vmInput({ owner_account_id: owner, name: "other-project" }),
        {
          max_active_per_project: 1,
          max_active_total: 10,
        },
      ),
    ).resolves.toMatchObject({ owner_account_id: owner });
  });

  postgresIt("serializes concurrent site-wide admission", async () => {
    const limits = { max_active_per_project: 10, max_active_total: 1 };
    const results = await Promise.allSettled([
      insertComputeVm(vmInput({ name: "first-vm" }), limits),
      insertComputeVm(vmInput({ name: "second-vm" }), limits),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(
      await getPool().query(
        "SELECT id FROM compute_vms WHERE deleted_at IS NULL",
      ),
    ).toHaveProperty("rowCount", 1);
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

  it("keeps budget-only VMs out of expiry while reconciling them", async () => {
    const vm = await insertComputeVm(vmInput({ expires_at: null }));
    expect(vm.expires_at).toBeNull();
    expect(await enqueueExpiredComputeVms()).toBe(0);
    expect(await enqueueComputeReconciliation()).toBe(1);
    const work = await getPool().query(
      "SELECT action, state FROM compute_resource_work WHERE resource_id=$1",
      [vm.id],
    );
    expect(work.rows).toEqual([{ action: "reconcile", state: "queued" }]);
  });

  it("turns running leases into durable emergency-stop reconciliation", async () => {
    const vm = await insertComputeVm(vmInput());
    expect(await enqueueComputeEmergencyStops()).toBe(1);
    const current = await getPool().query(
      "SELECT desired_state, error FROM compute_vms WHERE id=$1",
      [vm.id],
    );
    expect(current.rows[0]).toEqual({
      desired_state: "stopped",
      error: "site-wide emergency stop requested",
    });
    const work = await getPool().query(
      "SELECT action, state FROM compute_resource_work WHERE resource_id=$1",
      [vm.id],
    );
    expect(work.rows).toEqual([{ action: "reconcile", state: "queued" }]);
  });
});

describe("compute volume durable state", () => {
  it("deduplicates volume creation and enforces the account limit", async () => {
    const input = volumeInput();
    const first = await insertComputeVolume(input, 1);
    const duplicate = await insertComputeVolume(
      { ...input, id: randomUUID(), provider_disk_id: "must-not-exist" },
      1,
    );
    expect(duplicate.id).toBe(first.id);
    await expect(
      insertComputeVolume(
        volumeInput({
          owner_account_id: input.owner_account_id,
          name: "second-volume",
        }),
        1,
      ),
    ).rejects.toThrow("volume account limit reached");
    expect(
      await listOwnedComputeVolumes({
        owner_account_id: input.owner_account_id,
      }),
    ).toHaveLength(1);
  });

  it("atomically fences a volume to one VM", async () => {
    const owner = randomUUID();
    const volume = await insertComputeVolume(
      volumeInput({ owner_account_id: owner }),
      2,
    );
    const first = await insertComputeVm(
      vmInput({
        owner_account_id: owner,
        name: "first-vm",
        attached_volume_id: volume.id,
      }),
    );
    await expect(
      insertComputeVm(
        vmInput({
          owner_account_id: owner,
          name: "second-vm",
          attached_volume_id: volume.id,
        }),
      ),
    ).rejects.toThrow("already reserved");
    expect(await getComputeVolumeById(volume.id)).toMatchObject({
      attached_vm_id: first.id,
      attachment_state: "reserved",
      attachment_generation: 1,
    });
    expect(await listOwnedComputeVms({ owner_account_id: owner })).toHaveLength(
      1,
    );
  });

  it("keeps volume work distinct in the durable queue", async () => {
    const volume = await insertComputeVolume(volumeInput(), 2);
    await enqueueComputeWork({
      resource_kind: "volume",
      resource_id: volume.id,
      action: "provision_volume",
      idempotency_key: "provision-volume",
    });
    const [work] = await claimComputeWork({
      worker_id: "volume-worker",
      limit: 1,
    });
    expect(work).toMatchObject({
      resource_kind: "volume",
      resource_id: volume.id,
      action: "provision_volume",
    });
  });
});
