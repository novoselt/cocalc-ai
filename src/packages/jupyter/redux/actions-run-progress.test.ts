/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import immutable from "immutable";
import { JupyterActions } from "./actions";

// Both inputs of the run progress meter -- last_backend_state and the per-cell
// start/end -- live in the runtime state DKO rather than in the syncdb, so the
// meter has to read from and recompute on that path.

function createActions() {
  const actions = new JupyterActions("run-progress-test", {} as any) as any;
  actions._state = "ready";
  actions.is_project = false;
  const runtime: any = {
    "cell:a": { state: "done", start: 1500, end: 1600 },
    "cell:b": { state: "busy", start: 1700, end: null },
  };
  const state: any = {
    backend_state: "running",
    last_backend_state: 1000,
    cells: immutable.Map({
      a: immutable.Map({ id: "a", input: "1" }),
      b: immutable.Map({ id: "b", input: "2" }),
      c: immutable.Map({ id: "c", input: "3" }),
      d: immutable.Map({ id: "d", input: "" }),
      md: immutable.Map({ id: "md", cell_type: "markdown", input: "# x" }),
    }),
  };
  actions.runtimeState = {
    delete: jest.fn(),
    get: (key: string) => runtime[key],
    getField: (key: string, field: string) => runtime[key]?.[field],
    getAll: () => runtime,
    set: jest.fn(),
  };
  actions.store = {
    emit: jest.fn(),
    get: (key: string) => state[key],
    getIn: () => undefined,
  };
  actions.setState = (obj: any) => Object.assign(state, obj);
  return { actions, state, runtime };
}

describe("Jupyter run progress", () => {
  it("counts a finished cell as one and a running cell as a half", () => {
    const { actions, state } = createActions();

    actions.updateRunProgress();

    // 3 runnable code cells; a finished (1), b still running (0.5), c not run.
    expect(state.runProgress).toBeCloseTo((100 * 1.5) / 3);
  });

  it("stays put when the kernel never reported a backend state", () => {
    const { actions, state } = createActions();
    state.last_backend_state = undefined;

    actions.updateRunProgress();

    expect(state.runProgress).toBeUndefined();
  });

  it("ignores browser-clock timestamps overlaid on the store", () => {
    const { actions, state } = createActions();
    // Optimistic local rendering stamps store cells with the *browser* clock.
    // last_backend_state comes from the project, so a browser running behind
    // the project would never count these cells if they were trusted.
    state.cells = state.cells
      .setIn(["a", "start"], 5)
      .setIn(["a", "end"], 6)
      .setIn(["b", "start"], 7);

    actions.updateRunProgress();

    expect(state.runProgress).toBeCloseTo((100 * 1.5) / 3);
  });

  it("recomputes when a cell's runtime state changes", () => {
    const { actions } = createActions();
    const hook = jest.spyOn(actions, "__runtime_state_change_post_hook");

    actions.runtimeStateChange({ key: "cell:a" });

    expect(hook).toHaveBeenCalled();
  });

  it("recomputes when the backend state changes", () => {
    const { actions } = createActions();
    const hook = jest.spyOn(actions, "__runtime_state_change_post_hook");

    actions.runtimeStateChange({ key: "settings" });

    expect(hook).toHaveBeenCalled();
  });
});

describe("Jupyter runtime settings record", () => {
  function createSettingsActions(stored: Record<string, any>) {
    const actions = new JupyterActions(
      "settings-manifest-test",
      {} as any,
    ) as any;
    actions._state = "ready";
    actions.is_project = false;
    // A DKO exposes get() through a per-key field manifest, but getField()
    // reads a field's path directly.  Model a manifest that has gone stale.
    let manifest: string[] = [];
    actions.runtimeState = {
      delete: jest.fn(),
      get: (key: string) => {
        if (key !== "settings") return undefined;
        const visible: any = {};
        for (const field of manifest) {
          visible[field] = stored[field];
        }
        return visible;
      },
      getField: (key: string, field: string) =>
        key === "settings" ? stored[field] : undefined,
      getAll: () => ({ settings: stored }),
      set: (key: string, value: any) => {
        if (key !== "settings") return;
        manifest = Object.keys(value);
        Object.assign(stored, value);
      },
    };
    actions.store = {
      emit: jest.fn(),
      get: () => undefined,
      getIn: () => null,
    };
    actions.setState = jest.fn();
    return { actions, setManifest: (m: string[]) => (manifest = m) };
  }

  it("reads a field the manifest no longer lists", () => {
    const { actions, setManifest } = createSettingsActions({
      backend_state: "running",
      last_backend_state: 4242,
    });
    // A concurrent writer republished settings without last_backend_state.
    setManifest(["backend_state"]);

    expect(actions.get_runtime_setting("last_backend_state")).toBe(4242);
  });

  it("does not drop another writer's field when publishing a patch", () => {
    const stored: Record<string, any> = {
      backend_state: "starting",
      last_backend_state: 4242,
    };
    const { actions, setManifest } = createSettingsActions(stored);
    setManifest(["backend_state"]);

    // The browser publishes optimistic backend/kernel state only.
    actions.set_runtime_settings({
      backend_state: "running",
      kernel_state: "busy",
    });

    expect(stored.last_backend_state).toBe(4242);
    expect(actions.get_runtime_setting("last_backend_state")).toBe(4242);
    expect(actions.get_runtime_setting("backend_state")).toBe("running");
  });

  it("never publishes a null for a field it has no value for", () => {
    const { actions } = createSettingsActions({});
    const set = jest.spyOn(actions.runtimeState, "set");

    actions.set_runtime_settings({ backend_state: "running" });

    // Writing null to fill out the manifest would clobber whatever a
    // concurrent writer has for that field: DKO resolves in favour of the
    // local write, and getField only sees the local replica.
    expect(set.mock.calls.at(-1)?.[1]).toEqual({ backend_state: "running" });
  });

  it("keeps a patch queued before the DKO opens from nulling other fields", () => {
    const actions = new JupyterActions(
      "settings-bootstrap-test",
      {} as any,
    ) as any;
    actions._state = "ready";
    actions.is_project = false;
    actions.store = {
      emit: jest.fn(),
      get: () => undefined,
      getIn: () => null,
    };
    actions.setState = jest.fn();

    // The browser publishes optimistic state before its runtime DKO is open,
    // so the record is queued locally.
    actions.set_runtime_settings({
      backend_state: "running",
      kernel_state: "busy",
    });

    // Bootstrap completes and the project's timestamp is already there.
    const stored: Record<string, any> = { last_backend_state: 4242 };
    actions.runtimeState = {
      delete: jest.fn(),
      get: () => stored,
      getField: (key: string, field: string) =>
        key === "settings" ? stored[field] : undefined,
      getAll: () => ({ settings: stored }),
      set: (key: string, value: any) => {
        if (key === "settings") Object.assign(stored, value);
      },
    };
    actions.flushPendingRuntimeRecords();

    expect(stored.last_backend_state).toBe(4242);
  });
});
