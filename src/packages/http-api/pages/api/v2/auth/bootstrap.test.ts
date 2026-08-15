/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/** @jest-environment node */

import { createMocks } from "@cocalc/http-api/lib/api/test-framework";

const mockGetAccountId = jest.fn();
const mockGetClusterAccountById = jest.fn();
const mockGetBayPublicOriginForRequest = jest.fn();
const mockGetImpersonationBootstrapInfo = jest.fn();

jest.mock("@cocalc/http-api/lib/account/get-account", () => ({
  __esModule: true,
  default: (...args) => mockGetAccountId(...args),
}));

jest.mock("@cocalc/server/inter-bay/accounts", () => ({
  getClusterAccountById: (...args) => mockGetClusterAccountById(...args),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-0",
}));

jest.mock("@cocalc/server/bay-public-origin", () => ({
  getBayPublicOriginForRequest: (...args) =>
    mockGetBayPublicOriginForRequest(...args),
}));

jest.mock("@cocalc/server/auth/impersonation", () => ({
  getImpersonationBootstrapInfo: (...args) =>
    mockGetImpersonationBootstrapInfo(...args),
}));

jest.mock("@cocalc/backend/base-path", () => ({
  __esModule: true,
  default: "/tenant",
}));

describe("/api/v2/auth/bootstrap", () => {
  beforeEach(() => {
    mockGetAccountId.mockReset();
    mockGetClusterAccountById.mockReset();
    mockGetBayPublicOriginForRequest
      .mockReset()
      .mockResolvedValue("https://bay-0.example.test");
    mockGetImpersonationBootstrapInfo.mockReset().mockResolvedValue(null);
  });

  it("uses display_name instead of stale legacy split names", async () => {
    mockGetAccountId.mockResolvedValue("account-1");
    mockGetClusterAccountById.mockResolvedValue({
      account_id: "account-1",
      display_name: "AdmiN",
      email_address: "admin@example.com",
      email_address_verified: true,
      first_name: "Admin",
      home_bay_id: "bay-0",
      last_name: "User",
    });
    const { req, res } = createMocks({
      method: "POST",
      url: "/api/v2/auth/bootstrap",
    });

    const { default: bootstrap } = await import("./bootstrap");
    await bootstrap(req, res);

    expect(res._getJSONData()).toEqual(
      expect.objectContaining({
        account_id: "account-1",
        display_name: "AdmiN",
        email_address: "admin@example.com",
        email_address_verified: true,
        signed_in: true,
        client_capabilities: {
          protocol_version: 1,
          app_base_path: "/tenant",
          browser_challenge_login: 1,
          project_window: 1,
          project_host_routing: 1,
          chat_sync: 2,
          agent_session_index: 1,
          acp: 1,
        },
      }),
    );
  });

  it("advertises the same protocol before sign-in", async () => {
    mockGetAccountId.mockResolvedValue(undefined);
    const { req, res } = createMocks({
      method: "POST",
      url: "/tenant/api/v2/auth/bootstrap",
    });

    const { default: bootstrap } = await import("./bootstrap");
    await bootstrap(req, res);

    expect(res._getJSONData()).toEqual(
      expect.objectContaining({
        signed_in: false,
        client_capabilities: expect.objectContaining({
          protocol_version: 1,
          app_base_path: "/tenant",
          browser_challenge_login: 1,
        }),
      }),
    );
  });
});
