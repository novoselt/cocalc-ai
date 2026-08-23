/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const updateExternalCredentialPayloadLockedMock = jest.fn();

jest.mock("./store", () => ({
  updateExternalCredentialPayloadLocked: (...args: any[]) =>
    updateExternalCredentialPayloadLockedMock(...args),
}));

import {
  hashCodexAccessToken,
  refreshCodexSubscriptionAuth,
} from "./codex-subscription-refresh";

function authPayload(accessToken: string): string {
  return JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: accessToken,
      refresh_token: "refresh-old",
      id_token: "id-old",
      account_id: "workspace-1",
    },
  });
}

describe("refreshCodexSubscriptionAuth", () => {
  beforeEach(() => {
    updateExternalCredentialPayloadLockedMock.mockReset();
    updateExternalCredentialPayloadLockedMock.mockImplementation(
      async ({ update }) => {
        const current = {
          id: "credential-1",
          provider: "openai",
          kind: "codex-subscription-auth-json",
          scope: "account",
          owner_account_id: "account-1",
          payload: authPayload("access-old"),
          metadata: { source: "device-auth" },
          created: new Date("2026-01-01T00:00:00Z"),
          updated: new Date("2026-01-01T00:00:00Z"),
          revoked: null,
          last_used: null,
        };
        const next = await update(current);
        return next
          ? {
              ...current,
              ...next,
              updated: new Date("2026-01-02T00:00:00Z"),
            }
          : current;
      },
    );
  });

  it("rotates and persists an expired access token", async () => {
    const fetchImpl = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-new",
            refresh_token: "refresh-new",
            id_token: "id-new",
          }),
          { status: 200 },
        ),
    );

    const result = await refreshCodexSubscriptionAuth({
      ownerAccountId: "account-1",
      previousAccessTokenHash: hashCodexAccessToken("access-old"),
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.refreshed).toBe(true);
    expect(result.updated.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    const parsed = JSON.parse(result.payload);
    expect(parsed.tokens).toMatchObject({
      access_token: "access-new",
      refresh_token: "refresh-new",
      id_token: "id-new",
      account_id: "workspace-1",
    });
    expect(parsed.last_refresh).toEqual(expect.any(String));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reuses a token another project host already refreshed", async () => {
    const fetchImpl = jest.fn();

    const result = await refreshCodexSubscriptionAuth({
      ownerAccountId: "account-1",
      previousAccessTokenHash: hashCodexAccessToken("access-stale-host"),
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.refreshed).toBe(false);
    expect(JSON.parse(result.payload).tokens.access_token).toBe("access-old");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns a permanently invalid refresh token into a sign-in error", async () => {
    const fetchImpl = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "refresh_token_reused" },
          }),
          { status: 400 },
        ),
    );

    await expect(
      refreshCodexSubscriptionAuth({
        ownerAccountId: "account-1",
        previousAccessTokenHash: hashCodexAccessToken("access-old"),
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("Sign in again with ChatGPT in CoCalc");
  });
});
