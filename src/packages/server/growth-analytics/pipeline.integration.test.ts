/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export {};

const describePglite =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe : describe.skip;

const ACCOUNT_ID = "9079221d-9ed0-4f2d-9eac-86c483423536";
const PROJECT_ID = "1e1bec74-8fd8-48fb-8426-8d7bec13e3e4";
const EVENT_ID = "fc1f9ee1-e5a2-4474-bb9f-372eeb936f32";
const NEW_ACCOUNT_ID = "e22393e6-2d62-42b1-b364-f145aebd41de";
const ACCOUNT_CREATED_EVENT_ID = "eb827d06-b2d0-4b29-a750-43219d2ef011";
const IDENTITY_EVENT_ID = "9622da4a-c0ef-4a4d-8804-d95d7f58d4b5";

describePglite("growth analytics pipeline", () => {
  const originalEnv = {
    COCALC_BAY_ID: process.env.COCALC_BAY_ID,
    COCALC_DB: process.env.COCALC_DB,
    COCALC_PGLITE_DATA_DIR: process.env.COCALC_PGLITE_DATA_DIR,
  };

  beforeAll(async () => {
    process.env.COCALC_BAY_ID = "growth-test-bay";
    process.env.COCALC_DB = "pglite";
    process.env.COCALC_PGLITE_DATA_DIR = "memory://";
    const getPool = (await import("@cocalc/database/pool")).default;
    await getPool().query(`
      CREATE TABLE accounts (
        account_id UUID PRIMARY KEY,
        home_bay_id VARCHAR(64),
        created TIMESTAMP NOT NULL,
        email_address TEXT,
        email_address_verified JSONB,
        password_hash TEXT,
        ephemeral BIGINT,
        banned BOOLEAN,
        groups TEXT[],
        tags TEXT[],
        created_by INET
      )
    `);
    await getPool().query(`
      CREATE TABLE analytics (
        token UUID PRIMARY KEY,
        data JSONB,
        data_time TIMESTAMPTZ,
        account_id UUID
      )
    `);
    // Reproduce the legacy nullable shape so startup schema convergence must
    // backfill rows before adding defaults and NOT NULL constraints.
    await getPool().query(`
      CREATE TABLE growth_event_log (
        event_id UUID PRIMARY KEY,
        event_name VARCHAR(64) NOT NULL,
        event_version INTEGER NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ,
        account_id UUID NOT NULL,
        visitor_id VARCHAR(96),
        project_id UUID,
        home_bay_id VARCHAR(64) NOT NULL,
        source_bay_id VARCHAR(64) NOT NULL,
        source_component VARCHAR(48) NOT NULL,
        experiment VARCHAR(64),
        variant VARCHAR(48),
        properties JSONB
      )
    `);
    await getPool().query(`
      CREATE TABLE growth_materialization_state (
        worker_name VARCHAR(64) NOT NULL,
        scope_id VARCHAR(64) NOT NULL,
        source_watermark JSONB,
        metric_definition_version VARCHAR(32) NOT NULL,
        coverage_started_at TIMESTAMPTZ,
        last_success_at TIMESTAMPTZ,
        last_duration_ms INTEGER,
        rows_processed INTEGER,
        last_error TEXT,
        lease_owner VARCHAR(96),
        lease_expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (worker_name, scope_id)
      )
    `);
    await getPool().query(`
      INSERT INTO growth_materialization_state
        (worker_name, scope_id, metric_definition_version, coverage_started_at)
      VALUES ('growth-materializer-v1', 'growth-test-bay', 'growth-v1', NULL)
    `);
    const { SCHEMA } = await import("@cocalc/util/db-schema");
    const { schemaNeedsSync, syncSchema } =
      await import("@cocalc/database/postgres/schema/sync");
    const growthSchema = Object.fromEntries(
      Object.entries(SCHEMA).filter(([name]) => name.startsWith("growth_")),
    );
    await syncSchema(growthSchema);
    expect(await schemaNeedsSync(growthSchema)).toBe(false);
    await getPool().query(
      `INSERT INTO accounts
       (account_id, home_bay_id, created, email_address,
          email_address_verified, banned, groups, tags)
       VALUES ($1, $2, NOW() AT TIME ZONE 'UTC' - INTERVAL '1 day', $3::text,
         jsonb_build_object($3::text, to_jsonb(NOW())), FALSE, '{}', '{}')`,
      [ACCOUNT_ID, "growth-test-bay", "person@example.edu"],
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

  it("deduplicates events and converges through a durable watermark", async () => {
    const { ingestGrowthEvent } = await import("./ingest");
    const event = {
      event_id: EVENT_ID,
      event_name: "project_work" as const,
      project_id: PROJECT_ID,
      source_component: "browser" as const,
      properties: { action_category: "jupyter_execute" as const },
    };
    await expect(
      ingestGrowthEvent({ account_id: ACCOUNT_ID, event }),
    ).resolves.toEqual({ recorded: true });
    await expect(
      ingestGrowthEvent({ account_id: ACCOUNT_ID, event }),
    ).resolves.toEqual({ recorded: false });

    const getPool = (await import("@cocalc/database/pool")).default;
    // PostgreSQL timestamps have microsecond precision, while JavaScript Date
    // only has milliseconds. A text cursor must preserve all six digits or the
    // same final event remains perpetually greater than the saved watermark.
    await getPool().query(
      `UPDATE growth_event_log
          SET received_at='2026-08-09 12:00:00.123456+00'::timestamptz
        WHERE event_id=$1`,
      [EVENT_ID],
    );
    const { runGrowthMaterializationOnce } = await import("./materialize");
    const first = await runGrowthMaterializationOnce();
    expect(first).toMatchObject({ status: "ok", events: 1 });
    const migratedState = await getPool().query(
      `SELECT coverage_started_at IS NOT NULL AS has_coverage,
              source_watermark IS NOT NULL AS has_watermark
         FROM growth_materialization_state
        WHERE worker_name='growth-materializer-v1' AND scope_id='growth-test-bay'`,
    );
    expect(migratedState.rows).toEqual([
      { has_coverage: true, has_watermark: true },
    ]);
    const migratedEvent = await getPool().query(
      `SELECT received_at IS NOT NULL AS has_received_at
         FROM growth_event_log WHERE event_id=$1`,
      [EVENT_ID],
    );
    expect(migratedEvent.rows).toEqual([{ has_received_at: true }]);
    const second = await runGrowthMaterializationOnce();
    expect(second).toMatchObject({ status: "ok", events: 0 });

    const facts = await getPool().query(
      `SELECT project_engaged, project_work, ai_engaged
         FROM growth_account_activity_daily WHERE account_id=$1`,
      [ACCOUNT_ID],
    );
    expect(facts.rows).toEqual([
      { project_engaged: true, project_work: true, ai_engaged: false },
    ]);
    const milestones = await getPool().query(
      `SELECT milestone FROM growth_account_milestones
        WHERE account_id=$1 ORDER BY milestone`,
      [ACCOUNT_ID],
    );
    expect(milestones.rows.map(({ milestone }) => milestone)).toEqual(
      expect.arrayContaining(["account_created", "first_meaningful_work"]),
    );

    await getPool().query(
      `INSERT INTO accounts
         (account_id, home_bay_id, created, email_address,
          email_address_verified, banned, groups, tags)
       VALUES ($1, $2, NOW() AT TIME ZONE 'UTC', $3, '{}'::jsonb,
               FALSE, '{}', '{}')`,
      [NEW_ACCOUNT_ID, "growth-test-bay", "new-person@example.edu"],
    );
    await ingestGrowthEvent({
      account_id: NEW_ACCOUNT_ID,
      event: {
        event_id: ACCOUNT_CREATED_EVENT_ID,
        event_name: "account_created",
        source_component: "auth",
        properties: { auth_method: "email_code_or_link" },
      },
    });
    await ingestGrowthEvent({
      account_id: NEW_ACCOUNT_ID,
      event: {
        event_id: IDENTITY_EVENT_ID,
        event_name: "identity_proved",
        source_component: "auth",
        properties: { auth_method: "email_code" },
      },
    });
    await expect(runGrowthMaterializationOnce()).resolves.toMatchObject({
      status: "ok",
      events: 2,
    });

    const profiles = await getPool().query(
      `SELECT account_id, legacy_status, auth_method,
              verified_at IS NOT NULL AS verified
         FROM growth_account_profiles
        WHERE account_id=ANY($1::uuid[])
        ORDER BY account_id`,
      [[ACCOUNT_ID, NEW_ACCOUNT_ID]],
    );
    expect(profiles.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: ACCOUNT_ID,
          legacy_status: "legacy",
        }),
        expect.objectContaining({
          account_id: NEW_ACCOUNT_ID,
          legacy_status: "new",
          auth_method: "email_code",
          verified: true,
        }),
      ]),
    );
    const signupMetrics = await getPool().query(
      `SELECT metric_name, value
         FROM growth_metric_series
        WHERE period_start=(NOW() AT TIME ZONE 'UTC')::date
          AND metric_name IN ('eligible_signups', 'verified_accounts')
        ORDER BY metric_name`,
    );
    expect(signupMetrics.rows).toEqual([
      { metric_name: "eligible_signups", value: 1 },
      { metric_name: "verified_accounts", value: 1 },
    ]);
  });
});
