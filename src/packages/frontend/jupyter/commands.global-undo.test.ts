/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { commands } from "./commands";

describe("Jupyter global undo commands", () => {
  it("uses command-mode Z and Shift+Z for notebook-wide history", () => {
    const undo = jest.fn();
    const redo = jest.fn();
    const result = commands({
      frame_actions: { undo, redo } as any,
    });

    expect(result["global undo"].m).toMatchObject({
      defaultMessage: "Global Undo",
    });
    expect(result["global undo"].k).toEqual([{ mode: "escape", which: 90 }]);
    result["global undo"].f();
    expect(undo).toHaveBeenCalledTimes(1);

    expect(result["global redo"].m).toMatchObject({
      defaultMessage: "Global Redo",
    });
    expect(result["global redo"].k).toEqual([
      { mode: "escape", shift: true, which: 90 },
    ]);
    result["global redo"].f();
    expect(redo).toHaveBeenCalledTimes(1);
  });
});
