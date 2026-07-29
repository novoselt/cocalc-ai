/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";

import getPool from "@cocalc/database/pool";
import { getClusterAccountByEmailDirect } from "@cocalc/server/accounts/cluster-directory";
import { getLogger } from "@cocalc/backend/logger";
import { is_valid_email_address as isValidEmailAddress } from "@cocalc/util/misc";

import { sendEmailAuthChallengeMessage } from "./delivery";
import {
  createEmailAuthCode,
  createEmailAuthLinkToken,
  emailAuthDigest,
  emailAuthSecretMatches,
  maskEmailAddress,
} from "./secrets";
import type {
  EmailAuthChallengePublicStatus,
  EmailAuthChallengeState,
  GetEmailAuthChallengeStatusOptions,
  RedeemEmailAuthCodeOptions,
  RedeemEmailAuthLinkOptions,
  ResendEmailAuthChallengeOptions,
  StartEmailAuthChallengeOptions,
} from "./types";

const logger = getLogger("server:auth:email");
const TABLE = "email_auth_challenges";
const CHALLENGE_TTL_MS = 15 * 60_000;
const RESEND_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 8;
const MAX_SENDS = 5;
const STARTS_PER_EMAIL_PER_HOUR = 10;
const STARTS_PER_IP_PER_HOUR = 30;
let schemaReady: Promise<void> | undefined;

type Queryable = {
  query: <T = any>(
    sql: string,
    params?: any[],
  ) => Promise<{ rows: T[]; rowCount?: number | null }>;
};

type ChallengeRow = {
  challenge_id: string;
  normalized_email: string;
  email_lookup_hash: string;
  account_id?: string | null;
  selected_home_bay_id?: string | null;
  purpose: string;
  state: EmailAuthChallengeState;
  code_digest: string;
  link_token_digest: string;
  browser_binding_digest: string;
  attempt_count: number;
  max_attempts: number;
  send_count: number;
  resend_available_at: Date;
  message_sent_at?: Date | null;
  message_failed_at?: Date | null;
  expires_at: Date;
};

export class EmailAuthChallengeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "blocked"
      | "expired"
      | "invalid"
      | "not_found"
      | "rate_limited"
      | "resend_too_soon",
  ) {
    super(message);
    this.name = "EmailAuthChallengeError";
  }
}

export async function ensureEmailAuthChallengeSchema(): Promise<void> {
  if (schemaReady) {
    return await schemaReady;
  }
  schemaReady = ensureEmailAuthChallengeSchemaInner().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  return await schemaReady;
}

