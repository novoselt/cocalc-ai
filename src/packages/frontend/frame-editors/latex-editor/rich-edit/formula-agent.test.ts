jest.mock("@cocalc/frontend/project/new/navigator-intents", () => ({
  dispatchNavigatorPromptIntent: jest.fn(),
  submitNavigatorPromptInWorkspaceChat: jest.fn(),
}));

jest.mock("@cocalc/frontend/project/home-directory", () => ({
  getProjectHomeDirectory: () => "/home/user",
}));

import {
  createFormulaAgentPrompt,
  createFormulaAgentVisiblePrompt,
} from "./formula-agent";

describe("Formula Agent prompt", () => {
  it("includes the full project path, formula, and one-based line number", () => {
    const prompt = createFormulaAgentPrompt({
      project_id: "project-id",
      path: "home/user/latex/widget.tex",
      source: "$x^2$",
      from: { line: 7, ch: 3 },
      to: { line: 7, ch: 8 },
      formulaType: "math-inline",
      formulaContent: "x^2",
      instruction: "Add a subscript n to x.",
    });
    expect(prompt).toContain("home/user/latex/widget.tex");
    expect(prompt).toContain(
      "The formula is in file `home/user/latex/widget.tex` (absolute path `/home/user/home/user/latex/widget.tex`) line 8.",
    );
    expect(prompt).toContain('"line": 8');
    expect(prompt).toContain("$$\nx^2\n$$");
    expect(prompt).not.toContain("$$\n$x^2$\n$$");
    expect(prompt).toContain("Add a subscript n to x.");
    expect(prompt).toContain("Do not ask them to repeat it.");
    expect(prompt).toContain("Do not merely reply with proposed LaTeX");
    expect(prompt).not.toContain("<details>");
  });

  it("points at the subfile the frame shows, not the main document", () => {
    const prompt = createFormulaAgentPrompt({
      project_id: "project-id",
      path: "latex/main.tex",
      filePath: "latex/sub1.tex",
      source: "$x^2$",
      from: { line: 2, ch: 0 },
      to: { line: 2, ch: 5 },
      formulaType: "math-inline",
      formulaContent: "x^2",
      instruction: "Make x bold.",
    });
    expect(prompt).toContain(
      "The document being edited is file `latex/main.tex` (absolute path `/home/user/latex/main.tex`).",
    );
    expect(prompt).toContain(
      "The formula is in file `latex/sub1.tex` (absolute path `/home/user/latex/sub1.tex`) line 3.",
    );
    expect(prompt).toContain('"formula_file": "latex/sub1.tex"');
    expect(prompt).toContain('"absolute_path": "/home/user/latex/sub1.tex"');
  });

  it("keeps the visible chat message to the formula and the request", () => {
    const visible = createFormulaAgentVisiblePrompt({
      project_id: "project-id",
      path: "home/user/latex/widget.tex",
      source: "$x^2$",
      from: { line: 7, ch: 3 },
      to: { line: 7, ch: 8 },
      formulaType: "math-inline",
      formulaContent: "x^2",
      instruction: "Add a subscript n to x.",
    });
    expect(visible).toBe(
      "**Edit this LaTeX formula:**\n$$\nx^2\n$$\n\n**Requested change:**\nAdd a subscript n to x.",
    );
    expect(visible).not.toContain("Intent metadata");
  });

  it("uses metadata for the file and exact source range", () => {
    const prompt = createFormulaAgentPrompt({
      project_id: "project-id",
      path: "home/user/latex/widget.tex",
      source: "$x^2$",
      from: { line: 7, ch: 3 },
      to: { line: 9, ch: 8 },
      formulaType: "math-inline",
      formulaContent: "x^2",
      instruction: "Add a subscript n to x.",
    });
    expect(prompt).toContain('"line": 8');
    expect(prompt).toContain('"line_end": 10');
    expect(prompt).not.toContain("Nearby source");
  });

  it("includes the explicit live-edit instruction", () => {
    const prompt = createFormulaAgentPrompt({
      project_id: "project-id",
      path: "home/user/latex/widget.tex",
      source: "$x^2$",
      from: { line: 7, ch: 3 },
      to: { line: 7, ch: 8 },
      formulaType: "math-inline",
      formulaContent: "x^2",
      instruction: "Add a subscript n to x.",
    });
    expect(prompt).toContain("Do not merely reply with proposed LaTeX");
    expect(prompt).toContain("Intent metadata");
  });

  it("keeps math environments free of nested display delimiters", () => {
    const source = "\\begin{align}x &= y\\end{align}";
    const prompt = createFormulaAgentPrompt({
      project_id: "project-id",
      path: "home/user/latex/widget.tex",
      source,
      from: { line: 0, ch: 0 },
      to: { line: 0, ch: source.length },
      formulaType: "math-env",
      instruction: "Swap the two sides.",
    });
    expect(prompt).toContain(`**Edit this LaTeX formula:**\n${source}`);
    expect(prompt).not.toContain(`$$\n${source}\n$$`);
  });
});
