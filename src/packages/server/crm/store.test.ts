/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { __test__ } from "./store";

describe("CRM mutation identity", () => {
  it("distinguishes identical changes to different records", () => {
    const proposed = { lifecycle_stage: "customer" };
    expect(
      __test__.mutationPayloadHash({
        action: "organization.update",
        target: "organization:first",
        proposed,
      }),
    ).not.toBe(
      __test__.mutationPayloadHash({
        action: "organization.update",
        target: "organization:second",
        proposed,
      }),
    );
  });
});

describe("CRM website normalization", () => {
  it("normalizes bare hostnames and preserves HTTPS URLs", () => {
    expect(__test__.normalizeWebsite("example.com/customer")).toBe(
      "https://example.com/customer",
    );
    expect(__test__.normalizeWebsite("https://example.com/customer")).toBe(
      "https://example.com/customer",
    );
    expect(__test__.normalizeWebsite("example.com:8443/customer")).toBe(
      "https://example.com:8443/customer",
    );
  });

  it("rejects active-content schemes and embedded credentials", () => {
    expect(() => __test__.normalizeWebsite("javascript:alert(1)")).toThrow(
      "website must use HTTP or HTTPS",
    );
    expect(() =>
      __test__.normalizeWebsite("https://user:secret@example.com"),
    ).toThrow("without credentials");
  });
});
