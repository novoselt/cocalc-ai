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
      const ddl = `
      CREATE TABLE IF NOT EXISTS growth_account_profiles (
        account_id UUID PRIMARY KEY,
        home_bay_id VARCHAR(64) NOT NULL,
        account_created_at TIMESTAMPTZ NOT NULL,
        cohort_date DATE NOT NULL,
        cohort_week DATE NOT NULL,
        verified_at TIMESTAMPTZ,
        auth_method VARCHAR(48) NOT NULL DEFAULT 'unknown',
        acquisition_channel VARCHAR(48) NOT NULL DEFAULT 'direct_unknown',
        landing_group VARCHAR(48) NOT NULL DEFAULT 'other',
        campaign VARCHAR(96),
        legacy_status VARCHAR(32) NOT NULL DEFAULT 'new',
        institution_class VARCHAR(32) NOT NULL DEFAULT 'unknown',
        actor_class VARCHAR(32) NOT NULL DEFAULT 'customer',
        onboarding_eligibility VARCHAR(32) NOT NULL DEFAULT 'new',
        codex_entitlement_at_creation VARCHAR(48) NOT NULL DEFAULT 'unknown',
        excluded_from_growth BOOLEAN NOT NULL DEFAULT FALSE,
        exclusion_reason VARCHAR(48),
        definition_version VARCHAR(32) NOT NULL,
        source_confidence VARCHAR(32) NOT NULL DEFAULT 'server',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS growth_account_profiles_cohort_date_idx
        ON growth_account_profiles (cohort_date, account_id);
      CREATE INDEX IF NOT EXISTS growth_account_profiles_cohort_week_idx
        ON growth_account_profiles (cohort_week, account_id);
      CREATE INDEX IF NOT EXISTS growth_account_profiles_home_bay_idx
        ON growth_account_profiles (home_bay_id, cohort_date);

      CREATE TABLE IF NOT EXISTS growth_account_milestones (
        account_id UUID NOT NULL,
        milestone VARCHAR(64) NOT NULL,
        definition_version VARCHAR(32) NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        source_event_id UUID,
        home_bay_id VARCHAR(64) NOT NULL,
        metadata_class VARCHAR(48),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, milestone, definition_version)
      );
      CREATE INDEX IF NOT EXISTS growth_account_milestones_occurred_idx
        ON growth_account_milestones (milestone, occurred_at, account_id);

      CREATE TABLE IF NOT EXISTS growth_account_activity_daily (
        account_id UUID NOT NULL,
        activity_date DATE NOT NULL,
        metric_contract_version VARCHAR(32) NOT NULL,
        home_bay_id VARCHAR(64) NOT NULL,
        app_foreground BOOLEAN NOT NULL DEFAULT FALSE,
        project_engaged BOOLEAN NOT NULL DEFAULT FALSE,
        project_work BOOLEAN NOT NULL DEFAULT FALSE,
        self_directed_work BOOLEAN NOT NULL DEFAULT FALSE,
        compute_consumed BOOLEAN NOT NULL DEFAULT FALSE,
        ai_engaged BOOLEAN NOT NULL DEFAULT FALSE,
        first_activity_at TIMESTAMPTZ NOT NULL,
        last_activity_at TIMESTAMPTZ NOT NULL,
        membership_class VARCHAR(48),
        source_confidence VARCHAR(32) NOT NULL DEFAULT 'canonical',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (account_id, activity_date, metric_contract_version)
      );
      CREATE INDEX IF NOT EXISTS growth_activity_date_account_idx
        ON growth_account_activity_daily (activity_date, account_id);
      CREATE INDEX IF NOT EXISTS growth_activity_account_date_idx
        ON growth_account_activity_daily (account_id, activity_date DESC);

      CREATE TABLE IF NOT EXISTS growth_event_log (
        event_id UUID PRIMARY KEY,
        event_name VARCHAR(64) NOT NULL,
        event_version INTEGER NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        account_id UUID NOT NULL,
        visitor_id VARCHAR(96),
        project_id UUID,
        home_bay_id VARCHAR(64) NOT NULL,
        source_bay_id VARCHAR(64) NOT NULL,
        source_component VARCHAR(48) NOT NULL,
        experiment VARCHAR(64),
        variant VARCHAR(48),
        properties JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE INDEX IF NOT EXISTS growth_event_log_watermark_idx
        ON growth_event_log (received_at, event_id);
      CREATE INDEX IF NOT EXISTS growth_event_log_home_watermark_idx
        ON growth_event_log (home_bay_id, received_at, event_id);
      CREATE INDEX IF NOT EXISTS growth_event_log_account_idx
        ON growth_event_log (account_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS growth_event_log_name_idx
        ON growth_event_log (event_name, occurred_at DESC);

      CREATE TABLE IF NOT EXISTS growth_materialization_state (
        worker_name VARCHAR(64) NOT NULL,
        scope_id VARCHAR(64) NOT NULL,
        source_watermark JSONB NOT NULL DEFAULT '{}'::jsonb,
        metric_definition_version VARCHAR(32) NOT NULL,
        coverage_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_success_at TIMESTAMPTZ,
        last_duration_ms INTEGER,
        rows_processed INTEGER,
        last_error TEXT,
        lease_owner VARCHAR(96),
        lease_expires_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (worker_name, scope_id)
      );
      ALTER TABLE growth_materialization_state
        ADD COLUMN IF NOT EXISTS coverage_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
      ALTER TABLE growth_materialization_state
        ALTER COLUMN coverage_started_at SET DEFAULT NOW();
      UPDATE growth_materialization_state
         SET coverage_started_at=COALESCE(last_success_at, NOW())
       WHERE coverage_started_at IS NULL;
      ALTER TABLE growth_materialization_state
        ALTER COLUMN coverage_started_at SET NOT NULL;

      CREATE TABLE IF NOT EXISTS growth_dirty_periods (
        metric_version VARCHAR(32) NOT NULL,
        scope_id VARCHAR(64) NOT NULL,
        period_grain VARCHAR(16) NOT NULL,
        period_start DATE NOT NULL,
        reason VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (metric_version, scope_id, period_grain, period_start)
      );
      CREATE INDEX IF NOT EXISTS growth_dirty_periods_created_idx
        ON growth_dirty_periods (created_at);

      CREATE TABLE IF NOT EXISTS growth_metric_series (
        scope_id VARCHAR(64) NOT NULL,
        metric_name VARCHAR(64) NOT NULL,
        metric_version VARCHAR(32) NOT NULL,
        period_grain VARCHAR(16) NOT NULL,
        period_start DATE NOT NULL,
        segment_set VARCHAR(32) NOT NULL DEFAULT 'overall',
        segment_value VARCHAR(96) NOT NULL DEFAULT 'all',
        value DOUBLE PRECISION,
        numerator INTEGER,
        denominator INTEGER,
        partial BOOLEAN NOT NULL DEFAULT FALSE,
        materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (
          scope_id, metric_name, metric_version, period_grain, period_start,
          segment_set, segment_value
        )
      );
      CREATE INDEX IF NOT EXISTS growth_metric_series_read_idx
        ON growth_metric_series (scope_id, period_grain, metric_name, period_start);

      CREATE TABLE IF NOT EXISTS growth_retention_cells (
        scope_id VARCHAR(64) NOT NULL,
        cohort_grain VARCHAR(16) NOT NULL,
        cohort_start DATE NOT NULL,
        activity_signal VARCHAR(48) NOT NULL,
        metric_version VARCHAR(32) NOT NULL,
        period_index INTEGER NOT NULL,
        segment_set VARCHAR(32) NOT NULL DEFAULT 'overall',
        segment_value VARCHAR(96) NOT NULL DEFAULT 'all',
        cohort_size INTEGER NOT NULL,
        exact_active_accounts INTEGER NOT NULL,
        rolling_active_accounts INTEGER NOT NULL,
        complete BOOLEAN NOT NULL,
        materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (
          scope_id, cohort_grain, cohort_start, activity_signal,
          metric_version, period_index, segment_set, segment_value
        )
      );
      CREATE INDEX IF NOT EXISTS growth_retention_cells_read_idx
        ON growth_retention_cells (
          scope_id, cohort_grain, activity_signal, cohort_start, period_index
        );

      CREATE TABLE IF NOT EXISTS growth_weekly_accounting (
        scope_id VARCHAR(64) NOT NULL,
        week_start DATE NOT NULL,
        activity_signal VARCHAR(48) NOT NULL,
        metric_version VARCHAR(32) NOT NULL,
        segment_set VARCHAR(32) NOT NULL DEFAULT 'overall',
        segment_value VARCHAR(96) NOT NULL DEFAULT 'all',
        new_accounts INTEGER NOT NULL,
        retained_accounts INTEGER NOT NULL,
        resurrected_accounts INTEGER NOT NULL,
        churned_accounts INTEGER NOT NULL,
        partial BOOLEAN NOT NULL DEFAULT FALSE,
        materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (
          scope_id, week_start, activity_signal, metric_version,
          segment_set, segment_value
        )
      );
      CREATE INDEX IF NOT EXISTS growth_weekly_accounting_read_idx
        ON growth_weekly_accounting (scope_id, activity_signal, week_start);

      CREATE TABLE IF NOT EXISTS growth_annotations (
        annotation_id UUID PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL,
        annotation_type VARCHAR(48) NOT NULL,
        title VARCHAR(160) NOT NULL,
        details TEXT,
        created_by UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS growth_annotations_occurred_idx
        ON growth_annotations (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_account_growth_idx
        ON analytics (account_id, data_time)
        WHERE account_id IS NOT NULL;
    `;
      // PGlite and some managed Postgres proxies reject multi-command prepared
      // statements. Keeping each idempotent DDL command separate also makes a
      // failed deployment identify the exact object that could not be created.
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
