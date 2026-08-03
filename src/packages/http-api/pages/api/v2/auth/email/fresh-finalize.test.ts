/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/** @jest-environment node */

import { createMocks } from "@cocalc/http-api/lib/api/test-framework";

const getAccountIdMock = jest.fn();
const getRememberMeHashMock = jest.fn();
const hasActiveSecondFactorMock = jest.fn();
const requireFreshAuthMock = jest.fn();
const setCurrentSessionFreshAuthMock = jest.fn();
const completeEmailFreshAuthMock = jest.fn();

jest.mock("@cocalc/http-api/lib/account/get-account", () => ({
  __esModule: true,
  default: (...args: any[]) => getAccountIdMock(...args),
}));

jest.mock("@cocalc/server/auth/remember-me", () => ({
  getRememberMeHash: (...args: any[]) => getRememberMeHashMock(...args),
}));

jest.mock("@cocalc/server/auth/two-factor", () => ({
  hasActiveSecondFactor: (...args: any[]) => hasActiveSecondFactorMock(...args),
}));

jest.mock("@cocalc/server/auth/auth-sessions", () => ({
  FRESH_AUTH_DEFAULT_MS: 15 * 60_000,
  requireFreshAuth: (...args: any[]) => requireFreshAuthMock(...args),
  setCurrentSessionFreshAuth: (...args: any[]) =>
    setCurrentSessionFreshAuthMock(...args),
}));

jest.mock("@cocalc/server/inter-bay/email-auth", () => ({
  completeEmailFreshAuth: (...args: any[]) =>
    completeEmailFreshAuthMock(...args),
}));

describe("/api/v2/auth/email/fresh-finalize", () => {
  beforeEach(() => {
    getAccountIdMock
      .mockReset()
      .mockResolvedValue("22222222-2222-4222-8222-222222222222");
    getRememberMeHashMock.mockReset().mockReturnValue("session-hash");
    hasActiveSecondFactorMock.mockReset().mockResolvedValue(false);
    requireFreshAuthMock.mockReset().mockResolvedValue({});
    setCurrentSessionFreshAuthMock.mockReset().mockResolvedValue(undefined);
    completeEmailFreshAuthMock.mockReset().mockResolvedValue({
      auth_method: "email_code",
      email_proved_at: "2026-07-29T01:00:00.000Z",
    });
  });

  it("makes the current passwordless session fresh after email proof", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        challenge_id: "11111111-1111-4111-8111-111111111111",
      },
    });
    const { default: handler } = await import("./fresh-finalize");

    await handler(req, res);

    expect(completeEmailFreshAuthMock).toHaveBeenCalledWith({
      account_id: "22222222-2222-4222-8222-222222222222",
      challenge_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(setCurrentSessionFreshAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "22222222-2222-4222-8222-222222222222",
        factor_level: "none",
        primary_auth_method: "email_code",
        primary_verified_at: new Date("2026-07-29T01:00:00.000Z"),
      }),
    );
    expect(requireFreshAuthMock).not.toHaveBeenCalled();
    expect(res._getJSONData()).toMatchObject({ ok: true });
  });

  it("requires the configured second factor before consuming email proof", async () => {
    hasActiveSecondFactorMock.mockResolvedValue(true);
    requireFreshAuthMock.mockRejectedValue(
      Object.assign(new Error("fresh auth is required"), {
        code: "fresh_auth_required",
      }),
    );
    const { req, res } = createMocks({
      method: "POST",
      body: {
        challenge_id: "11111111-1111-4111-8111-111111111111",
      },
    });
    const { default: handler } = await import("./fresh-finalize");

    await handler(req, res);

    expect(res._getJSONData()).toMatchObject({
      error: "fresh auth is required",
    });
    expect(completeEmailFreshAuthMock).not.toHaveBeenCalled();
    expect(setCurrentSessionFreshAuthMock).not.toHaveBeenCalled();
  });
});
