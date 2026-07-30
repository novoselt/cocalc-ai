/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createStorageAdmissionController } from "./storage-admission";

describe("storage admission controller", () => {
  let now = 1_000_000;
  let full = 0;
  let starting = 0;
  let stopping = 0;

  const create = (mode: "disabled" | "observe" | "enforce" = "enforce") =>
    createStorageAdmissionController({
      mode,
      now: () => now,
      readInputs: () => ({
        sampled_at_ms: now,
        host_io_full_avg10: full,
        project_pool_io_full_avg10: full / 2,
        starting_projects: starting,
        stopping_projects: stopping,
        btrfs_mutation_locks: 0,
        btrfs_mutation_waiters: 0,
      }),
      recoveryMs: 60_000,
    });

  beforeEach(() => {
    now = 1_000_000;
    full = 0;
    starting = 0;
    stopping = 0;
  });

  it("enters contention after two samples and emergency immediately", () => {
    const controller = create();
    full = 5;
    expect(controller.sample().pressure_state).toBe("normal");
    now += 5_000;
    expect(controller.sample().pressure_state).toBe("contended");
    full = 10;
    now += 5_000;
    expect(controller.sample()).toMatchObject({
      pressure_state: "emergency",
      transition_count: 2,
    });
  });

  it("requires a healthy recovery interval before returning to normal", () => {
    const controller = create();
    full = 10;
    controller.sample();
    full = 0.5;
    now += 5_000;
    expect(controller.sample().pressure_state).toBe("recovery");
    now += 59_999;
    expect(controller.sample().pressure_state).toBe("recovery");
    now += 1;
    expect(controller.sample().pressure_state).toBe("normal");
  });

  it("keeps recovery blocked while lifecycle work is active", () => {
    const controller = create();
    full = 10;
    controller.sample();
    full = 0;
    starting = 1;
    now += 5_000;
    expect(controller.sample().pressure_state).toBe("recovery");
    now += 120_000;
    expect(controller.sample().pressure_state).toBe("recovery");
    starting = 0;
    controller.sample();
    now += 60_000;
    expect(controller.sample().pressure_state).toBe("normal");
  });

  it("enforces background deferral but preserves interactive work", () => {
    const controller = create("enforce");
    starting = 1;
    const scheduled = controller.admit({
      operation_kind: "scheduled_snapshot",
      project_id: "project-1",
    });
    expect(scheduled).toMatchObject({
      admitted: false,
      would_defer: true,
      reason: "lifecycle_active",
    });
    const interactive = controller.admit({
      operation_kind: "interactive_snapshot",
      project_id: "project-1",
    });
    expect(interactive).toMatchObject({
      admitted: true,
      would_defer: false,
    });
    expect(controller.getStatus()).toMatchObject({
      deferred_total: 1,
      admitted_total: 1,
      active_by_priority: { interactive: 1 },
    });
    interactive.release();
    expect(controller.getStatus().active_by_priority.interactive).toBe(0);
  });

  it("reports would-defer decisions without blocking in observe mode", () => {
    const controller = create("observe");
    stopping = 1;
    const ticket = controller.admit({
      operation_kind: "scheduled_backup",
      project_id: "project-1",
    });
    expect(ticket).toMatchObject({
      admitted: true,
      would_defer: true,
      reason: "lifecycle_active",
    });
    expect(controller.getStatus()).toMatchObject({
      admitted_total: 1,
      deferred_total: 0,
      observed_deferral_total: 1,
    });
    ticket.release();
  });

  it("reevaluates pressure for every operation", () => {
    const controller = create("enforce");
    const first = controller.admit({
      operation_kind: "scheduled_backup",
      project_id: "project-1",
    });
    expect(first.admitted).toBe(true);
    first.release();
    full = 10;
    now += 5_000;
    const second = controller.admit({
      operation_kind: "scheduled_backup",
      project_id: "project-2",
    });
    expect(second).toMatchObject({
      admitted: false,
      reason: "io_pressure_emergency",
    });
  });

  it("fails background admission closed when pressure cannot be sampled", () => {
    const controller = createStorageAdmissionController({
      mode: "enforce",
      now: () => now,
      readInputs: () => ({
        sampled_at_ms: now,
        starting_projects: 0,
        stopping_projects: 0,
        btrfs_mutation_locks: 0,
        btrfs_mutation_waiters: 0,
        error: "host I/O pressure is unavailable",
      }),
    });
    expect(
      controller.admit({
        operation_kind: "scheduled_snapshot",
        project_id: "project-1",
      }),
    ).toMatchObject({
      admitted: false,
      would_defer: true,
      reason: "io_pressure_unavailable",
    });
  });
});
