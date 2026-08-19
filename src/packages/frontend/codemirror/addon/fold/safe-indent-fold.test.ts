/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const { makeSafeIndentFold } = require("./safe-indent-fold");

describe("safe CodeMirror indent folding", () => {
  it("ignores a stale fold request after its line disappears", () => {
    const indentFold = jest.fn();
    const fold = makeSafeIndentFold(indentFold);

    expect(fold({ getLine: () => undefined }, { line: 7 })).toBeUndefined();
    expect(indentFold).not.toHaveBeenCalled();
  });

  it("delegates when the target line still exists", () => {
    const result = { from: 1, to: 2 };
    const cm = { getLine: () => "  code" };
    const start = { line: 7 };
    const indentFold = jest.fn(() => result);
    const fold = makeSafeIndentFold(indentFold);

    expect(fold(cm, start)).toBe(result);
    expect(indentFold).toHaveBeenCalledWith(cm, start);
  });
});
