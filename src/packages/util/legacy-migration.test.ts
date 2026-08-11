/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { decodeLegacyPublicPathDescriptionEscapes } from "./legacy-migration";

describe("legacy migration text", () => {
  it("decodes escaped whitespace retained in public path descriptions", () => {
    expect(
      decodeLegacyPublicPathDescriptionEscapes(
        "First paragraph.\\n\\nSecond paragraph.\\n- item\\t-value",
      ),
    ).toBe("First paragraph.\n\nSecond paragraph.\n- item\t-value");
  });

  it("preserves LaTeX commands beginning with whitespace letters", () => {
    expect(
      decodeLegacyPublicPathDescriptionEscapes(
        "\\newcommand \\textbf \\rightarrow",
      ),
    ).toBe("\\newcommand \\textbf \\rightarrow");
  });
});
