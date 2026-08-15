import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import NotebookView, { parseNotebook, sourceText } from "./notebook-view";

test("joins Jupyter multiline sources without changing content", () => {
  expect(sourceText(["print('a')\n", "print('b')\n"])).toBe(
    "print('a')\nprint('b')\n",
  );
});

test("accepts notebook cell arrays", () => {
  expect(parseNotebook('{"nbformat":4,"cells":[]}')).toEqual({
    nbformat: 4,
    cells: [],
  });
});

test("rejects non-notebook JSON", () => {
  expect(() => parseNotebook('{"value":1}')).toThrow(
    "This file is not a valid Jupyter notebook.",
  );
});

test("does not execute notebook HTML output", () => {
  render(
    <NotebookView
      notebook={{
        cells: [
          {
            cell_type: "code",
            outputs: [
              {
                data: { "text/html": "<script>window.pwned = true</script>" },
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/Interactive HTML output is omitted/)).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
});
