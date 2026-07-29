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
});
