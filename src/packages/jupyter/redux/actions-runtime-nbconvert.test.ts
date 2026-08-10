/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { JupyterActions } from "./actions";
import immutable from "immutable";

describe("Jupyter runtime nbconvert state", () => {
  it("does not let a pending start shadow a backend run transition", () => {
    let runtimeNbconvert: any;
    const setState = jest.fn();
    const actions = new JupyterActions(
      "runtime-nbconvert-state-test",
      {} as any,
    ) as any;
    actions._state = "ready";
    actions.is_project = false;
    actions.runtimeState = {
      get: () => runtimeNbconvert,
      set: (_key: string, value: any) => {
        runtimeNbconvert = value;
      },
    };
    actions.store = {
      getIn: () => "start",
    };
    actions.setState = setState;

    actions.set_runtime_nbconvert({
      args: ["--to", "script"],
      error: null,
      state: "start",
    });
    expect(actions.pendingRuntimeRecords.has("nbconvert")).toBe(false);
    runtimeNbconvert = {
      error: null,
      start: 123,
      state: "run",
    };
    actions.runtimeStateChange({ key: "nbconvert" });

    const applied = setState.mock.calls.at(-1)?.[0]?.nbconvert;
    expect(applied?.get("state")).toBe("run");
  });

  it("ignores late cell runtime updates after actions teardown", () => {
    const actions = new JupyterActions(
      "runtime-cell-state-closed-test",
      {} as any,
    ) as any;
    actions._state = "closed";
    delete actions.pendingRuntimeRecords;
    delete actions.pendingDeletedRuntimeRecords;

    expect(() => {
      actions.set_runtime_cell_state("cell-id", { state: "done" });
      actions.clear_runtime_cell_state("cell-id");
    }).not.toThrow();
  });

  it("defaults student project restrictions while project metadata loads", () => {
    const actions = new JupyterActions("student-functionality-test", {
      getStore: () => ({
        get_student_project_functionality: () => undefined,
      }),
    } as any) as any;
    actions.project_id = "project-id";

    expect(actions.studentProjectFunctionality()).toEqual({});
    expect(() => actions.requireToggleReadonly()).not.toThrow();
  });
});

describe("Jupyter runtime cell state", () => {
  function createActions() {
    let cells = immutable.Map({
      "cell-id": immutable.Map({ id: "cell-id", input: "a = 7" }),
    });
    const set = jest.fn();
    const actions = new JupyterActions(
      "runtime-cell-state-test",
      {} as any,
    ) as any;
    actions._state = "ready";
    actions.runtimeState = {
      delete: jest.fn(),
      get: () => undefined,
      getField: () => undefined,
      set,
    };
    actions.store = {
      emit: jest.fn(),
      get: (key: string) => (key === "cells" ? cells : undefined),
    };
    actions.setState = ({ cells: nextCells }: { cells?: typeof cells }) => {
      if (nextCells != null) {
        cells = nextCells;
      }
    };
    return { actions, getCells: () => cells, set };
  }

  it("writes a fixed manifest with explicit nulls", () => {
    const { actions, set } = createActions();

    actions.set_runtime_cell_state("cell-id", {
      state: "run",
      start: null,
      end: null,
    });

    expect(set).toHaveBeenLastCalledWith("cell:cell-id", {
      state: "run",
      start: null,
      end: null,
    });
    expect(actions.pendingRuntimeRecords.size).toBe(0);
  });

  it("recovers done from a valid end field hidden by the manifest", () => {
    const { actions, getCells } = createActions();
    actions.runtimeState.get = () => ({ state: "busy", start: 10 });
    actions.runtimeState.getField = () => 20;

    actions.applyRuntimeCellToStore("cell-id");

    expect(getCells().getIn(["cell-id", "state"])).toBe("done");
    expect(getCells().getIn(["cell-id", "end"])).toBe(20);
  });

  it("applies frontend execution state without writing shared runtime state", () => {
    const { actions, getCells, set } = createActions();

    actions.set_local_runtime_cell_state("cell-id", {
      state: "busy",
      start: 10,
      end: null,
    });
    actions.set_local_runtime_cell_state("cell-id", {
      state: "done",
      end: 20,
    });

    expect(getCells().getIn(["cell-id", "state"])).toBe("done");
    expect(getCells().getIn(["cell-id", "start"])).toBe(10);
    expect(getCells().getIn(["cell-id", "end"])).toBe(20);
    expect(set).not.toHaveBeenCalled();
  });
});
