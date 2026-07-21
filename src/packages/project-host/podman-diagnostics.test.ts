/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createCachedPodmanSnapshotReader } from "./podman-diagnostics";

function response(limit: number) {
  return {
    limit,
    info: { command: "podman", args: ["info"], stdout: "{}", exit_code: 0 },
    containers: {
      command: "podman",
      args: ["ps"],
      stdout: "[]",
      exit_code: 0,
    },
  };
}

describe("cached Podman diagnostics", () => {
  it("shares concurrent captures and serves the result from cache", async () => {
    let resolveCapture!: () => void;
    const capture = jest.fn(
      async (limit: number) =>
        await new Promise<ReturnType<typeof response>>((resolve) => {
          resolveCapture = () => resolve(response(limit));
        }),
    );
    const runRuntimeDiagnostic = jest.fn(async (fn) => await fn());
    const read = createCachedPodmanSnapshotReader({
      capture,
      runRuntimeDiagnostic,
    });

    const first = read(50);
    const second = read(50);
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    resolveCapture();

    await expect(first).resolves.toMatchObject({ limit: 50, cached: false });
    await expect(second).resolves.toMatchObject({ limit: 50, cached: true });
    await expect(read(50)).resolves.toMatchObject({ limit: 50, cached: true });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runRuntimeDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("serializes captures with different limits", async () => {
    const resolvers: Array<() => void> = [];
    const capture = jest.fn(
      async (limit: number) =>
        await new Promise<ReturnType<typeof response>>((resolve) => {
          resolvers.push(() => resolve(response(limit)));
        }),
    );
    const read = createCachedPodmanSnapshotReader({
      capture,
      runRuntimeDiagnostic: async (fn) => await fn(),
    });

    const first = read(25);
    const second = read(100);
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await first;
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(2);
    resolvers.shift()?.();
    await second;
  });

  it("refreshes an expired cache entry", async () => {
    let clock = 1_000;
    const capture = jest.fn(async (limit: number) => response(limit));
    const read = createCachedPodmanSnapshotReader({
      capture,
      runRuntimeDiagnostic: async (fn) => await fn(),
      cacheTtlMs: 100,
      now: () => clock,
    });

    await read(50);
    clock += 101;
    await read(50);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
