import { extractLineNumbers } from "./error-lines";

describe("extractLineNumbers", () => {
  it("parses the modern knitr/quarto 'file:from-to' form", () => {
    expect(
      extractLineNumbers(
        "Error:\n! deliberate error\n\nQuitting from agent-test.Rmd:8-11 [broken]\nExecution halted",
      ),
    ).toEqual([8, 11]);
    expect(
      extractLineNumbers("Quitting from agent-test.qmd:8-11 [broken]"),
    ).toEqual([8, 11]);
  });

  it("parses a file name containing spaces", () => {
    expect(
      extractLineNumbers("Quitting from my report.qmd:8-11 [broken]"),
    ).toEqual([8, 11]);
  });

  it("parses a single-line chunk", () => {
    expect(extractLineNumbers("Quitting from notes.qmd:42 [setup]")).toEqual([
      42, 42,
    ]);
  });

  it("still parses the older 'lines from-to' form", () => {
    expect(
      extractLineNumbers("Quitting from lines 58-79 (report.Rmd)"),
    ).toEqual([58, 79]);
  });

  it("returns null when no location is reported", () => {
    expect(extractLineNumbers("pandoc: command not found")).toBe(null);
    expect(extractLineNumbers("")).toBe(null);
  });
});
