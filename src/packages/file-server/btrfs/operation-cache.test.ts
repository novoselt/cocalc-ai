/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  clearBtrfsOperationCachesForTest,
  getBtrfsMutationLockStatus,
  withBtrfsMutationLock,
} from "./operation-cache";

describe("btrfs mutation lock", () => {
  beforeEach(() => {
    clearBtrfsOperationCachesForTest();
  });

  afterEach(() => {
    clearBtrfsOperationCachesForTest();
  });

  it("hands the lock to waiters in FIFO order", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const first = withBtrfsMutationLock({
      mount: "/mnt/test",
      operation: "first",
      run: async () => {
        order.push("first:start");
        firstStarted();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push("first:end");
      },
    });
    await started;

    const second = withBtrfsMutationLock({
      mount: "/mnt/test",
      operation: "second",
      run: async () => {
        order.push("second");
      },
    });

    expect(getBtrfsMutationLockStatus()).toEqual([
      expect.objectContaining({
        mount: "/mnt/test",
        holder_operation: "first",
        queued: 1,
      }),
    ]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(getBtrfsMutationLockStatus()).toEqual([]);
  });

  it("times out and removes a blocked waiter without poisoning the lock", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const first = withBtrfsMutationLock({
      mount: "/mnt/test",
      operation: "stuck-holder",
      run: async () => {
        firstStarted();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      },
    });
    await started;

    await expect(
      withBtrfsMutationLock({
        mount: "/mnt/test",
        operation: "bounded-waiter",
        wait_ms: 10,
        run: async () => undefined,
      }),
    ).rejects.toThrow("timed out after 10ms waiting for btrfs mutation lock");
    expect(getBtrfsMutationLockStatus()).toEqual([
      expect.objectContaining({
        holder_operation: "stuck-holder",
        queued: 0,
      }),
    ]);

    releaseFirst();
    await first;
    await expect(
      withBtrfsMutationLock({
        mount: "/mnt/test",
        operation: "after-timeout",
        run: async () => "ok",
      }),
    ).resolves.toBe("ok");
  });
});
