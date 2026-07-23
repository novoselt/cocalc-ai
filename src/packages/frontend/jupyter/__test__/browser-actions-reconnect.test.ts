/** @jest-environment jsdom */

import { EventEmitter } from "events";

const registerReconnectResource = jest.fn();
const projectConat = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      registerReconnectResource,
      projectConat,
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
    projectConat.mockReset();
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

  it("does not flush live-run replay after the actions close", async () => {
    let finishReplay!: () => void;
    const replay = new Promise<void>((resolve) => {
      finishReplay = resolve;
    });
    let markReplayStarted!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      markReplayStarted = resolve;
    });
    let finishSubscription!: () => void;
    const subscription = {
      close: jest.fn(() => finishSubscription()),
      [Symbol.asyncIterator]() {
        return this;
      },
      next: jest.fn(
        () =>
          new Promise<IteratorResult<never>>((resolve) => {
            finishSubscription = () =>
              resolve({ done: true, value: undefined });
          }),
      ),
    };
    projectConat.mockResolvedValue({
      subscribe: jest.fn(async () => subscription),
    });
    const actions: any = new JupyterActions("jupyter-test", {
      getStore: jest.fn(() => undefined),
      removeActions: jest.fn(),
    } as any);
    actions.project_id = "project-1";
    actions.liveRunPath = "notebook.ipynb";
    actions._state = "ready";
    actions.replaySharedLiveRuns = jest.fn(() => {
      markReplayStarted();
      return replay;
    });
    const runDebug = jest.fn();
    actions.runDebug = runDebug;

    const pending = actions.ensureLiveRunSubscription();
    await replayStarted;
    expect(actions.replaySharedLiveRuns).toHaveBeenCalledTimes(1);

    await actions.close();
    finishReplay();

    await expect(pending).resolves.toBeUndefined();
    expect(runDebug).not.toHaveBeenCalledWith(
      "liveRun.batch.buffer.flush",
      expect.anything(),
    );
  });
});
