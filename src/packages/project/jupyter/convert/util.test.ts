/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { outputPath } from "./util";

describe("nbconvert output path", () => {
  it("uses the notebook script extension when present", () => {
    expect(
      outputPath({
        directory: "/home/user",
        languageInfo: { file_extension: ".R" },
        source: "analysis.ipynb",
        to: "script",
      }),
    ).toBe("/home/user/analysis.R");
  });

  it("matches nbconvert's txt fallback without file-extension metadata", () => {
    expect(
      outputPath({
        directory: "/home/user",
        languageInfo: { name: "python" } as any,
        source: "analysis.ipynb",
        to: "script",
      }),
    ).toBe("/home/user/analysis.txt");
  });

  it("uses the fixed extension for non-script exporters", () => {
    expect(
      outputPath({
        directory: "/home/user",
        source: "analysis.ipynb",
        to: "lab-pdf",
      }),
    ).toBe("/home/user/analysis.pdf");
  });
});