async function ensureEmailAuthChallengeSchemaInner(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      challenge_id UUID PRIMARY KEY,
      normalized_email VARCHAR(254) NOT NULL,
      email_lookup_hash CHAR(64) NOT NULL,
      account_id UUID,
      selected_home_bay_id VARCHAR(64),
      exchange_id UUID,
      auth_method VARCHAR(32),
      purpose VARCHAR(32) NOT NULL,
      state VARCHAR(32) NOT NULL,
      code_digest CHAR(64) NOT NULL,
      link_token_digest CHAR(64) NOT NULL,
      browser_binding_digest CHAR(64) NOT NULL,
      analytics_token UUID,
      terms_accepted_at TIMESTAMPTZ,
      terms_version TEXT,
      registration_token_reservation_id UUID,
      continuation JSONB,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT ${MAX_ATTEMPTS},
      send_count INTEGER NOT NULL DEFAULT 0,
      resend_available_at TIMESTAMPTZ NOT NULL,
      message_queued_at TIMESTAMPTZ,
      message_sent_at TIMESTAMPTZ,
      message_failed_at TIMESTAMPTZ,
      message_error_code VARCHAR(64),
      first_viewed_at TIMESTAMPTZ,
      email_proved_at TIMESTAMPTZ,
      account_created_at TIMESTAMPTZ,
      session_completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      superseded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      request_ip_hash CHAR(64),
      metadata JSONB NOT NULL DEFAULT '{}'::JSONB
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_email_lookup_hash_idx ON ${TABLE} (email_lookup_hash, created_at DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_account_id_idx ON ${TABLE} (account_id, created_at DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_state_idx ON ${TABLE} (state, updated_at DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_expires_at_idx ON ${TABLE} (expires_at)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_request_ip_hash_idx ON ${TABLE} (request_ip_hash, created_at DESC)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${TABLE}_analytics_token_idx ON ${TABLE} (analytics_token)`,
  );
  await pool.query(
    `UPDATE ${TABLE} SET state='expired', updated_at=NOW() WHERE state='pending' AND expires_at <= NOW()`,
  );
  await pool.query(
    `DELETE FROM ${TABLE} WHERE created_at < NOW() - INTERVAL '30 days'`,
  );
}

function normalizeEmail(email_address: string): string {
  const email = `${email_address ?? ""}`.trim().toLowerCase();
  if (!email || !isValidEmailAddress(email) || email.length > 254) {
    throw new EmailAuthChallengeError(
      "Enter a valid email address.",
      "invalid",
    );
  }
  return email;
}

function publicStatus(row: ChallengeRow): EmailAuthChallengePublicStatus {
  const now = Date.now();
  const state =
    row.state === "pending" && new Date(row.expires_at).valueOf() <= now
      ? "expired"
      : row.state;
  return {
    challenge_id: row.challenge_id,
    state,
    masked_email: maskEmailAddress(row.normalized_email),
    expires_at: new Date(row.expires_at).toISOString(),
    resend_available_at: new Date(row.resend_available_at).toISOString(),
    send_count: Number(row.send_count ?? 0),
    message_sent: row.message_sent_at != null,
    message_failed: row.message_failed_at != null,
  };
}

async function assertStartRateLimit({
  db,
  email_lookup_hash,
  request_ip_hash,
}: {
  db: Queryable;
  email_lookup_hash: string;
  request_ip_hash?: string;
}): Promise<void> {
  const { rows } = await db.query<{
    email_count: number;
    ip_count: number;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE email_lookup_hash=$1)::INTEGER AS email_count,
        COUNT(*) FILTER (
          WHERE $2::CHAR(64) IS NOT NULL AND request_ip_hash=$2
        )::INTEGER AS ip_count
      FROM ${TABLE}
      WHERE created_at > NOW() - INTERVAL '1 hour'
        AND (
          email_lookup_hash=$1 OR
          ($2::CHAR(64) IS NOT NULL AND request_ip_hash=$2)
        )
    `,
    [email_lookup_hash, request_ip_hash ?? null],
  );
  if (
    Number(rows[0]?.email_count ?? 0) >= STARTS_PER_EMAIL_PER_HOUR ||
    Number(rows[0]?.ip_count ?? 0) >= STARTS_PER_IP_PER_HOUR
  ) {
    throw new EmailAuthChallengeError(
      "Too many email sign-in requests. Wait before trying again.",
      "rate_limited",
    );
  }
}

async function deliverChallenge({
  challenge_id,
  code,
  email_address,
  link_token,
}: {
  challenge_id: string;
  code: string;
  email_address: string;
  link_token: string;
}): Promise<void> {
  const pool = getPool();
  try {
    await sendEmailAuthChallengeMessage({
      challenge_id,
      code,
      email_address,
      link_token,
    });
    await pool.query(
      `
        UPDATE ${TABLE}
           SET message_sent_at=NOW(),
               message_failed_at=NULL,
               message_error_code=NULL,
               updated_at=NOW()
         WHERE challenge_id=$1
      `,
      [challenge_id],
    );
  } catch (err) {
    const errorCode =
      err instanceof Error && err.name
        ? err.name.toLowerCase().slice(0, 64)
        : "delivery_error";
    await pool.query(
      `
        UPDATE ${TABLE}
           SET message_failed_at=NOW(),
               message_error_code=$2,
               updated_at=NOW()
         WHERE challenge_id=$1
      `,
      [challenge_id, errorCode],
    );
    logger.warn("email auth delivery failed", {
      challenge_id,
      error_code: errorCode,
    });
    throw new Error("Unable to send the sign-in email. Please try again.");
  }
}

export async function startEmailAuthChallengeDirect(
  opts: StartEmailAuthChallengeOptions,
): Promise<EmailAuthChallengePublicStatus> {
  await ensureEmailAuthChallengeSchema();
  const email = normalizeEmail(opts.email_address);
  const purpose = opts.purpose ?? "sign_in_or_sign_up";
  const challenge_id = randomUUID();
  const code = createEmailAuthCode();
  const linkToken = createEmailAuthLinkToken();
  const [
    emailLookupHash,
    requestIpHash,
    codeDigest,
    linkTokenDigest,
    browserBindingDigest,
    account,
  ] = await Promise.all([
    emailAuthDigest({ kind: "email", value: email }),
    opts.request_ip
      ? emailAuthDigest({ kind: "ip", value: opts.request_ip })
      : undefined,
    emailAuthDigest({ challenge_id, kind: "code", value: code }),
    emailAuthDigest({ challenge_id, kind: "link", value: linkToken }),
    emailAuthDigest({
      challenge_id,
      kind: "browser",
      value: opts.browser_binding,
    }),
    getClusterAccountByEmailDirect(email),
  ]);
  const pool = getPool();
  const db = await pool.connect();
  let row: ChallengeRow;
  try {
    await db.query("BEGIN");
    const active = (
      await db.query<ChallengeRow>(
        `
          SELECT *
            FROM ${TABLE}
           WHERE email_lookup_hash=$1
             AND state='pending'
             AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE
        `,
        [emailLookupHash],
      )
    ).rows[0];
    if (
      active &&
      (await emailAuthSecretMatches({
        challenge_id: active.challenge_id,
        digest: active.browser_binding_digest,
        kind: "browser",
        value: opts.browser_binding,
      }))
    ) {
      await db.query("COMMIT");
      return publicStatus(active);
    }
    await assertStartRateLimit({
      db,
      email_lookup_hash: emailLookupHash,
      request_ip_hash: requestIpHash,
    });
    await db.query(
      `
        UPDATE ${TABLE}
           SET state='superseded', superseded_at=NOW(), updated_at=NOW()
         WHERE email_lookup_hash=$1
           AND state='pending'
           AND expires_at > NOW()
      `,
      [emailLookupHash],
    );
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const resendAvailableAt = new Date(Date.now() + RESEND_DELAY_MS);
    row = (
      await db.query<ChallengeRow>(
        `
          INSERT INTO ${TABLE} (
            challenge_id, normalized_email, email_lookup_hash, account_id,
            selected_home_bay_id, purpose, state, code_digest,
            link_token_digest, browser_binding_digest, analytics_token,
            attempt_count, max_attempts, send_count, resend_available_at,
            message_queued_at, expires_at, request_ip_hash, metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10,
            0, $11, 1, $12, NOW(), $13, $14, '{}'::JSONB
          )
          RETURNING *
        `,
        [
          challenge_id,
          email,
          emailLookupHash,
          account?.account_id ?? null,
          account?.home_bay_id ?? null,
          purpose,
          codeDigest,
          linkTokenDigest,
          browserBindingDigest,
          opts.analytics_token || null,
          MAX_ATTEMPTS,
          resendAvailableAt,
          expiresAt,
          requestIpHash ?? null,
        ],
      )
    ).rows[0];
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
  await deliverChallenge({
    challenge_id,
    code,
    email_address: email,
    link_token: linkToken,
  });
  return {
    ...publicStatus(row),
    message_sent: true,
    message_failed: false,
  };
}

async function getBoundChallenge({
  challenge_id,
  browser_binding,
}: GetEmailAuthChallengeStatusOptions): Promise<ChallengeRow> {
  await ensureEmailAuthChallengeSchema();
  const row = (
    await getPool().query<ChallengeRow>(
      `SELECT * FROM ${TABLE} WHERE challenge_id=$1`,
      [challenge_id],
    )
  ).rows[0];
  if (
    !row ||
    !(await emailAuthSecretMatches({
      challenge_id,
      digest: row.browser_binding_digest,
      kind: "browser",
      value: browser_binding,
    }))
  ) {
    throw new EmailAuthChallengeError("Challenge not found.", "not_found");
  }
  return row;
}

export async function getEmailAuthChallengeStatusDirect(
  opts: GetEmailAuthChallengeStatusOptions,
): Promise<EmailAuthChallengePublicStatus> {
  const row = await getBoundChallenge(opts);
  if (
    row.state === "pending" &&
    new Date(row.expires_at).valueOf() <= Date.now()
  ) {
    await getPool().query(
      `UPDATE ${TABLE} SET state='expired', updated_at=NOW() WHERE challenge_id=$1 AND state='pending'`,
      [row.challenge_id],
    );
    row.state = "expired";
  }
  await getPool().query(
    `UPDATE ${TABLE} SET first_viewed_at=NOW() WHERE challenge_id=$1 AND first_viewed_at IS NULL`,
    [row.challenge_id],
  );
  return publicStatus(row);
}

export async function resendEmailAuthChallengeDirect(
  opts: ResendEmailAuthChallengeOptions,
): Promise<EmailAuthChallengePublicStatus> {
  await ensureEmailAuthChallengeSchema();
  const pool = getPool();
  const db = await pool.connect();
  let row: ChallengeRow;
  let code: string;
  let linkToken: string;
  try {
    await db.query("BEGIN");
    const current = (
      await db.query<ChallengeRow>(
        `SELECT * FROM ${TABLE} WHERE challenge_id=$1 FOR UPDATE`,
        [opts.challenge_id],
      )
    ).rows[0];
    if (
      !current ||
      !(await emailAuthSecretMatches({
        challenge_id: opts.challenge_id,
        digest: current.browser_binding_digest,
        kind: "browser",
        value: opts.browser_binding,
      }))
    ) {
      throw new EmailAuthChallengeError("Challenge not found.", "not_found");
    }
    if (
      current.state !== "pending" ||
      new Date(current.expires_at).valueOf() <= Date.now()
    ) {
      throw new EmailAuthChallengeError(
        "This sign-in challenge has expired.",
        "expired",
      );
    }
    if (new Date(current.resend_available_at).valueOf() > Date.now()) {
      throw new EmailAuthChallengeError(
        "Wait before requesting another email.",
        "resend_too_soon",
      );
    }
    if (Number(current.send_count) >= MAX_SENDS) {
      throw new EmailAuthChallengeError(
        "Too many messages were sent for this challenge.",
        "rate_limited",
      );
    }
    code = createEmailAuthCode();
    linkToken = createEmailAuthLinkToken();
    const [codeDigest, linkTokenDigest] = await Promise.all([
      emailAuthDigest({
        challenge_id: current.challenge_id,
        kind: "code",
        value: code,
      }),
      emailAuthDigest({
        challenge_id: current.challenge_id,
        kind: "link",
        value: linkToken,
      }),
    ]);
    row = (
      await db.query<ChallengeRow>(
        `
          UPDATE ${TABLE}
             SET code_digest=$2,
                 link_token_digest=$3,
                 send_count=send_count+1,
                 resend_available_at=$4,
                 message_queued_at=NOW(),
                 message_failed_at=NULL,
                 message_error_code=NULL,
                 updated_at=NOW()
           WHERE challenge_id=$1
           RETURNING *
        `,
        [
          current.challenge_id,
          codeDigest,
          linkTokenDigest,
          new Date(Date.now() + RESEND_DELAY_MS),
        ],
      )
    ).rows[0];
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
  await deliverChallenge({
    challenge_id: row.challenge_id,
    code,
    email_address: row.normalized_email,
    link_token: linkToken,
  });
  return {
    ...publicStatus(row),
    message_sent: true,
    message_failed: false,
  };
}

async function redeemSecret({
  challenge_id,
  kind,
  value,
}: {
  challenge_id: string;
  kind: "code" | "link";
  value: string;
}): Promise<EmailAuthChallengePublicStatus> {
  await ensureEmailAuthChallengeSchema();
  const pool = getPool();
  const db = await pool.connect();
  let transactionOpen = false;
  try {
    await db.query("BEGIN");
    transactionOpen = true;
    const row = (
      await db.query<ChallengeRow>(
        `SELECT * FROM ${TABLE} WHERE challenge_id=$1 FOR UPDATE`,
        [challenge_id],
      )
    ).rows[0];
    if (!row) {
      throw new EmailAuthChallengeError("Challenge not found.", "not_found");
    }
    if (row.state === "email_proved") {
      await db.query("COMMIT");
      transactionOpen = false;
      return publicStatus(row);
    }
    if (
      row.state !== "pending" ||
      new Date(row.expires_at).valueOf() <= Date.now()
    ) {
      throw new EmailAuthChallengeError(
        "This sign-in challenge has expired.",
        "expired",
      );
    }
    if (Number(row.attempt_count) >= Number(row.max_attempts)) {
      throw new EmailAuthChallengeError(
        "This sign-in challenge is blocked.",
        "blocked",
      );
    }
    const valid = await emailAuthSecretMatches({
      challenge_id,
      digest: kind === "code" ? row.code_digest : row.link_token_digest,
      kind,
      value,
    });
    if (!valid) {
      const blocked = Number(row.attempt_count) + 1 >= Number(row.max_attempts);
      await db.query(
        `
          UPDATE ${TABLE}
             SET attempt_count=attempt_count+1,
                 state=CASE WHEN attempt_count+1 >= max_attempts THEN 'blocked' ELSE state END,
                 updated_at=NOW()
           WHERE challenge_id=$1
        `,
        [challenge_id],
      );
      await db.query("COMMIT");
      transactionOpen = false;
      throw new EmailAuthChallengeError(
        blocked
          ? "This sign-in challenge is blocked."
          : "The code or link is not valid.",
        blocked ? "blocked" : "invalid",
      );
    }
    const proved = (
      await db.query<ChallengeRow>(
        `
          UPDATE ${TABLE}
             SET state='email_proved',
                 auth_method=$2::TEXT,
                 email_proved_at=NOW(),
                 updated_at=NOW(),
                 metadata=metadata || jsonb_build_object('auth_method', $2::TEXT)
           WHERE challenge_id=$1
           RETURNING *
        `,
        [challenge_id, kind === "code" ? "email_code" : "email_link"],
      )
    ).rows[0];
    await db.query("COMMIT");
    transactionOpen = false;
    return publicStatus(proved);
  } catch (err) {
    if (transactionOpen) {
      await db.query("ROLLBACK");
    }
    throw err;
  } finally {
    db.release();
  }
}

export async function redeemEmailAuthCodeDirect(
  opts: RedeemEmailAuthCodeOptions,
): Promise<EmailAuthChallengePublicStatus> {
  const code = `${opts.code ?? ""}`.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) {
    throw new EmailAuthChallengeError("Enter the six-digit code.", "invalid");
  }
  return await redeemSecret({
    challenge_id: opts.challenge_id,
    kind: "code",
    value: code,
  });
}

export async function redeemEmailAuthLinkDirect(
  opts: RedeemEmailAuthLinkOptions,
): Promise<EmailAuthChallengePublicStatus> {
  const token = `${opts.token ?? ""}`.trim();
  if (token.length < 32) {
    throw new EmailAuthChallengeError(
      "The sign-in link is invalid.",
      "invalid",
    );
  }
  return await redeemSecret({
    challenge_id: opts.challenge_id,
    kind: "link",
    value: token,
  });
}
