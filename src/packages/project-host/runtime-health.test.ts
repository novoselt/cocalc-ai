/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createProjectHostRuntimeHealthMonitor } from "./runtime-health";

describe("project-host runtime health", () => {
  it("does not probe Podman until the application is ready", async () => {
    let applicationReady = false;
    const probe = jest.fn(async () => undefined);
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => applicationReady,
      probe,
    });

    expect(await monitor.refresh()).toMatchObject({
      status: "starting",
      ready: false,
    });
    expect(probe).not.toHaveBeenCalled();

    applicationReady = true;
    expect(await monitor.refresh()).toMatchObject({
      status: "ready",
      ready: true,
      consecutive_failures: 0,
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("marks the runtime degraded and rejects control after a failed probe", async () => {
    const probe = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("podman ps timed out"))
      .mockResolvedValueOnce(undefined);
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe,
    });

    await expect(monitor.assertReady()).rejects.toThrow(
      "project host runtime is degraded",
    );
    expect(monitor.getSnapshot()).toMatchObject({
      status: "degraded",
      ready: false,
      consecutive_failures: 1,
      error: "Error: podman ps timed out",
    });

    await expect(monitor.assertReady()).resolves.toBeUndefined();
    expect(monitor.getSnapshot()).toMatchObject({
      status: "ready",
      ready: true,
      consecutive_failures: 0,
    });
  });

  it("deduplicates concurrent probes", async () => {
    let resolveProbe!: () => void;
    const probe = jest.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe,
    });

    const first = monitor.refresh();
    const second = monitor.refresh();
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("captures diagnostics after two consecutive failures", async () => {
    const probe = jest.fn(async () => {
      throw new Error("podman is wedged");
    });
    const captureDiagnostics = jest.fn(async () => undefined);
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe,
      captureDiagnostics,
    });

    await monitor.refresh();
    expect(captureDiagnostics).not.toHaveBeenCalled();
    await monitor.refresh();
    expect(captureDiagnostics).toHaveBeenCalledTimes(1);
    expect(monitor.getSnapshot().diagnostics_requested_at).toBeDefined();
  });
});
