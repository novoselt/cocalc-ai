/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { render, screen } from "@testing-library/react";

import LazyKaTeX from "./lazy-katex";

jest.mock("./katex", () => ({
  __esModule: true,
  default: ({ data }: { data: string }) => (
    <span data-testid="rendered-math">rendered: {data}</span>
  ),
}));

describe("LazyKaTeX", () => {
  it("shows the formula source while loading, then renders it", async () => {
    render(<LazyKaTeX data="$x^2$" />);

    expect(screen.getByText("$x^2$")).toBeInTheDocument();
    expect(await screen.findByTestId("rendered-math")).toHaveTextContent(
      "rendered: $x^2$",
    );
  });
});
