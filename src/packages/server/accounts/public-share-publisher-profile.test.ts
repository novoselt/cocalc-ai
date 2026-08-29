/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH } from "@cocalc/util/public-directory-share-labels";
import { normalizePublicShareReaderInstructions } from "./public-share-publisher-profile";

describe("public share publisher profile", () => {
  it("normalizes blank and surrounding whitespace", () => {
    expect(normalizePublicShareReaderInstructions("  Use **Copy**.  ")).toBe(
      "Use **Copy**.",
    );
    expect(normalizePublicShareReaderInstructions("   ")).toBeNull();
    expect(normalizePublicShareReaderInstructions(null)).toBeNull();
  });

  it("rejects instructions beyond the public profile limit", () => {
    expect(() =>
      normalizePublicShareReaderInstructions(
        "x".repeat(MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH + 1),
      ),
    ).toThrow("reader instructions must be at most");
  });
});
