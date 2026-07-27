/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

jest.mock("@cocalc/frontend/codemirror/static", () => ({
  __esModule: true,
  default: {
    runMode: (
      value: string,
      mode: string,
      append: (text: string, type?: string) => void,
    ) => append(value, mode === "stex" ? "keyword" : undefined),
  },
}));

import { renderPrintableCodeMarkup } from "./print-code";

describe("renderPrintableCodeMarkup", () => {
  it("preserves plain CodeMirror options while forcing the printable theme", () => {
    const html = renderPrintableCodeMarkup({
      value: "\\documentclass{article}",
      options: {
        lineNumbers: true,
        lineWrapping: false,
        mode: "stex",
        theme: "cocalc-light",
      },
    });

    expect(html).toContain("cm-s-default");
    expect(html).toContain("cm-keyword");
    expect(html).toContain("CodeMirror-linenumber");
    expect(html).toContain("white-space:pre");
    expect(html).not.toContain("cm-s-cocalc-light");
  });
});
