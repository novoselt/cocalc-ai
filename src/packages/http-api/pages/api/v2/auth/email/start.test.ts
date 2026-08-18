/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/** @jest-environment node */

import { createMocks } from "@cocalc/http-api/lib/api/test-framework";

const getServerSettingsMock = jest.fn();
const isEmailConfiguredMock = jest.fn();
const getStrategiesMock = jest.fn();
const startEmailAuthChallengeMock = jest.fn();
const selectSignupHomeBayMock = jest.fn();

jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: (...args) => getServerSettingsMock(...args),
}));

jest.mock("@cocalc/server/email/send-email", () => ({
  isEmailConfigured: (...args) => isEmailConfiguredMock(...args),
}));

jest.mock("@cocalc/database/settings/get-sso-strategies", () => ({
  __esModule: true,
  default: (...args) => getStrategiesMock(...args),
}));

jest.mock("@cocalc/server/inter-bay/email-auth", () => ({
  startEmailAuthChallenge: (...args) => startEmailAuthChallengeMock(...args),
}));

jest.mock("@cocalc/server/accounts/select-home-bay", () => ({
  selectSignupHomeBay: (...args) => selectSignupHomeBayMock(...args),
}));

describe("/api/v2/auth/email/start", () => {
  beforeEach(() => {
    getServerSettingsMock.mockReset().mockResolvedValue({
      email_authentication_mode: "email_first",
      email_enabled: true,
      verify_emails: true,
    });
    isEmailConfiguredMock.mockReset().mockResolvedValue(true);
    getStrategiesMock.mockReset().mockResolvedValue([]);
    startEmailAuthChallengeMock.mockReset().mockResolvedValue({
      challenge_id: "11111111-1111-4111-8111-111111111111",
      purpose: "sign_in_or_sign_up",
      state: "pending",
      masked_email: "pe…@example.edu",
      expires_at: "2026-07-29T01:15:00.000Z",
      resend_available_at: "2026-07-29T01:00:30.000Z",
      send_count: 1,
      message_sent: true,
      message_failed: false,
    });
    selectSignupHomeBayMock.mockReset().mockResolvedValue("bay-test");
  });

  it("fails closed while email-first mode is disabled", async () => {
    getServerSettingsMock.mockResolvedValue({
      email_authentication_mode: "verify_after_signup",
      email_enabled: true,
      verify_emails: true,
    });
    const { req, res } = createMocks({
      method: "POST",
      url: "/api/v2/auth/email/start",
      headers: { "content-type": "application/json" },
      body: { email: "person@example.edu" },
    });

    const { default: handler } = await import("./start");
    await handler(req, res);

    expect(res._getJSONData()).toEqual({
      error: "Email sign-in is not enabled for this site.",
    });
    expect(startEmailAuthChallengeMock).not.toHaveBeenCalled();
  });

  it("sets an essential HttpOnly flow cookie and starts on the seed authority", async () => {
    const { req, res } = createMocks({
      method: "POST",
      url: "/api/v2/auth/email/start",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: {
        email: "Person@Example.EDU",
        onboarding_intent: "jupyter-python",
        target: "/projects/project-id/files?path=README.md#preview",
      },
    });

    const { default: handler } = await import("./start");
    await handler(req, res);

    expect(res._getJSONData()).toMatchObject({
      state: "pending",
      masked_email: "pe…@example.edu",
    });
    const cookie = `${res.getHeader("Set-Cookie")}`;
    expect(cookie).toContain("cocalc_email_auth_flow=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(startEmailAuthChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email_address: "person@example.edu",
        browser_binding: expect.any(String),
        continuation_target:
          "/projects/project-id/files?path=README.md#preview",
        onboarding_intent: "jupyter-python",
      }),
    );
    expect(
      startEmailAuthChallengeMock.mock.calls[0][0].browser_binding.length,
    ).toBeGreaterThanOrEqual(24);
  });

  it("reuses an existing browser-flow cookie", async () => {
    const { req, res } = createMocks({
      method: "POST",
      url: "/api/v2/auth/email/start",
      headers: {
        "content-type": "application/json",
        cookie: "cocalc_email_auth_flow=existing-binding",
      },
      body: { email: "person@example.edu" },
    });

    const { default: handler } = await import("./start");
    await handler(req, res);

    expect(res.getHeader("Set-Cookie")).toBeUndefined();
    expect(startEmailAuthChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        browser_binding: "existing-binding",
      }),
    );
  });

  it("does not retain an external continuation target", async () => {
    const { req, res } = createMocks({
      method: "POST",
      url: "/api/v2/auth/email/start",
      headers: { "content-type": "application/json" },
      body: {
        email: "person@example.edu",
        target: "//evil.example.test/steal",
      },
    });

    const { default: handler } = await import("./start");
    await handler(req, res);

    expect(startEmailAuthChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        continuation_target: undefined,
      }),
    );
  });

  it("routes required organization domains to SSO without sending email", async () => {
    getStrategiesMock.mockResolvedValue([
      {
        name: "university",
        display: "University SSO",
        exclusiveDomains: ["example.edu"],
      },
    ]);
    const { req, res } = createMocks({
      method: "POST",
      url: "/api/v2/auth/email/start",
      headers: { "content-type": "application/json" },
      body: { email: "person@example.edu" },
    });

    const { default: handler } = await import("./start");
    await handler(req, res);

    expect(res._getJSONData()).toEqual({
      sso_required: true,
      strategy: {
        name: "university",
        display: "University SSO",
      },
    });
    expect(startEmailAuthChallengeMock).not.toHaveBeenCalled();
  });
});
