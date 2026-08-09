/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getPoolClient } from "@cocalc/database/pool";

let schemaReady: Promise<void> | undefined;

export function ensureGrowthAnalyticsSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const client = await getPoolClient();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('growth-analytics-schema-v1', 0))",
      );
      // Table, column, primary-key, and index ownership belongs exclusively to
      // util/db-schema/growth-analytics.ts and the startup schema synchronizer.
      // Keep only defaults, nullability, and data repairs here because those
      // invariants are not currently synchronized by db-schema.
      const ddl = `
        ALTER TABLE growth_event_log
          ALTER COLUMN received_at SET DEFAULT NOW();
        UPDATE growth_event_log
           SET received_at=NOW()
         WHERE received_at IS NULL;
        ALTER TABLE growth_event_log
          ALTER COLUMN received_at SET NOT NULL;

        ALTER TABLE growth_materialization_state
          ALTER COLUMN source_watermark SET DEFAULT '{}'::jsonb;
        UPDATE growth_materialization_state
           SET source_watermark='{}'::jsonb
         WHERE source_watermark IS NULL;
        ALTER TABLE growth_materialization_state
          ALTER COLUMN source_watermark SET NOT NULL;
        ALTER TABLE growth_materialization_state
          ALTER COLUMN coverage_started_at SET DEFAULT NOW();
        UPDATE growth_materialization_state
           SET coverage_started_at=COALESCE(last_success_at, NOW())
         WHERE coverage_started_at IS NULL;
        ALTER TABLE growth_materialization_state
          ALTER COLUMN coverage_started_at SET NOT NULL;
      `;
      // PGlite and some managed Postgres proxies reject multi-command prepared
      // statements. Separate commands also identify a failed invariant exactly.
      for (const statement of ddl.split(";").map((part) => part.trim())) {
        if (statement) await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  return schemaReady;
}

export function resetGrowthAnalyticsSchemaForTests(): void {
  schemaReady = undefined;
}
