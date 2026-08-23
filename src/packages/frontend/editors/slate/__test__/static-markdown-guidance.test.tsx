/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import StaticMarkdown from "../static-markdown";

describe("static guidance rendering", () => {
  it("marks rich guidance content as a constrained layout boundary", () => {
    render(
      <StaticMarkdown
        value={
          '```guidance\n<img src="/blobs/test.png" width="1200px" height="700px" />\n```'
        }
      />,
    );

    const guidance = screen.getByRole("region", { name: "Guidance sent" });
    expect(guidance).toHaveClass("cocalc-slate-guidance");
    expect(
      guidance.querySelector(".cocalc-slate-guidance-content img"),
    ).not.toBeNull();
  });
});
