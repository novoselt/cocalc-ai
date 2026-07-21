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
});
