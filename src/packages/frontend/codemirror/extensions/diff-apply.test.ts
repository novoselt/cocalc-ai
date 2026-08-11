/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { cm_define_diffApply_extension } from "./diff-apply";

describe("diffApply", () => {
  function createEditor() {
    let diffApply: (diff: [number, string][]) => unknown = () => undefined;
    cm_define_diffApply_extension({
      defineExtension: (_name: string, implementation: typeof diffApply) => {
        diffApply = implementation;
      },
    });
    const editor = { replaceRange: jest.fn() };
    return {
      apply: (diff: [number, string][]) => diffApply.call(editor, diff),
      editor,
    };
  }

  it("does not send zero-length diff chunks to CodeMirror", () => {
    const { apply, editor } = createEditor();

    apply([
      [0, ""],
      [-1, ""],
      [1, ""],
    ]);

    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it("keeps positions correct around zero-length chunks", () => {
    const { apply, editor } = createEditor();

    apply([
      [0, "ab"],
      [1, ""],
      [1, "c"],
    ]);

    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
    expect(editor.replaceRange).toHaveBeenCalledWith("c", { line: 0, ch: 2 });
  });
});
