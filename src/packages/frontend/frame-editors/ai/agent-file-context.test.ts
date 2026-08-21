import {
  agentFileLocation,
  describeAgentFileLocation,
  describeLineRange,
  shellJoin,
} from "./agent-file-context";

jest.mock("@cocalc/frontend/project/home-directory", () => ({
  getProjectHomeDirectory: () => "/home/user",
}));

describe("agentFileLocation", () => {
  it("resolves the absolute path and normalizes the line range", () => {
    expect(
      agentFileLocation({
        project_id: "p",
        path: "latex/paper.tex",
        line: 12.7,
        line_end: 30,
      }),
    ).toEqual({
      path: "latex/paper.tex",
      absolute_path: "/home/user/latex/paper.tex",
      line: 12,
      line_end: 30,
    });
    expect(
      agentFileLocation({
        project_id: "p",
        path: "a.py",
        line: 5,
        line_end: 2,
      }),
    ).toMatchObject({ line: 5, line_end: 5 });
    expect(agentFileLocation({ path: "a.py", line: 0 }).line).toBeUndefined();
  });
});

describe("describeAgentFileLocation", () => {
  it("mentions both paths and the line range", () => {
    expect(
      describeAgentFileLocation(
        agentFileLocation({ project_id: "p", path: "a.py", line: 3 }),
      ),
    ).toBe("file `a.py` (absolute path `/home/user/a.py`) line 3");
    expect(
      describeAgentFileLocation(
        agentFileLocation({
          project_id: "p",
          path: "a.py",
          line: 3,
          line_end: 9,
        }),
      ),
    ).toBe("file `a.py` (absolute path `/home/user/a.py`) lines 3–9");
    expect(describeLineRange({})).toBe("");
  });
});

describe("shellJoin", () => {
  it("quotes arguments that are not plain words", () => {
    expect(
      shellJoin({
        command: "quarto",
        args: ["render", "a.qmd", "--log-level", "info"],
      }),
    ).toBe("quarto render a.qmd --log-level info");
    expect(
      shellJoin({
        command: "Rscript",
        args: ["-e", "rmarkdown::render('x.Rmd')"],
      }),
    ).toBe("Rscript -e 'rmarkdown::render('\\''x.Rmd'\\'')'");
    expect(
      shellJoin({ command: "latexmk", args: ["-pdf", "my paper.tex"] }),
    ).toBe("latexmk -pdf 'my paper.tex'");
    expect(shellJoin(undefined)).toBe("");
  });
});
