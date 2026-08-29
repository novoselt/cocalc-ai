/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import * as CodeMirror from "codemirror";
import { readFileSync } from "fs";

describe("CodeMirror stale selections", () => {
  it("clips positions before checking atomic ranges", () => {
    const source = readFileSync(require.resolve("codemirror"), "utf8");

    expect(source).toMatch(
      /function skipAtomic\(doc, pos, oldPos, bias, mayClear\) \{\s*\/\/ A mouse position can outlive[\s\S]*?pos = clipPos\(doc, pos\);\s*if \(oldPos\) \{ oldPos = clipPos\(doc, oldPos\); \}/,
    );
  });

  it("clips a mouse position retained across a document shrink", () => {
    const doc = new CodeMirror.Doc("one\ntwo\nthree\nfour");
    const stalePosition = { line: 3, ch: 2 };

    doc.setValue("one");

    expect(() => doc.extendSelection(stalePosition)).not.toThrow();
    expect(doc.getCursor()).toEqual({ line: 0, ch: 3, sticky: null });
  });
});
