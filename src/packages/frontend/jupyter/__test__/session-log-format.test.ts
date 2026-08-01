import {
  notebookToSessionLog,
  sessionLogSyntaxExtension,
} from "../session-log-format";

describe("notebookToSessionLog", () => {
  it("formats a multiline Python session with textual output", () => {
    expect(
      notebookToSessionLog({
        metadata: { kernelspec: { name: "python3" } },
        cells: [
          {
            cell_type: "code",
            execution_count: 2,
            source: ["for n in range(2):\n", "    print(n)"],
            outputs: [
              { output_type: "stream", name: "stdout", text: ["0\n", "1\n"] },
              {
                output_type: "display_data",
                data: {
                  "image/png": "base64",
                  "text/plain": "<Figure size 640x480>",
                },
              },
            ],
          },
        ],
      }),
    ).toBe(
      ">>> for n in range(2):\n" +
        "...     print(n)\n" +
        "0\n" +
        "1\n" +
        "<Figure size 640x480>\n",
    );
  });

  it("uses Sage prompts and includes markdown and clean tracebacks", () => {
    expect(
      notebookToSessionLog({
        metadata: { kernelspec: { display_name: "SageMath 10" } },
        cells: [
          { cell_type: "markdown", source: ["## Example\n", "Some context"] },
          {
            cell_type: "code",
            source: "1/0",
            outputs: [
              {
                output_type: "error",
                traceback: [
                  "\u001b[31mZeroDivisionError\u001b[0m",
                  "division by zero",
                ],
              },
            ],
          },
        ],
      }),
    ).toBe(
      "# [Markdown]\n" +
        "# ## Example\n" +
        "# Some context\n\n" +
        "sage: 1/0\n" +
        "ZeroDivisionError\n" +
        "division by zero\n",
    );
  });

  it("uses a concise placeholder only when no text representation exists", () => {
    expect(
      notebookToSessionLog({
        metadata: { language_info: { name: "julia" } },
        cells: [
          {
            cell_type: "code",
            source: "plot(x)",
            outputs: [
              {
                output_type: "display_data",
                data: { "image/svg+xml": "<svg />" },
              },
            ],
          },
        ],
      }),
    ).toBe("julia> plot(x)\n[image/svg+xml output]\n");
  });

  it("falls back to numbered Jupyter prompts for unknown kernels", () => {
    expect(
      notebookToSessionLog({
        metadata: { kernelspec: { name: "custom" } },
        cells: [
          {
            cell_type: "code",
            execution_count: 12,
            source: "first\nsecond",
          },
        ],
      }),
    ).toBe("In [12]: first\n   ...: second\n");
  });

  it("selects a CodeMirror mode from the notebook kernel", () => {
    expect(
      sessionLogSyntaxExtension({
        metadata: { kernelspec: { display_name: "SageMath 10" } },
      }),
    ).toBe("py");
    expect(
      sessionLogSyntaxExtension({
        metadata: { language_info: { name: "julia" } },
      }),
    ).toBe("jl");
    expect(sessionLogSyntaxExtension({})).toBe("txt");
  });
});
