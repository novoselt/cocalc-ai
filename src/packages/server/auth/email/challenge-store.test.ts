/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { initEphemeralDatabase } from "@cocalc/database/pool";

const sendEmailAuthChallengeMessageMock = jest.fn(async () => undefined);
const getClusterAccountByEmailDirectMock = jest.fn(async () => null);

jest.mock("./delivery", () => ({
  sendEmailAuthChallengeMessage: (...args: any[]) =>
    sendEmailAuthChallengeMessageMock(...args),
}));

jest.mock("@cocalc/server/accounts/cluster-directory", () => ({
  getClusterAccountByEmailDirect: (...args: any[]) =>
    getClusterAccountByEmailDirectMock(...args),
}));

jest.mock("@cocalc/database/settings/secret-settings", () => ({
  getSecretSettingsKey: async () => Buffer.alloc(32, 7),
}));

describe("seed-global email authentication challenges", () => {
  beforeAll(async () => {
    await initEphemeralDatabase();
    const { ensureEmailAuthChallengeSchema } =
      await import("./challenge-store");
    await ensureEmailAuthChallengeSchema();
  }, 20_000);

  beforeEach(async () => {
    sendEmailAuthChallengeMessageMock.mockClear();
    getClusterAccountByEmailDirectMock.mockClear();
    getClusterAccountByEmailDirectMock.mockResolvedValue(null);
    await getPool().query("TRUNCATE email_auth_challenges");
  });

  afterAll(async () => {
    await getPool().end();
  });

  it("stores only digests and proves an email with a six-digit code", async () => {
    const {
      getEmailAuthChallengeStatusDirect,
      redeemEmailAuthCodeDirect,
      startEmailAuthChallengeDirect,
    } = await import("./challenge-store");
    const started = await startEmailAuthChallengeDirect({
      email_address: "Person@Example.EDU",
      browser_binding: "browser-one",
      request_ip: "192.0.2.10",
    });
    expect(started).toMatchObject({
      state: "pending",
      masked_email: "pe…@example.edu",
      send_count: 1,
      message_sent: true,
    });
    expect(sendEmailAuthChallengeMessageMock).toHaveBeenCalledTimes(1);
    const sent = sendEmailAuthChallengeMessageMock.mock.calls[0][0];
    expect(sent.code).toMatch(/^\d{6}$/);
    expect(sent.link_token.length).toBeGreaterThanOrEqual(32);

    const { rows } = await getPool().query(
      `SELECT normalized_email, code_digest, link_token_digest,
              browser_binding_digest, request_ip_hash
         FROM email_auth_challenges
        WHERE challenge_id=$1`,
      [started.challenge_id],
    );
    expect(rows[0].normalized_email).toBe("person@example.edu");
    expect(rows[0].code_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].link_token_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].browser_binding_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].request_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain(sent.code);
    expect(JSON.stringify(rows[0])).not.toContain(sent.link_token);
    const { emailAuthSecretMatches } = await import("./secrets");
    await expect(
      emailAuthSecretMatches({
        challenge_id: started.challenge_id,
        digest: rows[0].code_digest,
        kind: "code",
        value: sent.code,
      }),
    ).resolves.toBe(true);

    await expect(
      getEmailAuthChallengeStatusDirect({
        challenge_id: started.challenge_id,
        browser_binding: "wrong-browser",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      redeemEmailAuthCodeDirect({
        challenge_id: started.challenge_id,
        code: sent.code,
      }),
    ).resolves.toMatchObject({ state: "email_proved" });
    await expect(
      redeemEmailAuthCodeDirect({
        challenge_id: started.challenge_id,
        code: sent.code,
      }),
    ).resolves.toMatchObject({ state: "email_proved" });
  });

  it("reuses a same-browser active challenge without sending again", async () => {
    const { startEmailAuthChallengeDirect } = await import("./challenge-store");
    const first = await startEmailAuthChallengeDirect({
      email_address: "person@example.edu",
      browser_binding: "browser-one",
    });
    const second = await startEmailAuthChallengeDirect({
      email_address: "person@example.edu",
      browser_binding: "browser-one",
    });
    expect(second.challenge_id).toBe(first.challenge_id);
    expect(sendEmailAuthChallengeMessageMock).toHaveBeenCalledTimes(1);
  });

  it("supersedes an active challenge started from another browser", async () => {
    const { startEmailAuthChallengeDirect } = await import("./challenge-store");
    const first = await startEmailAuthChallengeDirect({
      email_address: "person@example.edu",
      browser_binding: "browser-one",
    });
    const second = await startEmailAuthChallengeDirect({
      email_address: "person@example.edu",
      browser_binding: "browser-two",
    });
    expect(second.challenge_id).not.toBe(first.challenge_id);
    const { rows } = await getPool().query(
      `SELECT state FROM email_auth_challenges WHERE challenge_id=$1`,
      [first.challenge_id],
    );
    expect(rows[0].state).toBe("superseded");
  });

  it("records failed attempts and blocks the eighth invalid code", async () => {
    const { redeemEmailAuthCodeDirect, startEmailAuthChallengeDirect } =
      await import("./challenge-store");
    const started = await startEmailAuthChallengeDirect({
      email_address: "person@example.edu",
      browser_binding: "browser-one",
    });
    for (let i = 0; i < 7; i += 1) {
      await expect(
        redeemEmailAuthCodeDirect({
          challenge_id: started.challenge_id,
          code: `${100000 + i}`,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(
      redeemEmailAuthCodeDirect({
        challenge_id: started.challenge_id,
        code: "100007",
      }),
    ).rejects.toMatchObject({ code: "blocked" });
    const { rows } = await getPool().query(
      `SELECT state, attempt_count FROM email_auth_challenges WHERE challenge_id=$1`,
      [started.challenge_id],
    );
    expect(rows[0]).toMatchObject({ state: "blocked", attempt_count: 8 });
  });

  it("does not allow an immediate resend", async () => {
    const { resendEmailAuthChallengeDirect, startEmailAuthChallengeDirect } =
      await import("./challenge-store");
    const started = await startEmailAuthChallengeDirect({
      email_address: "person@example.edu",
      browser_binding: "browser-one",
    });
    await expect(
      resendEmailAuthChallengeDirect({
        challenge_id: started.challenge_id,
        browser_binding: "browser-one",
      }),
    ).rejects.toMatchObject({ code: "resend_too_soon" });
  });
});
