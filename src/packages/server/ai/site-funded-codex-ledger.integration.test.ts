/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import getPool from "@cocalc/database/pool";
import { after, before } from "@cocalc/server/test";
import {
  DEFAULT_SITE_FUNDED_CODEX_POLICY,
  type SiteFundedCodexPolicy,
} from "@cocalc/util/ai/site-funded-codex";
import { uuid } from "@cocalc/util/misc";
import {
  ensureSiteFundedCodexLedgerTables,
  expireAbandonedSiteFundedCodexReservations,
  finishSiteFundedCodexTurn,
  getSiteFundedCodexAccountStatus,
  getSiteFundedCodexPoolStatus,
  recordSiteFundedCodexUsageEvent,
  reserveSiteFundedCodexTurn,
} from "./site-funded-codex-ledger";

beforeAll(async () => {
  await before({ noConat: true });
  await ensureSiteFundedCodexLedgerTables();
}, 15_000);

afterAll(after);

function options({
  accountId = uuid(),
  poolLimitMicrousd = 100_000,
  maxTurnCostMicrousd = 60_000,
}: {
  accountId?: string;
  poolLimitMicrousd?: number;
  maxTurnCostMicrousd?: number;
} = {}) {
  const fundedTurnId = uuid();
  const policy: SiteFundedCodexPolicy = {
    ...DEFAULT_SITE_FUNDED_CODEX_POLICY,
    maxTurnCostMicrousd,
  };
  return {
    fundedTurnId,
    idempotencyKey: fundedTurnId,
    poolId: "site-funded-codex-free" as const,
    poolLimitMicrousd,
    globalConcurrency: 100,
    accountId,
    projectId: uuid(),
    hostId: uuid(),
    membershipTier: "free",
    policy,
  };
}

describe("site-funded Codex seed ledger", () => {
  beforeEach(async () => {
    await getPool().query("DELETE FROM site_ai_provider_usage_events");
    await getPool().query("DELETE FROM site_ai_turn_reservations");
    await getPool().query("DELETE FROM site_ai_funding_periods");
    await getPool().query("DELETE FROM site_ai_account_holds");
  });

  it("atomically refuses reservations beyond the global pool", async () => {
    const attempts = await Promise.all(
      [uuid(), uuid(), uuid()].map((accountId) =>
        reserveSiteFundedCodexTurn(options({ accountId })),
      ),
    );
    expect(attempts.filter(({ allowed }) => allowed)).toHaveLength(1);
    expect(
      attempts
        .filter(({ allowed }) => !allowed)
        .map((entry: any) => entry.code),
    ).toEqual(["global_pool", "global_pool"]);
    const status = await getSiteFundedCodexPoolStatus();
    expect(status[0]).toMatchObject({
      limitMicrousd: 100_000,
      reservedMicrousd: 60_000,
      committedMicrousd: 0,
      activeReservations: 1,
    });
  });

  it("makes reservation and usage retries idempotent", async () => {
    const opts = options({ maxTurnCostMicrousd: 50_000 });
    const first = await reserveSiteFundedCodexTurn(opts);
    const second = await reserveSiteFundedCodexTurn(opts);
    expect(first.allowed).toBe(true);
    expect(second).toEqual(first);
    if (!first.allowed) throw new Error("expected reservation");

    const event = {
      eventId: uuid(),
      reservationId: first.reservation.reservationId,
      requestSequence: 1,
      model: "gpt-5.6-luna",
      inputTokens: 10_000,
      cachedInputTokens: 6_000,
      outputTokens: 500,
    };
    await expect(recordSiteFundedCodexUsageEvent(event)).resolves.toEqual({
      costMicrousd: 1_520,
      inserted: true,
    });
    await expect(
      recordSiteFundedCodexUsageEvent({ ...event, eventId: uuid() }),
    ).resolves.toEqual({ costMicrousd: 1_520, inserted: false });

    const finished = await finishSiteFundedCodexTurn({
      reservationId: first.reservation.reservationId,
      status: "committed",
      outcome: "completed",
    });
    expect(finished).toMatchObject({
      status: "committed",
      reservedMicrousd: 50_000,
      committedMicrousd: 1_520,
    });
    await expect(
      finishSiteFundedCodexTurn({
        reservationId: first.reservation.reservationId,
        status: "committed",
      }),
    ).resolves.toEqual(finished);
    expect((await getSiteFundedCodexPoolStatus())[0]).toMatchObject({
      reservedMicrousd: 0,
      committedMicrousd: 1_520,
      activeReservations: 0,
    });
    await expect(
      getSiteFundedCodexAccountStatus({
        accountId: opts.accountId,
        limit5hMicrousd: 10_000,
        limit7dMicrousd: 20_000,
      }),
    ).resolves.toMatchObject({
      committed5hMicrousd: 1_520,
      committed7dMicrousd: 1_520,
      activeReservedMicrousd: 0,
      remaining5hMicrousd: 8_480,
      remaining7dMicrousd: 18_480,
    });
  });

  it("enforces account concurrency and rolling cost limits", async () => {
    const accountId = uuid();
    const first = await reserveSiteFundedCodexTurn(
      options({ accountId, maxTurnCostMicrousd: 10_000 }),
    );
    expect(first.allowed).toBe(true);
    const concurrent = await reserveSiteFundedCodexTurn(
      options({ accountId, maxTurnCostMicrousd: 10_000 }),
    );
    expect(concurrent).toMatchObject({
      allowed: false,
      code: "account_concurrency",
    });
    if (!first.allowed) throw new Error("expected reservation");
    await recordSiteFundedCodexUsageEvent({
      eventId: uuid(),
      reservationId: first.reservation.reservationId,
      requestSequence: 1,
      model: "gpt-5.6-luna",
      inputTokens: 10_000,
      outputTokens: 0,
    });
    await finishSiteFundedCodexTurn({
      reservationId: first.reservation.reservationId,
      status: "committed",
    });
    const limited = await reserveSiteFundedCodexTurn({
      ...options({ accountId, maxTurnCostMicrousd: 10_000 }),
      accountLimit5hMicrousd: 5_000,
    });
    expect(limited).toMatchObject({
      allowed: false,
      code: "account_limit_5h",
    });
  });

  it("commits recorded usage when an active reservation expires", async () => {
    const admission = await reserveSiteFundedCodexTurn(
      options({ maxTurnCostMicrousd: 50_000 }),
    );
    if (!admission.allowed) throw new Error("expected reservation");
    await recordSiteFundedCodexUsageEvent({
      eventId: uuid(),
      reservationId: admission.reservation.reservationId,
      requestSequence: 1,
      model: "gpt-5.6-luna",
      inputTokens: 10_000,
      cachedInputTokens: 6_000,
      outputTokens: 500,
    });
    await getPool().query(
      `UPDATE site_ai_turn_reservations SET expires_at = NOW() - INTERVAL '1 second'
       WHERE reservation_id = $1`,
      [admission.reservation.reservationId],
    );

    await expect(expireAbandonedSiteFundedCodexReservations()).resolves.toBe(1);
    expect((await getSiteFundedCodexPoolStatus())[0]).toMatchObject({
      reservedMicrousd: 0,
      committedMicrousd: 1_520,
      activeReservations: 0,
    });
    const { rows } = await getPool().query(
      `SELECT status, committed_microusd FROM site_ai_turn_reservations
       WHERE reservation_id = $1`,
      [admission.reservation.reservationId],
    );
    expect(rows[0]?.status).toBe("expired");
    expect(Number(rows[0]?.committed_microusd)).toBe(1_520);
  });
});
