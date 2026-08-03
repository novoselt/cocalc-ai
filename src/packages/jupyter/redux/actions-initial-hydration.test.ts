/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, List, Map } from "immutable";

import { JupyterActions } from "./actions";

describe("Jupyter initial SyncDoc hydration", () => {
  it("replaces an optimistic disk preview instead of merging into it", () => {
    let state = {
      cells: fromJS({
        preview: {
          type: "cell",
          id: "preview",
          pos: 1,
          cell_type: "markdown",
          input: "Only present in the optimistic disk preview",
        },
      }),
      cell_list: List(["preview"]),
    };
    const authoritativeCell = fromJS({
      type: "cell",
      id: "authoritative",
      pos: 0,
      cell_type: "code",
      input: "print('authoritative')",
    });
    const actions = new JupyterActions(
      "initial-syncdoc-hydration-test",
      {} as any,
    ) as any;
    actions._state = "init";
    actions.is_project = false;
    actions.syncdb = {
      get: () => List([authoritativeCell]),
      get_one: () => authoritativeCell,
    };
    actions.store = {
      get: (key: string) => state[key],
      get_cell_list: () => state.cell_list,
      get_kernel_info: () => undefined,
      emit: jest.fn(),
    };
    actions.setState = (update) => {
      state = { ...state, ...update };
    };
    actions.withPersistentCellMetadata = (cell) => cell;
    actions.applyRuntimeStateSnapshot = jest.fn();

    actions.__syncdb_change(fromJS([{ type: "cell", id: "authoritative" }]));

    expect(Map.isMap(state.cells)).toBe(true);
    expect(state.cells.keySeq().toArray()).toEqual(["authoritative"]);
    expect(state.cell_list.toJS()).toEqual(["authoritative"]);
  });
});
