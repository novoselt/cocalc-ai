/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { projectEntitlementOverrideError } from "./project-entitlement-override-button";

describe("projectEntitlementOverrideError", () => {
  it("extracts a readable message from a structured RPC error", () => {
    expect(
      projectEntitlementOverrideError({
        error: {
          message: "Disk quota must be at least the current project usage.",
          code: "INVALID_ARGUMENT",
        },
      }),
    ).toEqual({
      message: "Disk quota must be at least the current project usage.",
      details:
        '{"error":{"message":"Disk quota must be at least the current project usage.","code":"INVALID_ARGUMENT"}}',
    });
  });

  it("never renders an opaque object string", () => {
    const formatted = projectEntitlementOverrideError({ code: "FAILED" });
    expect(formatted.message).not.toBe("[object Object]");
    expect(formatted.message).toContain("FAILED");
  });
});
