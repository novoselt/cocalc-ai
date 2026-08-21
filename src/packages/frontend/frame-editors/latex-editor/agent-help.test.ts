/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { List } from "immutable";

import { latexBuildCommandString, resolveErrorFile } from "./agent-help";

describe("resolveErrorFile", () => {
  it("resolves log-relative paths against the main document's directory", () => {
    expect(resolveErrorFile("latex/paper.tex", "./paper.tex")).toBe(
      "latex/paper.tex",
    );
    expect(resolveErrorFile("latex/paper.tex", "chapters/intro.tex")).toBe(
      "latex/chapters/intro.tex",
    );
    expect(resolveErrorFile("paper.tex", "./paper.tex")).toBe("paper.tex");
  });

  it("keeps absolute paths and ignores unknown files", () => {
    expect(
      resolveErrorFile("latex/paper.tex", "/usr/share/texmf/foo.sty"),
    ).toBe("/usr/share/texmf/foo.sty");
    expect(resolveErrorFile("latex/paper.tex", undefined)).toBeUndefined();
    expect(resolveErrorFile("latex/paper.tex", "  ")).toBeUndefined();
  });
});

describe("latexBuildCommandString", () => {
  it("accepts strings and immutable argv lists", () => {
    expect(latexBuildCommandString("latexmk -pdf paper.tex ")).toBe(
      "latexmk -pdf paper.tex",
    );
    expect(
      latexBuildCommandString(List(["latexmk", "-pdf", "paper.tex"])),
    ).toBe("latexmk -pdf paper.tex");
    expect(
      latexBuildCommandString(List(["latexmk", "-pdf", "my paper.tex"])),
    ).toBe("latexmk -pdf 'my paper.tex'");
    expect(latexBuildCommandString(undefined)).toBe("");
  });
});
