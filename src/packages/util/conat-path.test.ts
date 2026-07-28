/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { canonicalConatProxyPath, conatProxyPathsForBase } from "./conat-path";

describe("Conat proxy paths", () => {
  it("keeps the canonical path available with a public alias", () => {
    expect(conatProxyPathsForBase("/", "workspace-conat")).toEqual([
      "/conat",
      "/workspace-conat",
    ]);
    expect(conatProxyPathsForBase("/base", "workspace-conat")).toEqual([
      "/base/conat",
      "/base/workspace-conat",
    ]);
  });

  it("deduplicates the default public path", () => {
    expect(conatProxyPathsForBase("/", "conat")).toEqual(["/conat"]);
  });

  it("rewrites a public alias to the canonical upstream path", () => {
    expect(
      canonicalConatProxyPath(
        "/base/workspace-conat/?EIO=4&transport=websocket",
        "workspace-conat",
      ),
    ).toBe("/conat/?EIO=4&transport=websocket");
  });

  it("preserves canonical paths and rejects unrelated paths", () => {
    expect(canonicalConatProxyPath("/conat/?EIO=4", "workspace-conat")).toBe(
      "/conat/?EIO=4",
    );
    expect(() =>
      canonicalConatProxyPath("/not-conat/", "workspace-conat"),
    ).toThrow("invalid Conat proxy path");
  });
});
