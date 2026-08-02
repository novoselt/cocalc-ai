/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import type { PoolClient } from "@cocalc/database/pool";
import {
  computeSiteFundedCodexRequestCost,
  type SiteFundedCodexAdmission,
  type SiteFundedCodexAccountStatus,
  type SiteFundedCodexPoolId,
  type SiteFundedCodexPoolStatus,
  type SiteFundedCodexPolicy,
  type SiteFundedCodexReservation,
  type SiteFundedCodexReservationStatus,
  type SiteFundedCodexUsageEvent,
} from "@cocalc/util/ai/site-funded-codex";
import { uuid } from "@cocalc/util/misc";

const logger = getLogger("server:ai:site-funded-codex-ledger");
const HEARTBEAT_INTERVAL_MS = 30_000;

type DbClient = PoolClient;

export type ReserveSiteFundedCodexTurnOptions = {
  fundedTurnId: string;
  idempotencyKey: string;
  poolId: SiteFundedCodexPoolId;
  poolLimitMicrousd: number;
  globalConcurrency: number;
  accountId: string;
  projectId: string;
  hostId: string;
  homeBayId?: string;
  owningBayId?: string;
  membershipTier: string;
  policy: SiteFundedCodexPolicy;
  accountLimit5hMicrousd?: number | null;
  accountLimit7dMicrousd?: number | null;
  surface?: string;
};

export type FinishSiteFundedCodexTurnOptions = {
  reservationId: string;
  status: Extract<
    SiteFundedCodexReservationStatus,
    "committed" | "interrupted" | "failed" | "released"
  >;
  outcome?: string;
};

function int(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`invalid database integer '${value}'`);
  }
  return parsed;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(`${value}`).toISOString();
}

function periodBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - ((day + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

function reservationFromRow(row: any): SiteFundedCodexReservation {
  return {
    reservationId: row.reservation_id,
    fundedTurnId: row.funded_turn_id,
    poolId: row.pool_id,
    policy: row.policy,
    reservedMicrousd: int(row.reserved_microusd),
    committedMicrousd: int(row.committed_microusd),
    expiresAt: iso(row.expires_at),
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    status: row.status,
  };
}

export async function ensureSiteFundedCodexLedgerTables(): Promise<void> {
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS site_ai_funding_periods (
      pool_id TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      limit_microusd BIGINT NOT NULL CHECK (limit_microusd >= 0),
      reserved_microusd BIGINT NOT NULL DEFAULT 0 CHECK (reserved_microusd >= 0),
      committed_microusd BIGINT NOT NULL DEFAULT 0 CHECK (committed_microusd >= 0),
      policy_version INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (pool_id, period_start)
    )`,
    `
    CREATE TABLE IF NOT EXISTS site_ai_turn_reservations (
      reservation_id UUID PRIMARY KEY,
      funded_turn_id UUID NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      account_id UUID NOT NULL,
      project_id UUID NOT NULL,
      host_id UUID NOT NULL,
      home_bay_id TEXT,
      owning_bay_id TEXT,
      membership_tier TEXT NOT NULL,
      policy_version INTEGER NOT NULL,
      model TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      service_tier TEXT NOT NULL,
      policy JSONB NOT NULL,
      surface TEXT,
      reserved_microusd BIGINT NOT NULL CHECK (reserved_microusd >= 0),
      committed_microusd BIGINT NOT NULL DEFAULT 0 CHECK (committed_microusd >= 0),
      status TEXT NOT NULL CHECK (status IN ('active','committed','released','expired','interrupted','failed')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      outcome TEXT,
      FOREIGN KEY (pool_id, period_start)
        REFERENCES site_ai_funding_periods(pool_id, period_start)
    )`,
    `
    CREATE INDEX IF NOT EXISTS site_ai_turn_reservations_account_started_idx
      ON site_ai_turn_reservations(account_id, started_at DESC)`,
    `
    CREATE INDEX IF NOT EXISTS site_ai_turn_reservations_active_idx
      ON site_ai_turn_reservations(status, expires_at)
      WHERE status = 'active'`,
    `
    CREATE TABLE IF NOT EXISTS site_ai_provider_usage_events (
      event_id UUID PRIMARY KEY,
      reservation_id UUID NOT NULL REFERENCES site_ai_turn_reservations(reservation_id),
      provider_request_id TEXT,
      request_sequence INTEGER NOT NULL CHECK (request_sequence > 0),
      price_version TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens BIGINT NOT NULL CHECK (input_tokens >= 0),
      cached_input_tokens BIGINT NOT NULL CHECK (cached_input_tokens >= 0),
      cache_write_input_tokens BIGINT NOT NULL CHECK (cache_write_input_tokens >= 0),
      output_tokens BIGINT NOT NULL CHECK (output_tokens >= 0),
      reasoning_output_tokens BIGINT NOT NULL CHECK (reasoning_output_tokens >= 0),
      long_context BOOLEAN NOT NULL,
      provider_tool_fees_microusd BIGINT NOT NULL DEFAULT 0,
      cost_microusd BIGINT NOT NULL CHECK (cost_microusd >= 0),
      duration_ms INTEGER,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (reservation_id, request_sequence)
    )`,
    `
    CREATE UNIQUE INDEX IF NOT EXISTS site_ai_provider_request_id_idx
      ON site_ai_provider_usage_events(provider_request_id)
      WHERE provider_request_id IS NOT NULL`,
    `
    CREATE TABLE IF NOT EXISTS site_ai_account_holds (
      account_id UUID PRIMARY KEY,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by UUID,
      expires_at TIMESTAMPTZ
    )`,
  ];
  for (const statement of statements) {
    await getPool().query(statement);
  }
}

async function expireCurrentPeriodReservations({
  client,
  poolId,
  periodStart,
}: {
  client: DbClient;
  poolId: SiteFundedCodexPoolId;
  periodStart: Date;
}): Promise<void> {
  const { rows } = await client.query(
    `
      SELECT reservation_id, reserved_microusd
      FROM site_ai_turn_reservations
      WHERE pool_id = $1 AND period_start = $2 AND status = 'active'
        AND expires_at <= NOW()
      FOR UPDATE
    `,
    [poolId, periodStart],
  );
  let released = 0;
  let committed = 0;
  for (const row of rows) {
    const usage = await client.query(
      `SELECT COALESCE(SUM(cost_microusd), 0) AS cost
       FROM site_ai_provider_usage_events WHERE reservation_id = $1`,
      [row.reservation_id],
    );
    const reservationCommitted = int(usage.rows[0]?.cost);
    released += int(row.reserved_microusd);
    committed += reservationCommitted;
    await client.query(
      `UPDATE site_ai_turn_reservations
       SET status = 'expired', committed_microusd = $2,
           completed_at = NOW(), outcome = 'turn reservation expired'
       WHERE reservation_id = $1`,
      [row.reservation_id, reservationCommitted],
    );
  }
  if (rows.length > 0) {
    await client.query(
      `
        UPDATE site_ai_funding_periods
        SET reserved_microusd = GREATEST(0, reserved_microusd - $3),
            committed_microusd = committed_microusd + $4,
            updated_at = NOW()
        WHERE pool_id = $1 AND period_start = $2
      `,
      [poolId, periodStart, released, committed],
    );
  }
}

async function committedInWindow({
  client,
  accountId,
  interval,
}: {
  client: DbClient;
  accountId: string;
  interval: "5 hours" | "7 days";
}): Promise<number> {
  const { rows } = await client.query(
    `
      SELECT COALESCE(SUM(committed_microusd), 0) AS committed
      FROM site_ai_turn_reservations
      WHERE account_id = $1 AND completed_at >= NOW() - $2::interval
        AND status IN ('committed', 'interrupted', 'failed')
    `,
    [accountId, interval],
  );
  return int(rows[0]?.committed);
}

function denied(
  code: Exclude<SiteFundedCodexAdmission, { allowed: true }>["code"],
  reason: string,
): SiteFundedCodexAdmission {
  return { allowed: false, code, reason };
}

export async function reserveSiteFundedCodexTurn(
  opts: ReserveSiteFundedCodexTurnOptions,
): Promise<SiteFundedCodexAdmission> {
  await ensureSiteFundedCodexLedgerTables();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM site_ai_turn_reservations WHERE idempotency_key = $1`,
      [opts.idempotencyKey],
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return {
        allowed: true,
        reservation: reservationFromRow(existing.rows[0]),
      };
    }

    const hold = await client.query(
      `
        SELECT reason FROM site_ai_account_holds
        WHERE account_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
      `,
      [opts.accountId],
    );
    if (hold.rows[0]) {
      await client.query("ROLLBACK");
      return denied(
        "account_hold",
        `Site-funded Codex is unavailable for this account: ${hold.rows[0].reason}`,
      );
    }

    const { start, end } = periodBounds();
    await client.query(
      `
        INSERT INTO site_ai_funding_periods
          (pool_id, period_start, period_end, limit_microusd, policy_version)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (pool_id, period_start) DO UPDATE SET
          limit_microusd = EXCLUDED.limit_microusd,
          policy_version = EXCLUDED.policy_version,
          updated_at = NOW()
      `,
      [opts.poolId, start, end, opts.poolLimitMicrousd, opts.policy.version],
    );
    await client.query(
      `
        SELECT pool_id FROM site_ai_funding_periods
        WHERE pool_id = $1 AND period_start = $2
        FOR UPDATE
      `,
      [opts.poolId, start],
    );
    await expireCurrentPeriodReservations({
      client,
      poolId: opts.poolId,
      periodStart: start,
    });

    const period = await client.query(
      `
        SELECT * FROM site_ai_funding_periods
        WHERE pool_id = $1 AND period_start = $2
      `,
      [opts.poolId, start],
    );
    const periodRow = period.rows[0];
    const active = await client.query(
      `
        SELECT
          COUNT(*)::int AS global_active,
          COUNT(*) FILTER (WHERE account_id = $1)::int AS account_active
        FROM site_ai_turn_reservations
        WHERE status = 'active'
      `,
      [opts.accountId],
    );
    if (
      int(active.rows[0]?.account_active) >=
      opts.policy.maxConcurrentTurnsPerAccount
    ) {
      await client.query("ROLLBACK");
      return denied(
        "account_concurrency",
        "Another site-funded Codex turn is already active for this account.",
      );
    }
    if (int(active.rows[0]?.global_active) >= opts.globalConcurrency) {
      await client.query("ROLLBACK");
      return denied(
        "global_concurrency",
        "Site-funded Codex is temporarily at its global concurrency limit.",
      );
    }
    const requested = opts.policy.maxTurnCostMicrousd;
    if (
      int(periodRow.committed_microusd) +
        int(periodRow.reserved_microusd) +
        requested >
      int(periodRow.limit_microusd)
    ) {
      await client.query("ROLLBACK");
      return denied(
        "global_pool",
        "The site-funded Codex weekly pool is temporarily exhausted.",
      );
    }

    const [used5h, used7d] = await Promise.all([
      committedInWindow({
        client,
        accountId: opts.accountId,
        interval: "5 hours",
      }),
      committedInWindow({
        client,
        accountId: opts.accountId,
        interval: "7 days",
      }),
    ]);
    if (
      opts.accountLimit5hMicrousd != null &&
      used5h + requested > opts.accountLimit5hMicrousd
    ) {
      await client.query("ROLLBACK");
      return denied(
        "account_limit_5h",
        "This account has reached its 5-hour included Codex allowance.",
      );
    }
    if (
      opts.accountLimit7dMicrousd != null &&
      used7d + requested > opts.accountLimit7dMicrousd
    ) {
      await client.query("ROLLBACK");
      return denied(
        "account_limit_7d",
        "This account has reached its 7-day included Codex allowance.",
      );
    }

    const reservationId = uuid();
    const expiresAt = new Date(Date.now() + opts.policy.maxTurnDurationMs);
    const inserted = await client.query(
      `
        INSERT INTO site_ai_turn_reservations (
          reservation_id, funded_turn_id, idempotency_key, pool_id,
          period_start, account_id, project_id, host_id, home_bay_id,
          owning_bay_id, membership_tier, policy_version, model, reasoning,
          service_tier, policy, surface, reserved_microusd, status, expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16::jsonb, $17, $18, 'active', $19
        )
        RETURNING *
      `,
      [
        reservationId,
        opts.fundedTurnId,
        opts.idempotencyKey,
        opts.poolId,
        start,
        opts.accountId,
        opts.projectId,
        opts.hostId,
        opts.homeBayId ?? null,
        opts.owningBayId ?? null,
        opts.membershipTier,
        opts.policy.version,
        opts.policy.model,
        opts.policy.reasoning,
        opts.policy.serviceTier,
        JSON.stringify(opts.policy),
        opts.surface ?? null,
        requested,
        expiresAt,
      ],
    );
    await client.query(
      `
        UPDATE site_ai_funding_periods
        SET reserved_microusd = reserved_microusd + $3, updated_at = NOW()
        WHERE pool_id = $1 AND period_start = $2
      `,
      [opts.poolId, start, requested],
    );
    await client.query("COMMIT");
    return {
      allowed: true,
      reservation: reservationFromRow(inserted.rows[0]),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function heartbeatSiteFundedCodexTurn({
  reservationId,
}: {
  reservationId: string;
}): Promise<boolean> {
  await ensureSiteFundedCodexLedgerTables();
  const { rowCount } = await getPool().query(
    `
      UPDATE site_ai_turn_reservations
      SET heartbeat_at = NOW()
      WHERE reservation_id = $1 AND status = 'active' AND expires_at > NOW()
    `,
    [reservationId],
  );
  return (rowCount ?? 0) > 0;
}

export async function assertSiteFundedCodexReservationHost({
  reservationId,
  hostId,
}: {
  reservationId: string;
  hostId: string;
}): Promise<void> {
  await ensureSiteFundedCodexLedgerTables();
  const { rows } = await getPool().query(
    `SELECT host_id FROM site_ai_turn_reservations WHERE reservation_id = $1`,
    [reservationId],
  );
  if (`${rows[0]?.host_id ?? ""}` !== hostId) {
    throw new Error("site-funded Codex reservation does not belong to host");
  }
}

export async function recordSiteFundedCodexUsageEvent(
  event: SiteFundedCodexUsageEvent,
): Promise<{ costMicrousd: number; inserted: boolean }> {
  await ensureSiteFundedCodexLedgerTables();
  const cost = computeSiteFundedCodexRequestCost({
    model: event.model,
    usage: event,
  });
  const { rowCount, rows } = await getPool().query(
    `
      INSERT INTO site_ai_provider_usage_events (
        event_id, reservation_id, provider_request_id, request_sequence,
        price_version, model, input_tokens, cached_input_tokens,
        cache_write_input_tokens, output_tokens, reasoning_output_tokens,
        long_context, provider_tool_fees_microusd, cost_microusd, duration_ms
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (reservation_id, request_sequence) DO NOTHING
      RETURNING cost_microusd
    `,
    [
      event.eventId,
      event.reservationId,
      event.providerRequestId ?? null,
      event.requestSequence,
      cost.priceVersion,
      cost.model,
      event.inputTokens,
      event.cachedInputTokens ?? 0,
      event.cacheWriteInputTokens ?? 0,
      event.outputTokens,
      event.reasoningOutputTokens ?? 0,
      cost.longContext,
      event.providerToolFeesMicrousd ?? 0,
      cost.costMicrousd,
      event.durationMs ?? null,
    ],
  );
  return {
    costMicrousd: rowCount ? int(rows[0]?.cost_microusd) : cost.costMicrousd,
    inserted: (rowCount ?? 0) > 0,
  };
}

export async function finishSiteFundedCodexTurn(
  opts: FinishSiteFundedCodexTurnOptions,
): Promise<SiteFundedCodexReservation> {
  await ensureSiteFundedCodexLedgerTables();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT * FROM site_ai_turn_reservations WHERE reservation_id = $1 FOR UPDATE`,
      [opts.reservationId],
    );
    const row = found.rows[0];
    if (!row) throw new Error("site-funded Codex reservation not found");
    if (row.status !== "active") {
      await client.query("COMMIT");
      return reservationFromRow(row);
    }
    const usage = await client.query(
      `
        SELECT COALESCE(SUM(cost_microusd), 0) AS cost
        FROM site_ai_provider_usage_events WHERE reservation_id = $1
      `,
      [opts.reservationId],
    );
    const committed = int(usage.rows[0]?.cost);
    const updated = await client.query(
      `
        UPDATE site_ai_turn_reservations
        SET status = $2, committed_microusd = $3, completed_at = NOW(),
            outcome = $4, heartbeat_at = NOW()
        WHERE reservation_id = $1
        RETURNING *
      `,
      [opts.reservationId, opts.status, committed, opts.outcome ?? null],
    );
    await client.query(
      `
        UPDATE site_ai_funding_periods
        SET reserved_microusd = GREATEST(0, reserved_microusd - $3),
            committed_microusd = committed_microusd + $4,
            updated_at = NOW()
        WHERE pool_id = $1 AND period_start = $2
      `,
      [row.pool_id, row.period_start, row.reserved_microusd, committed],
    );
    await client.query("COMMIT");
    if (committed > int(row.reserved_microusd)) {
      logger.error("site-funded Codex reservation exceeded its hard bound", {
        reservationId: opts.reservationId,
        reservedMicrousd: int(row.reserved_microusd),
        committedMicrousd: committed,
      });
    }
    return reservationFromRow(updated.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getSiteFundedCodexPoolStatus(): Promise<
  SiteFundedCodexPoolStatus[]
> {
  await ensureSiteFundedCodexLedgerTables();
  const { start } = periodBounds();
  const { rows } = await getPool().query(
    `
      SELECT p.*,
        COUNT(r.reservation_id) FILTER (WHERE r.status = 'active')::int
          AS active_reservations
      FROM site_ai_funding_periods p
      LEFT JOIN site_ai_turn_reservations r
        ON r.pool_id = p.pool_id AND r.period_start = p.period_start
      WHERE p.period_start = $1
      GROUP BY p.pool_id, p.period_start
      ORDER BY p.pool_id
    `,
    [start],
  );
  return rows.map((row) => {
    const limit = int(row.limit_microusd);
    const reserved = int(row.reserved_microusd);
    const committed = int(row.committed_microusd);
    return {
      poolId: row.pool_id,
      periodStart: iso(row.period_start),
      periodEnd: iso(row.period_end),
      limitMicrousd: limit,
      reservedMicrousd: reserved,
      committedMicrousd: committed,
      activeReservations: int(row.active_reservations),
      utilization: limit > 0 ? (reserved + committed) / limit : 1,
    };
  });
}

export async function getSiteFundedCodexAccountStatus({
  accountId,
  limit5hMicrousd,
  limit7dMicrousd,
}: {
  accountId: string;
  limit5hMicrousd?: number | null;
  limit7dMicrousd?: number | null;
}): Promise<SiteFundedCodexAccountStatus> {
  await ensureSiteFundedCodexLedgerTables();
  const { rows } = await getPool().query(
    `SELECT
       COALESCE(SUM(committed_microusd) FILTER (
         WHERE completed_at >= NOW() - INTERVAL '5 hours'
       ), 0) AS committed_5h,
       COALESCE(SUM(committed_microusd) FILTER (
         WHERE completed_at >= NOW() - INTERVAL '7 days'
       ), 0) AS committed_7d,
       COALESCE(SUM(reserved_microusd) FILTER (
         WHERE status = 'active'
       ), 0) AS active_reserved
     FROM site_ai_turn_reservations
     WHERE account_id = $1`,
    [accountId],
  );
  const committed5hMicrousd = int(rows[0]?.committed_5h);
  const committed7dMicrousd = int(rows[0]?.committed_7d);
  const activeReservedMicrousd = int(rows[0]?.active_reserved);
  const normalized5h =
    limit5hMicrousd == null ? undefined : Math.max(0, limit5hMicrousd);
  const normalized7d =
    limit7dMicrousd == null ? undefined : Math.max(0, limit7dMicrousd);
  return {
    accountId,
    committed5hMicrousd,
    committed7dMicrousd,
    activeReservedMicrousd,
    limit5hMicrousd: normalized5h,
    limit7dMicrousd: normalized7d,
    remaining5hMicrousd:
      normalized5h == null
        ? undefined
        : Math.max(0, normalized5h - committed5hMicrousd),
    remaining7dMicrousd:
      normalized7d == null
        ? undefined
        : Math.max(0, normalized7d - committed7dMicrousd),
  };
}

export async function expireAbandonedSiteFundedCodexReservations(): Promise<number> {
  await ensureSiteFundedCodexLedgerTables();
  const { rows } = await getPool().query(
    `SELECT DISTINCT pool_id, period_start FROM site_ai_turn_reservations
     WHERE status = 'active' AND expires_at <= NOW()`,
  );
  let expired = 0;
  for (const row of rows) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT pool_id FROM site_ai_funding_periods
         WHERE pool_id = $1 AND period_start = $2 FOR UPDATE`,
        [row.pool_id, row.period_start],
      );
      const before = await client.query(
        `SELECT COUNT(*)::int AS count FROM site_ai_turn_reservations
         WHERE pool_id = $1 AND period_start = $2 AND status = 'active'
           AND expires_at <= NOW()`,
        [row.pool_id, row.period_start],
      );
      await expireCurrentPeriodReservations({
        client,
        poolId: row.pool_id,
        periodStart: row.period_start,
      });
      expired += int(before.rows[0]?.count);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return expired;
}
