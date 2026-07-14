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

import { JupyterActions } from "../browser-actions";

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
    class ProjectsStore extends EventEmitter {
      generation = 1;
      get_runtime_generation = () => this.generation;
    }
    const projectsStore = new ProjectsStore();
    const closeJupyterClient = jest.fn();
    const clearRunQueue = jest.fn();
    const clear_all_cell_run_state = jest.fn();
    const target: any = {
      project_id: "project-1",
      redux: {
        getStore: jest.fn(() => projectsStore),
      },
      isClosed: jest.fn(() => false),
      closeJupyterClient,
      clearRunQueue,
      clear_all_cell_run_state,
    };
    target.handleProjectRuntimeChange = () =>
      JupyterActions.prototype["handleProjectRuntimeChange"].call(target);

    JupyterActions.prototype["initProjectRuntimeWatcher"].call(target);
    projectsStore.generation = 2;
    projectsStore.emit("change");

    expect(closeJupyterClient).toHaveBeenCalledWith(
      "project_runtime_generation_changed",
    );
    expect(clearRunQueue).toHaveBeenCalled();
    expect(clear_all_cell_run_state).toHaveBeenCalled();
    expect(target.runningNow).toBe(false);
  });
});
