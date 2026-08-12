/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

describe("lazy browser session automation", () => {
  let markSurfaceReady: (() => void) | undefined;
  const start = jest.fn(async () => undefined);
  const stop = jest.fn(async () => undefined);
  const noteConnected = jest.fn();
  const noteDisconnected = jest.fn();
  const createDelegate = jest.fn(() => ({
    start,
    stop,
    noteConnected,
    noteDisconnected,
  }));

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    markSurfaceReady = undefined;
    jest.doMock("@cocalc/frontend/app/surface-ready-state", () => ({
      signedInSurfaceReadySegment: () => undefined,
      onSignedInSurfaceReady: (listener: () => void) => {
        markSurfaceReady = listener;
        return () => undefined;
      },
    }));
    jest.doMock("./browser-session/index", () => ({
      createBrowserSessionAutomation: createDelegate,
    }));
  });

  it("does not load automation before the useful surface", async () => {
    const { createBrowserSessionAutomation } =
      await import("./browser-session");
    const automation = createBrowserSessionAutomation({} as any);

    automation.noteConnected?.();
    await automation.start("account-1");

    expect(createDelegate).not.toHaveBeenCalled();
    expect(markSurfaceReady).toBeDefined();

    markSurfaceReady?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createDelegate).toHaveBeenCalledTimes(1);
    expect(noteConnected).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("account-1");
  });

  it("cancels a pending start when stopped before readiness", async () => {
    const { createBrowserSessionAutomation } =
      await import("./browser-session");
    const automation = createBrowserSessionAutomation({} as any);

    await automation.start("account-1");
    await automation.stop();
    markSurfaceReady?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createDelegate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it("serializes stop after a service has started", async () => {
    const { createBrowserSessionAutomation } =
      await import("./browser-session");
    const automation = createBrowserSessionAutomation({} as any);
    markSurfaceReady?.();

    await automation.start("account-1");
    automation.noteDisconnected?.();
    await automation.stop();

    expect(start).toHaveBeenCalledWith("account-1");
    expect(noteDisconnected).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
