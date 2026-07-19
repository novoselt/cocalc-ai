/** @jest-environment jsdom */

import { EventEmitter } from "events";

const registerReconnectResource = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      registerReconnectResource,
    },
  },
}));

jest.mock("../widgets/manager", () => ({
  WidgetManager: class WidgetManager {},
}));

import { __test__, JupyterActions } from "../browser-actions";

describe("JupyterActions reconnect coordination", () => {
  beforeEach(() => {
    registerReconnectResource.mockReset();
    registerReconnectResource.mockReturnValue({
      requestReconnect: jest.fn(),
      close: jest.fn(),
    });
  });

  it("registers a reconnect resource that waits for live syncdb recovery", async () => {
    const wait_until_live_connected = jest.fn(async () => {});
    const wait_until_ready = jest.fn(async () => {});
    const target: any = {
      isClosed: jest.fn(() => false),
      syncdb: {
        is_live_connected: () => false,
        wait_until_live_connected,
        get_state: () => "ready",
      },
      wait_until_ready,
      isSyncdbLiveConnected: JupyterActions.prototype["isSyncdbLiveConnected"],
    };

    JupyterActions.prototype["initReconnectResource"].call(target);

    expect(registerReconnectResource).toHaveBeenCalledTimes(1);
    const options = registerReconnectResource.mock.calls[0][0];
    expect(options.canReconnect()).toBe(true);
    expect(options.isConnected()).toBe(false);
    await options.reconnect();
    expect(wait_until_live_connected).toHaveBeenCalled();
    expect(wait_until_ready).toHaveBeenCalled();
  });

  it("drops only the kernel execution client when the project runtime changes", () => {
    class ProjectStore extends EventEmitter {
      get = () => undefined;
    }
    const projectStore = new ProjectStore();
    const closeJupyterClient = jest.fn();
    const clearRunQueue = jest.fn();
    const clear_all_cell_run_state = jest.fn();
    const target: any = {
      project_id: "project-1",
      redux: {
        getProjectStore: jest.fn(() => projectStore),
      },
      isClosed: jest.fn(() => false),
      closeJupyterClient,
      clearRunQueue,
      clear_all_cell_run_state,
    };
    target.handleProjectRuntimeChange = (notice) =>
      JupyterActions.prototype["handleProjectRuntimeChange"].call(
        target,
        notice,
      );
    JupyterActions.prototype["initProjectRuntimeWatcher"].call(target);
    projectStore.emit("runtime-recovery", {
      id: "project-1:runtime-2",
      reason: "project_runtime_changed",
      occurred_at: Date.now(),
    });

    expect(closeJupyterClient).toHaveBeenCalledWith("project_runtime_changed");
    expect(clearRunQueue).toHaveBeenCalled();
    expect(clear_all_cell_run_state).toHaveBeenCalled();
    expect(target.runningNow).toBe(false);
  });
});

describe("JupyterActions legacy project runtime compatibility", () => {
  it("loads in the browser when the project does not implement jupyter.load", async () => {
    const fallback = jest.fn(async () => "fallback");

    await expect(
      __test__.withLegacyProjectJupyterFallback({
        method: "load",
        call: async () => {
          throw new Error("unknown service method 'load'");
        },
        fallback,
      }),
    ).resolves.toBe("fallback");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("recognizes the old not-implemented jupyter.set response", async () => {
    const fallback = jest.fn(async () => "fallback");

    await expect(
      __test__.withLegacyProjectJupyterFallback({
        method: "set",
        call: async () => {
          throw new Error("jupyter.set is not implemented");
        },
        fallback,
      }),
    ).resolves.toBe("fallback");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("recognizes a missing method on an older local API proxy", async () => {
    const fallback = jest.fn(async () => "fallback");

    await expect(
      __test__.withLegacyProjectJupyterFallback({
        method: "set",
        call: async () => {
          throw new TypeError("api.set is not a function");
        },
        fallback,
      }),
    ).resolves.toBe("fallback");
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("does not hide real project-side failures", async () => {
    const fallback = jest.fn(async () => "fallback");

    await expect(
      __test__.withLegacyProjectJupyterFallback({
        method: "load",
        call: async () => {
          throw new Error("permission denied");
        },
        fallback,
      }),
    ).rejects.toThrow("permission denied");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not treat another missing method as jupyter.load", async () => {
    const fallback = jest.fn(async () => "fallback");

    await expect(
      __test__.withLegacyProjectJupyterFallback({
        method: "load",
        call: async () => {
          throw new Error("unknown service method 'set'");
        },
        fallback,
      }),
    ).rejects.toThrow("unknown service method 'set'");
    expect(fallback).not.toHaveBeenCalled();
  });
});
