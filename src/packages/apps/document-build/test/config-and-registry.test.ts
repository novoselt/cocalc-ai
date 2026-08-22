import {
  buildLatexCommand,
  documentBuildCapabilities,
  ensureTargetPathIsCorrect,
  parseLatexDirectives,
  resolveDocumentIdentity,
  resolveLatexBuildConfig,
  sanitizeLatexCommandArray,
  sanitizeLatexCommandString,
} from "../src";

describe("document build registry", () => {
  it("resolves logical, working, and exclusive resource paths", () => {
    expect(resolveDocumentIdentity("notes/paper.tex")).toEqual({
      kind: "latex",
      logical_path: "notes/paper.tex",
      working_path: "notes/paper.tex",
      resource_key: "notes/paper.tex",
    });
    expect(resolveDocumentIdentity("notes/paper.Rnw")).toEqual({
      kind: "knitr",
      logical_path: "notes/paper.Rnw",
      working_path: "notes/paper.tex",
      resource_key: "notes/paper.tex",
    });
    expect(resolveDocumentIdentity("notes/report.Rmd").resource_key).toBe(
      "notes/report.document-output",
    );
    expect(resolveDocumentIdentity("notes/report.qmd").resource_key).toBe(
      "notes/report.document-output",
    );
  });

  it("publishes the authoritative extension list", () => {
    expect(documentBuildCapabilities()).toEqual({
      kinds: [
        { kind: "latex", extensions: ["tex"] },
        { kind: "knitr", extensions: ["rnw", "rtex"] },
        { kind: "r-markdown", extensions: ["rmd"] },
        { kind: "quarto", extensions: ["qmd"] },
      ],
      extensions: ["tex", "rnw", "rtex", "rmd", "qmd"],
      supports_cancel: true,
      supports_build_timeout: true,
    });
  });
});

describe("LaTeX configuration", () => {
  const outputDirectory = "/tmp/build";

  it("parses only the first 1000 lines and normalizes directive spelling", () => {
    expect(
      parseLatexDirectives(
        "%  !TeX   TS-program = xelatex\n% !TeX cocalc = latexmk -pdf custom.tex",
      ),
    ).toEqual({
      program: "xelatex",
      cocalc: "latexmk -pdf custom.tex",
    });
  });

  it("uses cocalc directive, saved command, program, then default", () => {
    const common = {
      workingPath: "paper.tex",
      knitr: false,
      outputDirectory,
    };
    expect(
      resolveLatexBuildConfig({
        ...common,
        source: "% !TeX cocalc = latexmk -xelatex old.tex",
        saved: { build_command: ["latexmk", "-pdf", "saved.tex"] },
      }).source,
    ).toBe("cocalc-directive");
    expect(
      resolveLatexBuildConfig({
        ...common,
        source: "% !TeX program = xelatex",
        saved: { build_command: ["latexmk", "-pdf", "saved.tex"] },
      }).source,
    ).toBe("saved");
    expect(
      resolveLatexBuildConfig({
        ...common,
        source: "% !TeX program = xelatex",
      }),
    ).toMatchObject({
      source: "program-directive",
      build_command: expect.arrayContaining(["-xelatex"]),
    });
    expect(
      resolveLatexBuildConfig({ ...common, source: "\\documentclass{article}" })
        .source,
    ).toBe("default");
  });

  it("preserves existing target and dependency sanitization", () => {
    expect(ensureTargetPathIsCorrect("pdflatex old.tex", "my paper.tex")).toBe(
      "pdflatex 'my paper.tex'",
    );
    expect(
      sanitizeLatexCommandString(
        "latexmk -pdf -output-directory=/tmp/old old.tex",
        "paper.tex",
        outputDirectory,
      ),
    ).toBe("latexmk -pdf -deps -output-directory=/tmp/build  'paper.tex'");
    expect(
      sanitizeLatexCommandArray(
        ["latexmk", "-pdf", "-f", "-deps-", "old.tex"],
        "paper.tex",
        outputDirectory,
      ),
    ).toEqual(["latexmk", "-pdf", "-f", "-deps", "paper.tex"]);
  });

  it("generates the existing engine command shape", () => {
    expect(
      buildLatexCommand("XeLaTeX", "paper.tex", false, outputDirectory),
    ).toEqual([
      "latexmk",
      "-xelatex",
      "-f",
      "-g",
      "-bibtex",
      "-deps",
      "-synctex=1",
      "-interaction=nonstopmode",
      "-output-directory=/tmp/build",
      "paper.tex",
    ]);
  });
});
