/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { render, screen } from "@testing-library/react";

import LazyMarkdown from "./lazy-markdown";

jest.mock("./markdown", () => ({
  Markdown: ({ value }: { value?: string }) => (
    <div data-testid="rich-markdown">rich: {value}</div>
  ),
}));

describe("LazyMarkdown", () => {
  it("shows readable source while loading, then upgrades to rich Markdown", async () => {
    render(<LazyMarkdown id="plain-markdown" value="**hello**" />);

    expect(document.getElementById("plain-markdown")).toHaveTextContent(
      "**hello**",
    );
    expect(await screen.findByTestId("rich-markdown")).toHaveTextContent(
      "rich: **hello**",
    );
  });
});
