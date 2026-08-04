/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

type PendingTask = () => void;

export class ConcurrencyLimiter {
  activeCount = 0;
  private readonly concurrency: number;
  private readonly queue: PendingTask[] = [];

  constructor(concurrency: number) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error("concurrency must be a positive integer");
    }
    this.concurrency = concurrency;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  run<T>(fn: () => PromiseLike<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.activeCount += 1;
        const finish = () => {
          this.activeCount -= 1;
          this.queue.shift()?.();
        };
        void Promise.resolve()
          .then(fn)
          .then(
            (value) => {
              finish();
              resolve(value);
            },
            (err) => {
              finish();
              reject(err);
            },
          );
      };

      if (this.activeCount < this.concurrency) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }
}
