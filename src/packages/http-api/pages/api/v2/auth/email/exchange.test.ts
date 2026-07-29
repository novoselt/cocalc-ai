/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/** @jest-environment node */

import { createMocks } from "@cocalc/http-api/lib/api/test-framework";

const verifyHomeBayRetryTokenMock = jest.fn();
const getPoolQueryMock = jest.fn();
const hasActiveSecondFactorMock = jest.fn();
const createSignInSecondFactorChallengeMock = jest.fn();
const emailRequiresCocalc2faMock = jest.fn();
const consumeEmailAuthExchangeMock = jest.fn();
const signUserInMock = jest.fn();

jest.mock("@cocalc/server/auth/home-bay-retry-token", () => ({
  verifyHomeBayRetryToken: (...args: any[]) =>
    verifyHomeBayRetryTokenMock(...args),
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: (...args: any[]) => getPoolQueryMock(...args) }),
}));

jest.mock("@cocalc/server/auth/two-factor", () => ({
  hasActiveSecondFactor: (...args: any[]) => hasActiveSecondFactorMock(...args),
  createSignInSecondFactorChallenge: (...args: any[]) =>
    createSignInSecondFactorChallengeMock(...args),
}));

jest.mock("@cocalc/database/settings/sso-policies", () => ({
  emailRequiresCocalc2fa: (...args: any[]) =>
    emailRequiresCocalc2faMock(...args),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-home",
}));

jest.mock("@cocalc/server/bay-public-origin", () => ({
  getBayPublicOriginForRequest: async () => "https://home.example.test",
}));

jest.mock("@cocalc/server/inter-bay/email-auth", () => ({
  consumeEmailAuthExchange: (...args: any[]) =>
    consumeEmailAuthExchangeMock(...args),
}));

jest.mock("../sign-in", () => ({
  signUserIn: (...args: any[]) => signUserInMock(...args),
}));

describe("/api/v2/auth/email/exchange", () => {
  beforeEach(() => {
    verifyHomeBayRetryTokenMock.mockReset().mockReturnValue({
      account_id: "22222222-2222-4222-8222-222222222222",
      challenge_id: "11111111-1111-4111-8111-111111111111",
      email: "person@example.edu",
      home_bay_id: "bay-home",
      jti: "33333333-3333-4333-8333-333333333333",
      primary_auth_method: "email_code",
      primary_verified_at: "2026-07-29T01:00:00.000Z",
    });
    getPoolQueryMock.mockReset().mockResolvedValue({
      rows: [
        {
          banned: false,
          email_address: "person@example.edu",
        },
      ],
    });
    hasActiveSecondFactorMock.mockReset().mockResolvedValue(false);
    createSignInSecondFactorChallengeMock.mockReset();
    emailRequiresCocalc2faMock.mockReset().mockResolvedValue(false);
    consumeEmailAuthExchangeMock.mockReset().mockResolvedValue({
      account_id: "22222222-2222-4222-8222-222222222222",
      auth_method: "email_code",
      email_proved_at: "2026-07-29T01:00:00.000Z",
    });
    signUserInMock.mockReset().mockImplementation(async (_req, res) => {
      res.json({
        account_id: "22222222-2222-4222-8222-222222222222",
      });
    });
  });

  it("consumes the exchange and creates an email-auth session", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: { retry_token: "x".repeat(64) },
    });
    const { exchange } = await import("./exchange");

    await exchange(req, res);

    expect(consumeEmailAuthExchangeMock).toHaveBeenCalledWith({
      account_id: "22222222-2222-4222-8222-222222222222",
      challenge_id: "11111111-1111-4111-8111-111111111111",
      completion: "completed",
      exchange_id: "33333333-3333-4333-8333-333333333333",
      home_bay_id: "bay-home",
    });
    expect(signUserInMock).toHaveBeenCalledWith(
      req,
      res,
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        password_verified_at: null,
        primary_auth_method: "email_code",
      }),
    );
  });

  it("binds an MFA challenge to the seed email challenge", async () => {
    hasActiveSecondFactorMock.mockResolvedValue(true);
    createSignInSecondFactorChallengeMock.mockResolvedValue({
      challenge_id: "44444444-4444-4444-8444-444444444444",
      methods: ["totp"],
    });
    const { req, res } = createMocks({
      method: "POST",
      body: { retry_token: "x".repeat(64) },
    });
    const { exchange } = await import("./exchange");

    await exchange(req, res);

    expect(createSignInSecondFactorChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: "22222222-2222-4222-8222-222222222222",
        metadata: {
          email_auth_challenge_id: "11111111-1111-4111-8111-111111111111",
        },
        primary_auth_method: "email_code",
      }),
    );
    expect(consumeEmailAuthExchangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ completion: "mfa_required" }),
    );
    expect(res._getJSONData()).toMatchObject({
      challenge_id: "44444444-4444-4444-8444-444444444444",
      mfa_required: true,
      methods: ["totp"],
    });
    expect(signUserInMock).not.toHaveBeenCalled();
  });
});
