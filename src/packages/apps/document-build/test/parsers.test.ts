import {
  extractDocumentErrorLines,
  parseKnitrDiagnostics,
  parseLatexLog,
  parsePythontexDiagnostics,
  parseSagetexDiagnostics,
} from "../src";

describe("document diagnostics", () => {
  it("parses LaTeX errors, warnings, typesetting, files, and dependencies", () => {
    const parsed = parseLatexLog(
      [
        "latex banner",
        "(/home/user/paper.tex",
        "LaTeX Warning: Reference `x' undefined on input line 12.",
        "Overfull \\hbox (1.0pt too wide) in paragraph at lines 20--21",
        "! Undefined control sequence.",
        "l.7 \\bad",
        "#===Dependents for paper.pdf:",
        "chapter.tex \\",
        "/usr/share/texmf/base.sty \\",
        "image.png \\",
        "#===End dependents for paper.pdf:",
      ].join("\n"),
    );
    expect(parsed.errors[0]).toMatchObject({ line: 7 });
    expect(parsed.warnings[0]).toMatchObject({ line: 12 });
    expect(parsed.typesetting[0]).toMatchObject({ line: 20 });
    expect(parsed.files).toContain("/home/user/paper.tex");
    expect(parsed.deps).toEqual(["chapter.tex"]);
  });

  it("parses Knitr, SageTeX, and PythonTeX errors", () => {
    expect(
      parseKnitrDiagnostics(
        "processing file: report.Rnw\nError in parse(text = code)\nQuitting from lines 26-30 (report.Rnw)",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "knitr",
          file: "report.Rnw",
          line: 26,
        }),
      ]),
    );
    expect(
      parseSagetexDiagnostics("paper.tex", "trace\nSyntaxError\n"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "sagetex", message: "SyntaxError" }),
      ]),
    );
    expect(
      parsePythontexDiagnostics(
        "paper.tex",
        "---- Messages ----\n* PythonTeX stderr - error on line 19:\nSyntaxError\n-----",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "pythontex", line: 19 }),
      ]),
    );
  });

  it("parses modern and legacy Markdown error locations", () => {
    expect(
      extractDocumentErrorLines("Quitting from report.qmd:8-11 [x]"),
    ).toEqual([8, 11]);
    expect(
      extractDocumentErrorLines("Quitting from lines 42-44 (x.Rmd)"),
    ).toEqual([42, 44]);
  });
});
