/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  assertProjectVolumeLifecycleGeneration,
  currentProjectVolumeLifecycleGeneration,
  invalidateProjectVolumeLifecycle,
  resetProjectVolumeLifecycleForTesting,
  withCurrentProjectVolumeLifecycleLock,
  withProjectVolumeLifecycleLock,
} from "./project-volume-lifecycle";

describe("project volume lifecycle coordination", () => {
  beforeEach(() => {
    resetProjectVolumeLifecycleForTesting();
  });

  it("serializes one project while allowing other projects through", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];
    const first = withProjectVolumeLifecycleLock("project-1", async () => {
      order.push("first:start");
      await firstBlocked;
      order.push("first:end");
    });
    const second = withProjectVolumeLifecycleLock("project-1", async () => {
      order.push("second");
    });
    const unrelated = withProjectVolumeLifecycleLock("project-2", async () => {
      order.push("unrelated");
    });

    await unrelated;
    expect(order).toEqual(["first:start", "unrelated"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "unrelated", "first:end", "second"]);
  });

  it("invalidates preparation generations before queued deletion runs", async () => {
    const project_id = "project-1";
    const preparedGeneration =
      currentProjectVolumeLifecycleGeneration(project_id);
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withProjectVolumeLifecycleLock(project_id, async () => {
      await firstBlocked;
    });

    invalidateProjectVolumeLifecycle(project_id);
    const stalePreparation = withProjectVolumeLifecycleLock(
      project_id,
      async () => {
        assertProjectVolumeLifecycleGeneration(project_id, preparedGeneration);
      },
    );
    releaseFirst();
    await first;
    await expect(stalePreparation).rejects.toThrow(
      "project volume lifecycle changed",
    );
  });

  it("skips queued work when volume deletion invalidates its generation", async () => {
    const project_id = "project-1";
    const expectedGeneration =
      currentProjectVolumeLifecycleGeneration(project_id);
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withProjectVolumeLifecycleLock(project_id, async () => {
      await firstBlocked;
    });
    const run = jest.fn(async () => "ran");
    const staleMaintenance = withCurrentProjectVolumeLifecycleLock(
      project_id,
      expectedGeneration,
      run,
    );

    invalidateProjectVolumeLifecycle(project_id);
    releaseFirst();
    await first;

    await expect(staleMaintenance).resolves.toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });
});
