/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import mathToHtml from "@cocalc/frontend/misc/math-to-html";

import { prepareMathEnvSource, stripMathLabels } from "./math-source";

describe("stripMathLabels", () => {
  it("removes \\label{…} anywhere in the source", () => {
    expect(stripMathLabels("a \\label{eq:gap} b")).toBe("a  b");
    expect(stripMathLabels("\\label {eq:x}c")).toBe("c");
    expect(stripMathLabels("no labels")).toBe("no labels");
  });
});

describe("prepareMathEnvSource", () => {
  it("stars non-starred envs and strips labels", () => {
    expect(
      prepareMathEnvSource(
        "\\begin{equation}\n\\label{eq:gap}\nx\n\\end{equation}",
      ),
    ).toBe("\\begin{equation*}\n\nx\n\\end{equation*}");
  });

  it("maps displaymath to equation*", () => {
    expect(
      prepareMathEnvSource("\\begin{displaymath}a\\end{displaymath}"),
    ).toBe("\\begin{equation*}a\\end{equation*}");
  });

  it("leaves starred envs, alignat, and eqnarray alone", () => {
    expect(prepareMathEnvSource("\\begin{align*}x\\end{align*}")).toBe(
      "\\begin{align*}x\\end{align*}",
    );
    expect(prepareMathEnvSource("\\begin{alignat}{2}x\\end{alignat}")).toBe(
      "\\begin{alignat}{2}x\\end{alignat}",
    );
    expect(prepareMathEnvSource("\\begin{eqnarray}x\\end{eqnarray}")).toBe(
      "\\begin{eqnarray}x\\end{eqnarray}",
    );
  });
});

describe("prepared env sources render in KaTeX (regression: labelled envs)", () => {
  // These are the real-world shapes that used to silently fall back to
  // raw source in the widgets view: KaTeX has no \label, so the render
  // threw and renderMath displayed the raw LaTeX instead of math.
  const CASES: [string, string][] = [
    [
      "equation with \\label",
      [
        "\\begin{equation}",
        "  \\label{eq:gap}",
        "  \\lambda_2(\\widehat{G}) \\;\\ge\\; 1 - \\varepsilon \\sqrt{\\frac{\\log n}{n}} .",
        "\\end{equation}",
      ].join("\n"),
    ],
    [
      "align with \\label, & and \\notag",
      [
        "\\begin{align}",
        "  \\Pr\\bigl[\\lambda_2(\\widehat{G}) < 1 - \\varepsilon\\bigr]",
        "    &\\le 2 \\exp\\bigl(-c\\,\\varepsilon^2 n\\bigr), \\label{eq:tail} \\\\",
        "  \\mathbb{E}\\,\\lambda_2(\\widehat{G})",
        "    &= 1 - \\Theta\\Bigl(\\sqrt{\\tfrac{\\log n}{n}}\\Bigr). \\notag",
        "\\end{align}",
      ].join("\n"),
    ],
    ["displaymath", "\\begin{displaymath}\n  a = b\n\\end{displaymath}"],
    [
      "eqnarray via darray compat hack",
      "\\begin{eqnarray}\n  x &=& y \\\\\n  u &=& v\n\\end{eqnarray}",
    ],
  ];

  it.each(CASES)("%s", (_name, source) => {
    const { err, __html } = mathToHtml(prepareMathEnvSource(source), false);
    expect(err).toBeUndefined();
    expect(__html).toContain("katex");
  });
});
