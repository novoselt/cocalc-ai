/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { JupyterActions } from "./actions";

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
