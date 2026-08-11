/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

import InputStatic from "./input-static";

jest.mock("@cocalc/frontend/components/static-code-block.css", () => ({}));

describe("InputStatic", () => {
  it("renders highlighted code with an overlay-only copy control", () => {
    const { container } = render(
      <InputStatic
        element={
          {
            data: {},
            str: "for n in range(3):\n    print(n)\n100",
          } as any
        }
        mode="python"
      />,
    );

    const code = container.querySelector(".cocalc-slate-code-block");
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent("100");
    expect(code?.querySelector(".token.number")).not.toBeNull();

    const copyButton = screen.getByRole("button", {
      name: "Copy to clipboard",
    });
    expect(copyButton).toHaveClass("cocalc-code-copy-button--overlay");
    expect(copyButton).toHaveTextContent("");
  });
});
