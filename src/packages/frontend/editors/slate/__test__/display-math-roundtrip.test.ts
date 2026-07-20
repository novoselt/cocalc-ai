/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import "../elements/types";

import { markdown_to_slate } from "../markdown-to-slate";
import { slate_to_markdown } from "../slate-to-markdown";

const REPRODUCTION = String.raw`## Case 2

Let's explore another potential pitfall of relying on dominant eigenvalues. Consider a population of sea otters and pallas cats. In the absence of humans, these populations grow exponentially. The sea otter population increases at a rate of 2% per year, while the pallas cat population increases at a rate of 40% per year. Since sea otters rely mostly on the sea for resources, the two populations do not affect each other.
We are going to set up a model for the population of Sea Otters $(S)$ and Pallas Cats $(P)$,
$$\begin{pmatrix} S_{N+1} \\P_{N+1} \end{pmatrix} = M \begin{pmatrix}S_N \\ P_N\end{pmatrix}$$
`;

describe("display math markdown roundtrip", () => {
  it("preserves display math after an adjacent paragraph is edited", () => {
    const slate = markdown_to_slate(REPRODUCTION, false, {}) as any[];
    const paragraph = slate.find((node) => node.type === "paragraph");
    const text = paragraph?.children?.find((node) =>
      node.text?.includes("potential pitfall"),
    );
    expect(text).toBeDefined();
    text.text = text.text.replace("potential pitfall", "possible pitfall");

    const markdown = slate_to_markdown(slate, { preserveBlankLines: true });

    expect(markdown).toContain(
      String.raw`$$\begin{pmatrix} S_{N+1} \\P_{N+1} \end{pmatrix} = M \begin{pmatrix}S_N \\ P_N\end{pmatrix}$$`,
    );
  });

  it("does not add dollar delimiters to a bare LaTeX environment", () => {
    const source = String.raw`Before \begin{equation}x^2\end{equation} after`;
    const slate = markdown_to_slate(source, false, {});

    const markdown = slate_to_markdown(slate, { preserveBlankLines: true });

    expect(markdown).toContain(String.raw`\begin{equation}x^2\end{equation}`);
    expect(markdown).not.toContain(
      String.raw`$$\begin{equation}x^2\end{equation}$$`,
    );
  });
});
