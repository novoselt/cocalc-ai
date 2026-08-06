/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { versions } from "@cocalc/cdn";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { pdfjsCMapUrl } from "./pdfjs-doc-cache";

describe("PDF.js CMap assets", () => {
  it("uses the real CDN package version", () => {
    const version = versions["pdfjs-dist"];

    expect(version).toEqual(expect.any(String));
    expect(version).not.toHaveLength(0);
    expect(pdfjsCMapUrl()).toBe(
      `${appBasePath}/cdn/pdfjs-dist-${version}/cmaps/`,
    );
    expect(pdfjsCMapUrl()).not.toContain("undefined");
  });

  it("preserves an installation URL prefix", () => {
    expect(pdfjsCMapUrl("/cocalc-prefix")).toBe(
      `/cocalc-prefix/cdn/pdfjs-dist-${versions["pdfjs-dist"]}/cmaps/`,
    );
  });
});
