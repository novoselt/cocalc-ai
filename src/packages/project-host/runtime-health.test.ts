/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { _test, createProjectHostRuntimeHealthMonitor } from "./runtime-health";

describe("project-host runtime health", () => {
  it("preserves both ends of long runtime errors", () => {
    const text = `command=${"x".repeat(1500)}: Address already in use`;
    const truncated = _test.errorText(text);

    expect(truncated).toHaveLength(1000);
    expect(truncated).toContain("command=");
    expect(truncated).toContain("error middle omitted");
    expect(truncated).toContain("Address already in use");
  });

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

  it("requires two failures after a successful probe before degrading", async () => {
    const probe = jest
      .fn<Promise<void>, []>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("podman ps timed out"))
      .mockRejectedValueOnce(new Error("podman ps timed out"));
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe,
    });

    await expect(monitor.assertReady()).resolves.toBeUndefined();
    await expect(monitor.assertReady()).resolves.toBeUndefined();
    expect(monitor.getSnapshot()).toMatchObject({
      status: "ready",
      ready: true,
      consecutive_failures: 1,
      error: "Error: podman ps timed out",
    });

    await expect(monitor.assertReady()).rejects.toThrow(
      "project host runtime is degraded",
    );
    expect(monitor.getSnapshot()).toMatchObject({
      status: "degraded",
      ready: false,
      consecutive_failures: 2,
    });
  });

  it("rejects control after the first probe fails during startup", async () => {
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe: jest.fn(async () => {
        throw new Error("podman is unavailable");
      }),
    });

    await expect(monitor.assertReady()).rejects.toThrow(
      "project host runtime is degraded",
    );
    expect(monitor.getSnapshot()).toMatchObject({
      status: "degraded",
      ready: false,
      consecutive_failures: 1,
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

  it("defers health probes while a runtime diagnostic is active", async () => {
    let resolveDiagnostic!: () => void;
    const probe = jest.fn(async () => undefined);
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe,
    });
    await monitor.refresh();

    const diagnostic = monitor.runRuntimeDiagnostic(
      async () =>
        await new Promise<void>((resolve) => {
          resolveDiagnostic = resolve;
        }),
    );
    await Promise.resolve();
    expect(await monitor.refresh()).toMatchObject({
      status: "ready",
      ready: true,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    resolveDiagnostic();
    await diagnostic;
    await monitor.refresh();
    expect(probe).toHaveBeenCalledTimes(2);
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
    await Promise.resolve();
    expect(monitor.getSnapshot().diagnostics_completed_at).toBeDefined();
  });

  it("keeps a failed synthetic probe quarantined until it passes", async () => {
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe: jest.fn(async () => undefined),
      captureDiagnostics: jest.fn(async () => undefined),
    });

    await monitor.refresh();
    monitor.recordSyntheticProbe({
      startedAt: Date.now() - 100,
      error: new Error("project exec timed out"),
    });
    await monitor.refresh();
    expect(monitor.getSnapshot()).toMatchObject({
      status: "ready",
      ready: true,
      consecutive_failures: 0,
      synthetic_probe: {
        status: "failed",
        consecutive_failures: 1,
      },
    });

    monitor.recordSyntheticProbe({ startedAt: Date.now() - 100 });
    expect(monitor.getSnapshot()).toMatchObject({
      status: "ready",
      ready: true,
      synthetic_probe: {
        status: "passed",
        consecutive_failures: 0,
      },
    });
  });

  it("classifies transient project port collisions", async () => {
    const monitor = createProjectHostRuntimeHealthMonitor({
      isApplicationReady: () => true,
      probe: jest.fn(async () => undefined),
      captureDiagnostics: jest.fn(async () => undefined),
    });

    await monitor.refresh();
    monitor.recordSyntheticProbe({
      startedAt: Date.now() - 100,
      error: new Error(
        "pasta failed: Failed to bind port 46818 (Address already in use)",
      ),
    });
    expect(monitor.getSnapshot().synthetic_probe).toMatchObject({
      status: "failed",
      failure_kind: "port_bind_collision",
    });

    monitor.recordSyntheticProbe({ startedAt: Date.now() - 100 });
    expect(monitor.getSnapshot().synthetic_probe).toMatchObject({
      status: "passed",
      failure_kind: undefined,
    });
  });
});
