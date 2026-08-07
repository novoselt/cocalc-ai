/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";

let queryMock: jest.Mock;

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: (...args: any[]) => queryMock(...args) }),
}));

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("provider setup challenges", () => {
  const id = "00000000-1000-4000-8000-000000000020";
  const account_id = "00000000-1000-4000-8000-000000000001";
  const token = "provider-setup-token";

  beforeEach(() => {
    jest.resetModules();
    queryMock = jest.fn(async (sql) => {
      const text = `${sql}`;
      if (text.includes("CREATE TABLE") || text.includes("CREATE INDEX")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("DELETE FROM")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  function pendingRow() {
    return {
      id,
      account_id,
      provider: "gcp",
      token_hash: tokenHash(token),
      status: "pending",
      payload_json: null,
      error: null,
      created_at: new Date("2099-06-21T00:00:00.000Z"),
      expires_at: new Date("2099-06-21T00:15:00.000Z"),
      uploaded_at: null,
      applied_at: null,
    };
  }

  it("keeps provider upload challenges valid for one hour", async () => {
    const before = Date.now();
    queryMock.mockImplementation(async (sql, params) => {
      const text = `${sql}`;
      if (text.includes("CREATE TABLE") || text.includes("CREATE INDEX")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("DELETE FROM")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("INSERT INTO provider_setup_challenges")) {
        const expires_at = params[4];
        return {
          rows: [
            {
              ...pendingRow(),
              id: params[0],
              provider: params[1],
              token_hash: params[3],
              created_at: new Date(before),
              expires_at,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const { createProviderSetupChallenge } = await import("./challenges");

    const challenge = await createProviderSetupChallenge({
      account_id,
      provider: "gcp",
    });
    const lifetime = new Date(challenge.expires_at).getTime() - before;

    expect(lifetime).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(lifetime).toBeLessThan(60 * 60 * 1000 + 5_000);
  });

  it("atomically consumes a pending upload token", async () => {
    queryMock.mockImplementation(async (sql) => {
      const text = `${sql}`;
      if (text.includes("CREATE TABLE") || text.includes("CREATE INDEX")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("DELETE FROM")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT *")) {
        return { rows: [pendingRow()], rowCount: 1 };
      }
      if (text.includes("UPDATE provider_setup_challenges")) {
        return {
          rows: [
            {
              ...pendingRow(),
              status: "uploaded",
              payload_json: { private_key: "secret" },
              uploaded_at: new Date("2099-06-21T00:01:00.000Z"),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const { uploadProviderSetupChallengePayload } =
      await import("./challenges");

    await expect(
      uploadProviderSetupChallengePayload({
        id,
        token,
        payload: { private_key: "secret" },
      }),
    ).resolves.toMatchObject({
      id,
      status: "uploaded",
      payload: { private_key: "secret" },
    });

    const update = queryMock.mock.calls.find(([sql]) =>
      `${sql}`.includes("UPDATE provider_setup_challenges"),
    );
    expect(update?.[0]).toContain("AND status='pending'");
    expect(update?.[0]).toContain("AND expires_at > NOW()");
  });

  it("rejects replay when another request already consumed the upload token", async () => {
    queryMock.mockImplementation(async (sql) => {
      const text = `${sql}`;
      if (text.includes("CREATE TABLE") || text.includes("CREATE INDEX")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("DELETE FROM")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("SELECT *")) {
        return { rows: [pendingRow()], rowCount: 1 };
      }
      if (text.includes("UPDATE provider_setup_challenges")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { uploadProviderSetupChallengePayload } =
      await import("./challenges");

    await expect(
      uploadProviderSetupChallengePayload({
        id,
        token,
        payload: { private_key: "second" },
      }),
    ).rejects.toThrow("provider setup challenge upload token has been used");
  });
});
