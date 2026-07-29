/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  EMAIL_AUTHENTICATION_MODES,
  normalizeEmailAuthenticationMode,
} from "./email-auth";

describe("email authentication mode", () => {
  it("accepts every declared mode", () => {
    for (const mode of EMAIL_AUTHENTICATION_MODES) {
      expect(normalizeEmailAuthenticationMode(mode)).toBe(mode);
    }
  });

  it("fails closed to password_required for unknown values", () => {
    expect(normalizeEmailAuthenticationMode(undefined)).toBe(
      "password_required",
    );
    expect(normalizeEmailAuthenticationMode("future-mode")).toBe(
      "password_required",
    );
  });
});
