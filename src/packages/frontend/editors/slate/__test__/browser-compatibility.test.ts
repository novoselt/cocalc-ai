/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { readFileSync } from "fs";
import { dirname } from "path";

describe("Slate dependency browser compatibility", () => {
  it("does not require Array.prototype.findLast", () => {
    const slateReactPath = require.resolve("slate-react");
    const slateDomPath = require.resolve("slate-dom", {
      paths: [dirname(slateReactPath)],
    });
    const source = readFileSync(slateDomPath, "utf8");

    expect(source).not.toContain(".findLast(");
  });
});
