/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { NotebookFrameActions } from "./actions";

describe("NotebookFrameActions lifecycle", () => {
  it("ignores cell callbacks retained after frame teardown", () => {
    const target = {
      is_closed: () => true,
      jupyter_actions: undefined,
      store: undefined,
    } as any;

    expect(() => {
      NotebookFrameActions.prototype.set_cur_id.call(target, "cell-id");
      NotebookFrameActions.prototype.activate_cell.call(target, "cell-id", {
        mode: "edit",
      });
      expect(
        NotebookFrameActions.prototype.get_cell_by_id.call(target, "cell-id"),
      ).toBeUndefined();
    }).not.toThrow();
  });

  it("moves DOM focus back to the notebook in command mode", () => {
    const focus = jest.fn();
    const target = {
      cell_list_div: {
        get: () => ({ focus }),
      },
      enable_key_handler: jest.fn(),
      jupyter_actions: {
        store: {
          get: jest.fn(),
        },
      },
      setState: jest.fn(),
    } as any;

    NotebookFrameActions.prototype.set_mode.call(target, "escape");

    expect(target.setState).toHaveBeenCalledWith({ mode: "escape" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
