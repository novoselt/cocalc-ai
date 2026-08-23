/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";

let schemaReady: Promise<void> | undefined;

/**
 * Existing bans intentionally receive the deployment time. Historical audit
 * rows are incomplete, so pretending to know their original ban time would
 * shorten the archive grace period without authoritative evidence.
 */
export async function ensureAccountBanTimestampSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const pool = getPool();
    await pool.query(
      "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ",
    );
    await pool.query(
      `UPDATE accounts
          SET banned_at = NOW()
        WHERE banned IS TRUE
          AND banned_at IS NULL`,
    );
    await pool.query(`
      CREATE OR REPLACE FUNCTION set_account_banned_at()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.banned IS TRUE THEN
          IF TG_OP = 'INSERT' OR OLD.banned IS NOT TRUE THEN
            NEW.banned_at := NOW();
          ELSE
            NEW.banned_at := COALESCE(NEW.banned_at, OLD.banned_at, NOW());
          END IF;
        ELSE
          NEW.banned_at := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS accounts_set_banned_at ON accounts
    `);
    await pool.query(`
      CREATE TRIGGER accounts_set_banned_at
      BEFORE INSERT OR UPDATE OF banned ON accounts
      FOR EACH ROW EXECUTE FUNCTION set_account_banned_at()
    `);
    await pool.query(
      `UPDATE accounts
          SET banned_at = NULL
        WHERE banned IS NOT TRUE
          AND banned_at IS NOT NULL`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS accounts_banned_at_idx
         ON accounts (banned_at)
       WHERE banned IS TRUE`,
    );
  })().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  await schemaReady;
}

export function resetAccountBanTimestampSchemaForTests(): void {
  schemaReady = undefined;
}
