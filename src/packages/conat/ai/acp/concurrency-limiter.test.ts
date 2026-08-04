/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { ConcurrencyLimiter } from "./concurrency-limiter";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("ConcurrencyLimiter", () => {
  it("bounds active work and reports queued work", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const started: number[] = [];

    const runs = [first, second, third].map((task, index) =>
      limiter.run(async () => {
        started.push(index);
        await task.promise;
        return index;
      }),
    );

    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(limiter.activeCount).toBe(2);
    expect(limiter.pendingCount).toBe(1);

    first.resolve();
    await runs[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(limiter.activeCount).toBe(2);
    expect(limiter.pendingCount).toBe(0);

    second.resolve();
    third.resolve();
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(limiter.activeCount).toBe(0);
  });

  it("continues queued work after a rejection", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const first = deferred();
    const second = jest.fn(() => "second");
    const rejected = limiter.run(() => first.promise);
    const completed = limiter.run(second);

    first.reject(new Error("failed"));
    await expect(rejected).rejects.toThrow("failed");
    await expect(completed).resolves.toBe("second");
    expect(second).toHaveBeenCalledTimes(1);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it("rejects invalid concurrency", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow(
      "concurrency must be a positive integer",
    );
  });
});
