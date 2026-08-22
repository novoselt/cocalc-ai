/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export {};

const describePglite =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe : describe.skip;

const LEGACY_EVENT_ID = "11111111-1111-4111-8111-111111111111";
const NULL_EVENT_ID = "22222222-2222-4222-8222-222222222222";
const NEW_EVENT_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";

describePglite("account resource quarantine audit schema", () => {
  const originalEnv = {
    COCALC_DB: process.env.COCALC_DB,
    COCALC_PGLITE_DATA_DIR: process.env.COCALC_PGLITE_DATA_DIR,
  };

  beforeAll(async () => {
    process.env.COCALC_DB = "pglite";
    process.env.COCALC_PGLITE_DATA_DIR = "memory://";
    const getPool = (await import("@cocalc/database/pool")).default;
    await getPool().query(`
      CREATE TABLE account_resource_quarantine_audit_log (
        id UUID PRIMARY KEY,
        account_id UUID,
        actor_account_id UUID,
        reason TEXT,
        result JSONB,
        created TIMESTAMP
      )
    `);
    await getPool().query(
      `INSERT INTO account_resource_quarantine_audit_log
         (id, account_id, result, created)
       VALUES
         ($1, $3, '{}'::jsonb, '2026-08-20 12:34:56'::timestamp),
         ($2, $3, '{}'::jsonb, NULL)`,
      [LEGACY_EVENT_ID, NULL_EVENT_ID, ACCOUNT_ID],
    );
  });

  afterAll(async () => {
    const { closePglite } = await import("@cocalc/database/pglite");
    await closePglite();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("reconciles legacy created timestamps and defaults", async () => {
    const getPool = (await import("@cocalc/database/pool")).default;
    await getPool().query("SET TIME ZONE 'America/Los_Angeles'");
    const { ensureAccountResourceQuarantineAuditLogSchema } =
      await import("./resource-quarantine-audit");
    await ensureAccountResourceQuarantineAuditLogSchema();

    const schema = await getPool().query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema=current_schema()
          AND table_name='account_resource_quarantine_audit_log'
          AND column_name='created'`,
    );
    expect(schema.rows).toHaveLength(1);
    expect(schema.rows[0]).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
    expect(schema.rows[0].column_default).toMatch(/now\(\)/i);

    const legacy = await getPool().query(
      `SELECT created = '2026-08-20 12:34:56+00'::timestamptz AS preserved
         FROM account_resource_quarantine_audit_log
        WHERE id=$1`,
      [LEGACY_EVENT_ID],
    );
    expect(legacy.rows).toEqual([{ preserved: true }]);

    const backfilled = await getPool().query(
      `SELECT created IS NOT NULL AS backfilled
         FROM account_resource_quarantine_audit_log
        WHERE id=$1`,
      [NULL_EVENT_ID],
    );
    expect(backfilled.rows).toEqual([{ backfilled: true }]);

    await getPool().query(
      `INSERT INTO account_resource_quarantine_audit_log
         (id, account_id, result)
       VALUES ($1, $2, '{}'::jsonb)`,
      [NEW_EVENT_ID, ACCOUNT_ID],
    );
    const inserted = await getPool().query(
      `SELECT created IS NOT NULL AS defaulted
         FROM account_resource_quarantine_audit_log
        WHERE id=$1`,
      [NEW_EVENT_ID],
    );
    expect(inserted.rows).toEqual([{ defaulted: true }]);

    await expect(
      ensureAccountResourceQuarantineAuditLogSchema(),
    ).resolves.toBeUndefined();
  });
});
